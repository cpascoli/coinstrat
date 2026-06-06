#!/usr/bin/env python3
"""A/B test global vs pure rolling vs gated rolling EQM risk (2y / 3y / 4y)."""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np
import pandas as pd

from eqm_model import (
    CQM_DEFAULTS,
    DEFAULT_LOCAL_JSON,
    clean_price_series,
    fit_eqm,
    full_sample_eqm_signals,
    gated_rolling_risk_series,
    load_local_plus_binance_tail,
    risk_for_price,
    rolling_risk_series,
    run_risk_weighted_dca,
)

REFERENCE_RISK = 0.264  # BTCAnalytica May 28, 2026 snapshot

BOTTOMS: dict[str, str] = {
    "2015 bottom": "2015-01-14",
    "2018-19 bottom": "2018-12-15",
    "COVID crash": "2020-03-13",
    "2022-23 bottom": "2022-11-21",
}

TOPS: dict[str, str] = {
    "2017 top": "2017-12-17",
    "2021 top": "2021-11-09",
}


@dataclass(frozen=True)
class VariantResult:
    name: str
    snapshot_risk: float
    snapshot_err: float
    daily_buy: float
    bottom_risks: dict[str, float]
    top_risks: dict[str, float]
    bottom_max: float
    top_min: float
    cagr_2018: float | None
    final_btc: float


def fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def evaluate(
    fit,
    prices: pd.Series,
    name: str,
    risks: pd.Series,
    snapshot_date: pd.Timestamp,
    backtest_start: str,
    base_amount: float,
) -> VariantResult:
    snap_date = prices.loc[:snapshot_date].index[-1]
    snapshot_risk = float(risks.loc[snap_date])

    bottom_risks = {
        label: float(risks.loc[prices.loc[:d].index[-1]])
        for label, d in BOTTOMS.items()
    }
    top_risks = {
        label: float(risks.loc[prices.loc[:d].index[-1]])
        for label, d in TOPS.items()
    }

    signals = pd.DataFrame({"price": prices, "score": 0.5, "risk": risks}).dropna()
    _, summary = run_risk_weighted_dca(signals, start=backtest_start, base_amount=base_amount)

    return VariantResult(
        name=name,
        snapshot_risk=snapshot_risk,
        snapshot_err=abs(snapshot_risk - REFERENCE_RISK),
        daily_buy=base_amount * (1.0 - 2.0 * snapshot_risk),
        bottom_risks=bottom_risks,
        top_risks=top_risks,
        bottom_max=max(bottom_risks.values()),
        top_min=min(top_risks.values()),
        cagr_2018=summary.cagr_peak_capital,
        final_btc=summary.final_btc,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="A/B rolling-window EQM risk")
    parser.add_argument("--snapshot-date", default="2026-05-28")
    parser.add_argument("--backtest-start", default="2018-01-01")
    parser.add_argument("--base-amount", type=float, default=500.0)
    parser.add_argument("--fetch-binance-tail", action="store_true")
    parser.add_argument("--gate-near-days", type=int, default=120)
    parser.add_argument("--gate-near-buffer", type=float, default=1.15)
    args = parser.parse_args()

    if args.fetch_binance_tail:
        raw = load_local_plus_binance_tail(DEFAULT_LOCAL_JSON)
    else:
        from eqm_model import load_local_json

        raw = load_local_json(DEFAULT_LOCAL_JSON)

    prices = clean_price_series(raw, start=str(CQM_DEFAULTS["start_date"]))
    fit = fit_eqm(prices)
    snapshot_date = pd.Timestamp(args.snapshot_date)

    global_r = pd.Series(
        [risk_for_price(fit, d, float(p)) for d, p in prices.items()],
        index=prices.index,
    )

    results: list[VariantResult] = [
        evaluate(fit, prices, "global", global_r, snapshot_date, args.backtest_start, args.base_amount)
    ]

    for years, days in [("2y", 730), ("3y", 1095), ("4y", 1460)]:
        roll = rolling_risk_series(fit, days).reindex(prices.index)
        results.append(
            evaluate(fit, prices, f"roll {years}", roll, snapshot_date, args.backtest_start, args.base_amount)
        )
        gated = gated_rolling_risk_series(
            fit,
            prices,
            roll_window_days=days,
            near_low_window_days=args.gate_near_days,
            near_low_buffer=args.gate_near_buffer,
        )
        results.append(
            evaluate(
                fit,
                prices,
                f"gated {years} (near-{args.gate_near_days}d x{args.gate_near_buffer:.2f})",
                gated,
                snapshot_date,
                args.backtest_start,
                args.base_amount,
            )
        )

    print(f"\nReference snapshot risk: {fmt_pct(REFERENCE_RISK)}  (BTCAnalytica May 28, 2026)")
    print(f"Backtest: {args.backtest_start} → latest, base ${args.base_amount:.0f}/day\n")

    header = (
        f"{'variant':36} {'snap':>6} {'|err|':>6} {'buy/day':>8} "
        f"{'bmax':>6} {'tmin':>6} {'CAGR':>7} {'BTC':>7}"
    )
    print(header)
    print("-" * len(header))
    for r in results:
        cagr_s = fmt_pct(r.cagr_2018) if r.cagr_2018 is not None else "n/a"
        print(
            f"{r.name:36} {fmt_pct(r.snapshot_risk):>6} {fmt_pct(r.snapshot_err):>6} "
            f"${r.daily_buy:,.0f} {fmt_pct(r.bottom_max):>6} {fmt_pct(r.top_min):>6} "
            f"{cagr_s:>7} {r.final_btc:7.2f}"
        )

    print("\n--- Cycle bottom risks ---")
    cols = [r.name for r in results]
    short_cols = [c[:12] for c in cols]
    print(f"{'event':16} " + " ".join(f"{c:>12}" for c in short_cols))
    for label in BOTTOMS:
        print(
            f"{label:16} "
            + " ".join(f"{fmt_pct(r.bottom_risks[label]):>12}" for r in results)
        )

    print("\n--- Today's bot sizing matters: buy/day = base * (1 - 2*risk) ---")
    for r in results:
        flag = "  ← reference match" if r.snapshot_err <= 0.01 else ""
        if r.snapshot_err > 0.05:
            flag = "  ← would over-buy today" if r.snapshot_risk < REFERENCE_RISK else "  ← would under-buy"
        print(f"  {r.name:36} risk {fmt_pct(r.snapshot_risk)} → ${r.daily_buy:,.0f}/day{flag}")

    # Rank: snapshot error first, then bottom max, then -CAGR
    ranked = sorted(
        results,
        key=lambda r: (r.snapshot_err, r.bottom_max, -(r.cagr_2018 or 0.0)),
    )
    winner = ranked[0]
    print(f"\nRecommended: {winner.name}")
    print(
        f"  snapshot {fmt_pct(winner.snapshot_risk)} (err {fmt_pct(winner.snapshot_err)}), "
        f"worst bottom {fmt_pct(winner.bottom_max)}, "
        f"today's buy ${winner.daily_buy:,.0f}/day, "
        f"CAGR {fmt_pct(winner.cagr_2018) if winner.cagr_2018 else 'n/a'}"
    )


if __name__ == "__main__":
    main()
