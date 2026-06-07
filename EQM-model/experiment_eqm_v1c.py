#!/usr/bin/env python3
"""
EQM v1c experiment — raw asymmetric QR fan (no tail calibration ramp).

v1b production scales all QR quantiles by tailScale(t): 1.0 before 2022, then a
linear ramp to endScale so QR 50% ≈ $100,800 on 2026-05-28 (BTCAnalytica anchor).

v1c removes that ramp entirely (tailScale = 1.0 everywhere). Fair-value risk,
gold SMA bands, and charts are otherwise identical to production defaults.

Outputs:
  - eqm_replica_v1c.png          full 5-panel v1c chart
  - eqm_compare_v1b_v1c.png      side-by-side risk / fair-value comparison
  - eqm_v1c_risk_series.csv      daily v1c risk series
  - eqm_v1b_v1c_risk_compare.csv merged v1b vs v1c risks
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from eqm_model import (
    CQM_DEFAULTS,
    DEFAULT_LOCAL_JSON,
    asymmetric_quantile_frame,
    build_qr_scaled_frame,
    fit_asymmetric_quantile_bands,
    fit_eqm,
    full_sample_eqm_signals,
    price_for_risk_fair,
    risk_for_price_fair,
)
from experiment_eqm_v1b import (
    REFERENCE_RISK,
    V1BConfig,
    build_v1b_signals,
    ols_trend_series,
    plot_eqm_v1b,
    print_comparison_table,
    print_tuning_table,
)
from run_eqm import (
    classify_regimes,
    load_prices,
    load_prices_full,
    money,
    panel_label,
    pct,
    shade_regimes,
    smooth_regimes,
    snapshot_box,
)

DEFAULT_OUTPUT = Path(__file__).resolve().parent / "output" / "eqm_replica_v1c.png"
DEFAULT_COMPARE = Path(__file__).resolve().parent / "output" / "eqm_compare_v1b_v1c.png"


def build_v1c_qr_frame(asym_frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Raw QR fan — uniform scale 1.0 (no tail ramp, no calibration pin)."""
    scale = pd.Series(1.0, index=asym_frame.index, name="qr_tail_scale")
    return asym_frame.astype(float).copy(), scale


def production_cfg() -> V1BConfig:
    """Match production: global fair-value risk, no soft gate."""
    return V1BConfig(
        qr_scale_mode="anchor",
        use_soft_gate=False,
        gold_sma_weeks=int(CQM_DEFAULTS["fair_gold_sma_weeks"]),
        risk_driver="qr50",
        calibration_date=str(CQM_DEFAULTS["qr_calibration_date"]),
        calibration_qr_median_usd=float(CQM_DEFAULTS["qr_calibration_median_usd"]),
        qr_scale_ramp_start_date=str(CQM_DEFAULTS["qr_scale_ramp_start_date"]),
        qr_scale_ramp_power=float(CQM_DEFAULTS["qr_scale_ramp_power"]),
    )


def plot_v1b_v1c_compare(
    prices: pd.Series,
    v1b_signals: pd.DataFrame,
    v1c_signals: pd.DataFrame,
    v1b_qr: pd.DataFrame,
    v1c_qr: pd.DataFrame,
    v1b_gold: pd.Series,
    v1c_gold: pd.Series,
    v1b_scale: pd.Series,
    end_scale: float,
    snapshot_date: pd.Timestamp,
    output: Path,
) -> None:
    last_date = pd.Timestamp(snapshot_date)
    if last_date not in prices.index:
        last_date = prices.loc[:last_date].index[-1]

    regimes = smooth_regimes(classify_regimes(prices), min_run_days=90)
    last_price = float(prices.loc[last_date])

    fig, axes = plt.subplots(4, 1, figsize=(13, 16), sharex=False)
    fig.suptitle(
        "EQM v1b (tail ramp) vs v1c (no tail ramp)",
        fontsize=14,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.965,
        (
            f"{last_date.date()} (close)  ·  v1b tailScale→{end_scale:.3f} @ "
            f"{CQM_DEFAULTS['qr_calibration_date']}  ·  v1c tailScale=1.0  ·  global fair-value risk"
        ),
        ha="center",
        fontsize=10,
        style="italic",
        color="#555555",
    )

    # --- Panel 1: QR 50% fair value ---
    ax = axes[0]
    shade_regimes(ax, regimes)
    ax.plot(prices.index, prices, color="black", lw=0.9, zorder=3, label="BTC price")
    ax.plot(
        v1b_qr[0.5].index,
        v1b_qr[0.5],
        color="#e0a81f",
        lw=1.4,
        ls=(0, (4, 3)),
        zorder=4,
        label="v1b QR 50% (tail-scaled)",
    )
    ax.plot(
        v1c_qr[0.5].index,
        v1c_qr[0.5],
        color="#5c3d99",
        lw=1.4,
        zorder=5,
        label="v1c QR 50% (raw)",
    )
    ax.set_yscale("log")
    ax.set_ylabel("USD")
    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.legend(loc="upper left", fontsize=7, framealpha=0.9)
    panel_label(ax, "Fair-value QR 50%")
    v1b_fair = float(v1b_qr[0.5].loc[last_date])
    v1c_fair = float(v1c_qr[0.5].loc[last_date])
    scale_now = float(v1b_scale.loc[last_date])
    snapshot_box(
        ax,
        [
            ("Price", money(last_price)),
            ("v1b QR 50%", money(v1b_fair)),
            ("v1c QR 50%", money(v1c_fair)),
            ("v1b tailScale", f"×{scale_now:.3f}"),
            ("Spread", f"{100 * (v1c_fair / v1b_fair - 1):+.1f}%"),
        ],
    )

    # --- Panel 2: gold SMA (solid band) ---
    ax = axes[1]
    shade_regimes(ax, regimes)
    ax.plot(prices.index, prices, color="black", lw=0.8, zorder=3)
    ax.plot(v1b_gold.index, v1b_gold, color="#d9c95b", lw=1.2, ls=(0, (4, 3)), label="v1b gold SMA")
    ax.plot(v1c_gold.index, v1c_gold, color="#7aa3d4", lw=1.2, label="v1c gold SMA")
    ax.set_yscale("log")
    ax.set_ylabel("USD")
    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.legend(loc="upper left", fontsize=7, framealpha=0.9)
    panel_label(ax, f"Solid gold band (SMA {int(CQM_DEFAULTS['fair_gold_sma_weeks'])}w blend)")
    snapshot_box(
        ax,
        [
            ("v1b gold", money(float(v1b_gold.loc[last_date]))),
            ("v1c gold", money(float(v1c_gold.loc[last_date]))),
        ],
    )

    # --- Panel 3: risk time series ---
    ax = axes[2]
    shade_regimes(ax, regimes)
    v1b_risk_pct = v1b_signals["risk_global"].to_numpy(dtype=float) * 100.0
    v1c_risk_pct = v1c_signals["risk_global"].to_numpy(dtype=float) * 100.0
    ax.plot(v1b_signals.index, v1b_risk_pct, color="#e0a81f", lw=1.5, label="v1b global risk")
    ax.plot(v1c_signals.index, v1c_risk_pct, color="#5c3d99", lw=1.5, label="v1c global risk")
    ax.axhline(50.0, color="#999999", lw=0.6, ls=":", zorder=2)
    ax.set_ylim(-2, 102)
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2, zorder=1)
    ax.legend(loc="upper left", fontsize=7, framealpha=0.9)
    panel_label(ax, "Global fair-value risk over time")
    delta_pp = float(v1c_signals["risk_global"].loc[last_date] - v1b_signals["risk_global"].loc[last_date]) * 100
    snapshot_box(
        ax,
        [
            ("v1b risk", pct(float(v1b_signals["risk_global"].loc[last_date]))),
            ("v1c risk", pct(float(v1c_signals["risk_global"].loc[last_date]))),
            ("Δ v1c−v1b", f"{delta_pp:+.1f}pp"),
        ],
        corner="top_right",
    )

    # --- Panel 4: risk delta ---
    ax = axes[3]
    shade_regimes(ax, regimes)
    delta_series = (v1c_signals["risk_global"] - v1b_signals["risk_global"]) * 100.0
    ax.fill_between(
        delta_series.index,
        0.0,
        delta_series,
        where=delta_series >= 0,
        color="#5c3d99",
        alpha=0.35,
        interpolate=True,
        label="v1c higher",
    )
    ax.fill_between(
        delta_series.index,
        0.0,
        delta_series,
        where=delta_series < 0,
        color="#e0a81f",
        alpha=0.35,
        interpolate=True,
        label="v1b higher",
    )
    ax.plot(delta_series.index, delta_series, color="#333333", lw=0.9, zorder=4)
    ax.axhline(0.0, color="#666666", lw=0.8, zorder=3)
    ax.set_ylabel("Δ risk (pp)")
    ax.set_xlabel("Date")
    ax.grid(True, alpha=0.2, zorder=1)
    ax.legend(loc="upper left", fontsize=7, framealpha=0.9)
    panel_label(ax, "Risk delta (v1c − v1b)")
    snapshot_box(
        ax,
        [
            ("Mean Δ", f"{float(delta_series.mean()):+.1f}pp"),
            ("Max Δ", f"{float(delta_series.max()):+.1f}pp"),
            ("Min Δ", f"{float(delta_series.min()):+.1f}pp"),
            (f"At {last_date.date()}", f"{float(delta_series.loc[last_date]):+.1f}pp"),
        ],
    )

    for ax in axes[:3]:
        ax.xaxis.set_major_locator(mdates.YearLocator(2))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=180)
    plt.close(fig)


def plot_risk_curve_compare(
    prices: pd.Series,
    v1b_signals: pd.DataFrame,
    v1c_signals: pd.DataFrame,
    v1b_fair: pd.Series,
    v1c_fair: pd.Series,
    v1b_risk_fit,
    v1c_risk_fit,
    snapshot_date: pd.Timestamp,
    output: Path,
) -> None:
    """Risk-vs-price curves for both models at the snapshot date."""
    last_date = pd.Timestamp(snapshot_date)
    if last_date not in prices.index:
        last_date = prices.loc[:last_date].index[-1]
    last_price = float(prices.loc[last_date])

    fig, ax = plt.subplots(1, 1, figsize=(13, 5))
    fig.suptitle(
        f"Risk vs Price — v1b vs v1c ({last_date.date()})",
        fontsize=13,
        fontweight="bold",
    )

    for label, fair, risk_fit, color in [
        ("v1b", v1b_fair, v1b_risk_fit, "#e0a81f"),
        ("v1c", v1c_fair, v1c_risk_fit, "#5c3d99"),
    ]:
        p_lo = price_for_risk_fair(risk_fit, fair, last_date, 0.0)
        p_hi = price_for_risk_fair(risk_fit, fair, last_date, 1.0)
        grid = np.linspace(max(p_lo * 0.5, 1.0), p_hi * 1.10, 400)
        risks = np.array([risk_for_price_fair(risk_fit, fair, last_date, float(p)) for p in grid]) * 100.0
        ax.plot(grid, risks, color=color, lw=2.0, label=f"{label} curve")
        risk_at_price = float(
            v1b_signals.loc[last_date, "risk_global"]
            if label == "v1b"
            else v1c_signals.loc[last_date, "risk_global"]
        ) * 100.0
        ax.scatter([last_price], [risk_at_price], color=color, s=40, zorder=5, edgecolors="white", linewidths=1.0)

    ax.set_xlim(left=0)
    ax.set_ylim(-2, 102)
    ax.set_xlabel("USD")
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2)
    ax.legend(loc="upper right", fontsize=8)
    panel_label(ax, "EQM Risk as a Function of Price")
    snapshot_box(
        ax,
        [
            ("Price", money(last_price)),
            ("v1b risk", pct(float(v1b_signals["risk_global"].loc[last_date]))),
            ("v1c risk", pct(float(v1c_signals["risk_global"].loc[last_date]))),
        ],
    )

    fig.tight_layout(rect=[0, 0, 1, 0.96])
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=180)
    plt.close(fig)


def print_v1b_v1c_table(
    v1b_signals: pd.DataFrame,
    v1c_signals: pd.DataFrame,
    dates: list[str],
) -> None:
    print("\nRisk comparison (v1b tail ramp vs v1c raw QR)")
    print(
        f"{'Date':<12} {'Price':>10} {'v1b':>10} {'v1c':>10} {'Δ':>8} "
        f"{'v1b fair':>10} {'v1c fair':>10} {'BTCAnalytica':>14}"
    )
    print("-" * 88)
    for ds in dates:
        d = pd.Timestamp(ds)
        if d not in v1b_signals.index or d not in v1c_signals.index:
            continue
        price = float(v1b_signals.loc[d, "price"])
        r1b = float(v1b_signals.loc[d, "risk_global"])
        r1c = float(v1c_signals.loc[d, "risk_global"])
        ref = REFERENCE_RISK.get(ds)
        ref_s = pct(ref) if ref is not None else "n/a"
        print(
            f"{ds:<12} {money(price):>10} {pct(r1b):>10} {pct(r1c):>10} "
            f"{100 * (r1c - r1b):+7.1f}pp {money(float(v1b_signals.loc[d, 'fair'])):>10} "
            f"{money(float(v1c_signals.loc[d, 'fair'])):>10} {ref_s:>14}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="EQM v1c experiment — raw QR fan without tail calibration ramp",
    )
    parser.add_argument("--local-json", default=str(DEFAULT_LOCAL_JSON))
    parser.add_argument("--fetch-binance-tail", action="store_true")
    parser.add_argument("--start-history", default="2014-01-01")
    parser.add_argument("--snapshot-date", help="Snapshot date; defaults to last price")
    parser.add_argument("--plot", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--compare-plot", default=str(DEFAULT_COMPARE))
    args = parser.parse_args()

    class _Args:
        pass

    load_args = _Args()
    load_args.csv = None
    load_args.fetch_stooq = False
    load_args.fetch_binance_tail = args.fetch_binance_tail
    load_args.local_json = args.local_json
    load_args.date_col = "date"
    load_args.price_col = "close"
    load_args.start_history = args.start_history

    prices = load_prices(load_args)
    prices_full = load_prices_full(load_args)
    cfg = production_cfg()

    print("Fitting asymmetric QR (full history)...")
    asym_fit = fit_asymmetric_quantile_bands(prices_full)
    asym_frame = asymmetric_quantile_frame(asym_fit, prices.index, [0.001, 0.5, 0.999])

    # v1b: production tail-scaled fan
    v1b_qr, v1b_scale = build_qr_scaled_frame(asym_frame)
    end_scale = float(v1b_scale.iloc[-1])

    # v1c: no tail ramp
    v1c_qr, v1c_scale = build_v1c_qr_frame(asym_frame)

    print(f"  v1b terminal tailScale ({cfg.calibration_date}): {end_scale:.4f}")
    print("  v1c tailScale: 1.0000 (constant)")

    base_fit = fit_eqm(prices)
    baseline_signals = full_sample_eqm_signals(base_fit, prices)

    v1b_gold, v1b_fair, v1b_risk_fit, v1b_signals = build_v1b_signals(prices, v1b_qr, base_fit, cfg)
    v1c_gold, v1c_fair, v1c_risk_fit, v1c_signals = build_v1b_signals(prices, v1c_qr, base_fit, cfg)

    snapshot_date = pd.Timestamp(args.snapshot_date) if args.snapshot_date else prices.index.max()
    compare_dates = sorted(
        set(REFERENCE_RISK)
        | {
            "2014-01-01",
            "2017-12-17",
            "2021-11-10",
            "2022-01-01",
            "2024-03-14",
            str(snapshot_date.date()),
        }
    )

    scale_at_snapshot = float(v1b_scale.loc[snapshot_date])
    plot_eqm_v1b(
        prices,
        v1c_signals,
        v1c_gold,
        v1c_fair,
        v1c_qr,
        v1c_risk_fit,
        Path(args.plot),
        snapshot_date,
        "raw QR (tailScale = 1.0, no calibration ramp)",
        1.0,
        cfg,
        chart_label="v1c",
    )
    print(f"Saved v1c chart: {args.plot}")

    compare_path = Path(args.compare_plot)
    plot_v1b_v1c_compare(
        prices,
        v1b_signals,
        v1c_signals,
        v1b_qr,
        v1c_qr,
        v1b_gold,
        v1c_gold,
        v1b_scale,
        end_scale,
        snapshot_date,
        compare_path,
    )
    print(f"Saved comparison chart: {compare_path}")

    curve_path = compare_path.with_name("eqm_compare_v1b_v1c_risk_curve.png")
    plot_risk_curve_compare(
        prices,
        v1b_signals,
        v1c_signals,
        v1b_fair,
        v1c_fair,
        v1b_risk_fit,
        v1c_risk_fit,
        snapshot_date,
        curve_path,
    )
    print(f"Saved risk-curve comparison: {curve_path}")

    risk_csv = Path(args.plot).with_name("eqm_v1c_risk_series.csv")
    v1c_signals.to_csv(risk_csv)
    print(f"Saved v1c risk CSV: {risk_csv}")

    merged = pd.DataFrame(
        {
            "price": prices,
            "v1b_fair": v1b_fair,
            "v1c_fair": v1c_fair,
            "v1b_risk": v1b_signals["risk_global"],
            "v1c_risk": v1c_signals["risk_global"],
            "risk_delta_pp": (v1c_signals["risk_global"] - v1b_signals["risk_global"]) * 100.0,
            "v1b_tail_scale": v1b_scale,
        }
    )
    merged_csv = Path(args.plot).with_name("eqm_v1b_v1c_risk_compare.csv")
    merged.to_csv(merged_csv)
    print(f"Saved merged compare CSV: {merged_csv}")

    ols_trend = ols_trend_series(base_fit, prices.index)
    print(f"\nv1c snapshot for {snapshot_date.date()} (global risk vs QR 50%)")
    print(f"  BTC price:       {money(float(prices.loc[snapshot_date]))}")
    print(f"  v1c QR 50%:      {money(float(v1c_fair.loc[snapshot_date]))}")
    print(f"  v1b QR 50%:      {money(float(v1b_fair.loc[snapshot_date]))}  (tail ×{scale_at_snapshot:.3f})")
    print(f"  v1c gold SMA:    {money(float(v1c_gold.loc[snapshot_date]))}")
    print(f"  OLS trend:       {money(float(ols_trend.loc[snapshot_date]))}")
    print(f"  v1c risk:        {pct(float(v1c_signals['risk_global'].loc[snapshot_date]))}")
    print(f"  v1b risk:        {pct(float(v1b_signals['risk_global'].loc[snapshot_date]))}")
    print(
        f"  Δ v1c−v1b:       {100 * float(v1c_signals['risk_global'].loc[snapshot_date] - v1b_signals['risk_global'].loc[snapshot_date]):+.1f}pp"
    )

    print_v1b_v1c_table(v1b_signals, v1c_signals, compare_dates)
    print_tuning_table(v1c_signals, compare_dates)
    print_comparison_table(baseline_signals, v1c_signals, compare_dates)


if __name__ == "__main__":
    main()
