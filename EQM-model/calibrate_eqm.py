#!/usr/bin/env python3
"""Grid-search EQM risk-curve parameters against the BTCAnalytica reference knots.

The risk->price curve at the snapshot date is governed by:

    residual_quantile(risk) = low_q + risk**(1/gamma) * (high_q - low_q)
    price(risk)             = exp(trend(snapshot; time_power) + Q_resid(residual_quantile))

Endpoints are set purely by (time_power, low_q) [risk 0%] and (time_power, high_q)
[risk 100%]; `gamma` only bends the interior. We sweep all four against the seven
visible reference risk-price knots and report the lowest log-RMSE fits.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from eqm_model import (
    DEFAULT_LOCAL_JSON,
    clean_price_series,
    load_local_json,
    load_local_plus_binance_tail,
    _time_index,
)

# Visible BTCAnalytica reference knots (USD) — May 28, 2026 close.
REFERENCE_KNOTS_20260528 = {
    0.00: 45_000.0,
    0.10: 59_000.0,
    0.25: 72_000.0,
    0.50: 101_000.0,
    0.75: 125_000.0,
    0.90: 138_000.0,
    1.00: 161_000.0,
}

RISKS = np.array(sorted(REFERENCE_KNOTS_20260528.keys()))
REF = np.array([REFERENCE_KNOTS_20260528[r] for r in RISKS])
LOG_REF = np.log(REF)


def trend_at(snapshot_x: float, x: np.ndarray, y: np.ndarray) -> float:
    """OLS log-trend value at the snapshot, for a given time-power design x."""
    slope, intercept = np.polyfit(x, y, 1)
    return float(intercept + slope * snapshot_x)


def predict_prices(trend_snap: float, sorted_resid: np.ndarray, cdf: np.ndarray,
                   low_q: float, high_q: float, gamma: float) -> np.ndarray:
    rq = low_q + np.power(RISKS, 1.0 / gamma) * (high_q - low_q)
    resid = np.interp(rq, cdf, sorted_resid)
    return np.exp(trend_snap + resid)


def log_rmse(pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((np.log(pred) - LOG_REF) ** 2)))


def mape(pred: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - REF) / REF) * 100.0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot-date", default="2026-05-28")
    ap.add_argument("--start-history", default="2014-01-01")
    ap.add_argument("--offline", action="store_true", help="Use local JSON only (no Binance tail)")
    ap.add_argument("--top", type=int, default=12)
    args = ap.parse_args()

    raw = load_local_json(DEFAULT_LOCAL_JSON) if args.offline else load_local_plus_binance_tail(DEFAULT_LOCAL_JSON)
    prices = clean_price_series(raw, start=args.start_history)
    snap = pd.Timestamp(args.snapshot_date)
    prices = prices.loc[:snap]  # truncate so the snapshot is the fit's end date
    if snap not in prices.index:
        snap = prices.index[-1]
    start_date = prices.index.min()
    y = np.log(prices.to_numpy(dtype=float))
    print(f"Calibrating on {len(prices)} days, {start_date.date()} -> {prices.index.max().date()} "
          f"(price ${prices.iloc[-1]/1000:.1f}K)\n")

    time_powers = np.round(np.arange(0.48, 0.821, 0.02), 4)
    low_qs = np.round(np.arange(0.005, 0.0801, 0.005), 4)
    high_qs = np.round(np.arange(0.60, 0.8501, 0.01), 4)
    gammas = np.round(np.arange(0.70, 1.451, 0.05), 4)

    results = []
    for tp in time_powers:
        x = _time_index(prices.index, start_date, float(tp))
        snap_x = float(np.power(max((snap.normalize() - start_date.normalize()).days + 1.0, 1.0), tp))
        trend_snap = trend_at(snap_x, x, y)
        resid = y - np.polyval(np.polyfit(x, y, 1), x)
        sorted_resid = np.sort(resid)
        cdf = (np.arange(len(sorted_resid)) + 0.5) / len(sorted_resid)
        for lq in low_qs:
            for hq in high_qs:
                if hq - lq < 0.30:
                    continue
                for g in gammas:
                    pred = predict_prices(trend_snap, sorted_resid, cdf, float(lq), float(hq), float(g))
                    results.append((log_rmse(pred), mape(pred), float(tp), float(lq), float(hq), float(g)))

    results.sort(key=lambda r: r[0])
    print(f"Swept {len(results):,} parameter combinations. Best fits (by log-RMSE):\n")
    header = f"{'rank':>4} {'logRMSE':>8} {'MAPE%':>7} {'time_pwr':>8} {'low_q':>6} {'high_q':>7} {'gamma':>6}"
    print(header)
    print("-" * len(header))
    for i, (lr, mp, tp, lq, hq, g) in enumerate(results[: args.top], 1):
        print(f"{i:>4} {lr:>8.4f} {mp:>7.2f} {tp:>8.2f} {lq:>6.3f} {hq:>7.3f} {g:>6.2f}")

    best = results[0]
    _, _, tp, lq, hq, g = best
    x = _time_index(prices.index, start_date, tp)
    snap_x = float(np.power(max((snap.normalize() - start_date.normalize()).days + 1.0, 1.0), tp))
    trend_snap = trend_at(snap_x, x, y)
    resid = y - np.polyval(np.polyfit(x, y, 1), x)
    sorted_resid = np.sort(resid)
    cdf = (np.arange(len(sorted_resid)) + 0.5) / len(sorted_resid)
    pred = predict_prices(trend_snap, sorted_resid, cdf, lq, hq, g)

    print(f"\nBest params: time_power={tp:.2f}  low_quantile={lq:.3f}  high_quantile={hq:.3f}  gamma={g:.2f}")
    print(f"\n{'risk':>6} {'reference':>11} {'best fit':>11} {'err %':>8}")
    print("-" * 40)
    for r, ref_v, pv in zip(RISKS, REF, pred):
        print(f"{r*100:>5.0f}% {ref_v/1000:>10.1f}K {pv/1000:>10.1f}K {(pv-ref_v)/ref_v*100:>+7.1f}%")

    # Baseline (current defaults) for comparison.
    base_tp, base_lq, base_hq, base_g = 0.60, 0.06, 0.68, 1.0
    x = _time_index(prices.index, start_date, base_tp)
    snap_x = float(np.power(max((snap.normalize() - start_date.normalize()).days + 1.0, 1.0), base_tp))
    trend_snap = trend_at(snap_x, x, y)
    resid = y - np.polyval(np.polyfit(x, y, 1), x)
    sorted_resid = np.sort(resid)
    cdf = (np.arange(len(sorted_resid)) + 0.5) / len(sorted_resid)
    base_pred = predict_prices(trend_snap, sorted_resid, cdf, base_lq, base_hq, base_g)
    print(f"\nCurrent defaults (tp=0.60, low=0.06, high=0.68, gamma=1.0): "
          f"logRMSE={log_rmse(base_pred):.4f}  MAPE={mape(base_pred):.2f}%")


if __name__ == "__main__":
    main()
