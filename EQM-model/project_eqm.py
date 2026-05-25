#!/usr/bin/env python3
"""
Project the EQM model forward in time.

The model is a function of date. The OLS trend, the QR median, the solid
lower/upper bands, the dashed QR quantile bands and the risk-anchor prices
all extrapolate naturally to any future date because the only time-varying
ingredient is `days_since_start ** time_power`. The historical residual
distribution and the calibration anchors stay frozen.

Outputs:
- printed table of projected anchors at requested target dates
- optional fan chart extending the EQM Price Bands panel through the last
  target date (saved to EQM-model/output/eqm_projection.png by default)

This is NOT a forecast. Two important caveats:
1. The model assumes the historical residual distribution and the long-run
   `log(price) ~ days^p` growth shape continue to hold.
2. The solid upper band is anchored to the rolling all-time-high. For future
   dates we do not know what new ATHs would be printed, so the upper band is
   floored at `current_ATH * upper_ath_factor` and the QR median; if you
   assume a future cycle prints a new ATH you can override that anchor with
   `--assume-future-ath`.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from eqm_model import (
    DEFAULT_LOCAL_JSON,
    clean_price_series,
    fit_eqm,
    fit_eqm_solid_bands,
    fit_quantile_regression,
    load_local_json,
    price_for_risk,
    quantile_regression_series,
    solid_band_series,
    trend_log,
)


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "output" / "eqm_projection.png"
DEFAULT_TARGETS = ("2026-12-31", "2027-12-31", "2028-12-31", "2029-12-31")
RISK_KNOTS = (0.0, 0.25, 0.50, 0.75, 1.0)


def money(value: float) -> str:
    if not math.isfinite(value):
        return "n/a"
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.2f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.0f}"


def project_anchors(
    fit,
    qr_fit,
    solid_fit,
    targets: list[pd.Timestamp],
    assume_future_ath: float | None = None,
) -> pd.DataFrame:
    """Return a wide table with one column per target date and one row per anchor."""
    rows: dict[str, list[float]] = {}

    def add_row(label: str, values: list[float]) -> None:
        rows[label] = values

    ols_trend = [float(np.exp(trend_log(fit, [t])[0])) for t in targets]
    qr_median = [float(quantile_regression_series(qr_fit, [t], 0.5).iloc[0]) for t in targets]
    qr_001 = [float(quantile_regression_series(qr_fit, [t], 0.001).iloc[0]) for t in targets]
    qr_999 = [float(quantile_regression_series(qr_fit, [t], 0.999).iloc[0]) for t in targets]

    solid_lower = [float(solid_band_series(solid_fit, [t], "lower").iloc[0]) for t in targets]
    solid_median = [float(solid_band_series(solid_fit, [t], "median").iloc[0]) for t in targets]
    solid_upper_baseline = [
        float(solid_band_series(solid_fit, [t], "upper").iloc[0]) for t in targets
    ]
    if assume_future_ath is not None:
        forced_upper = float(assume_future_ath) * solid_fit.upper_ath_factor
        solid_upper = [max(v, forced_upper) for v in solid_upper_baseline]
    else:
        solid_upper = solid_upper_baseline

    risk_anchors: dict[float, list[float]] = {}
    for risk in RISK_KNOTS:
        risk_anchors[risk] = [price_for_risk(fit, t, risk) for t in targets]

    add_row("OLS trend (risk-model fair value)", ols_trend)
    add_row("QR median (gold solid)", qr_median)
    add_row("Solid 0.1% (green floor)", solid_lower)
    add_row("Solid 50% (gold median)", solid_median)
    add_row("Solid 99.9% (red ceiling)", solid_upper)
    add_row("QR 0.1% (green dashed)", qr_001)
    add_row("QR 99.9% (red dashed)", qr_999)
    for risk in RISK_KNOTS:
        add_row(f"Risk {int(risk * 100):>3}% price", risk_anchors[risk])

    df = pd.DataFrame(rows, index=[t.date().isoformat() for t in targets]).T
    df.index.name = "anchor"
    return df


def render_table(df: pd.DataFrame) -> str:
    headers = ["Anchor"] + list(df.columns)
    formatted_rows = [
        [str(idx)] + [money(float(v)) for v in row.values]
        for idx, row in df.iterrows()
    ]
    widths = [max(len(h), max(len(r[i]) for r in formatted_rows)) for i, h in enumerate(headers)]
    lines = ["  ".join(h.ljust(w) for h, w in zip(headers, widths))]
    lines.append("  ".join("-" * w for w in widths))
    for row in formatted_rows:
        lines.append("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))
    return "\n".join(lines)


def render_projection_chart(
    prices: pd.Series,
    fit,
    qr_fit,
    solid_fit,
    targets: list[pd.Timestamp],
    output_path: Path,
    title_suffix: str = "",
    assume_future_ath: float | None = None,
) -> None:
    history_dates = prices.index
    last_history_date = history_dates.max()
    last_target = max(targets)
    forward_dates = pd.date_range(history_dates.min(), last_target, freq="D")

    qr_low = quantile_regression_series(qr_fit, forward_dates, 0.001)
    qr_median = quantile_regression_series(qr_fit, forward_dates, 0.5)
    qr_high = quantile_regression_series(qr_fit, forward_dates, 0.999)

    solid_lower = solid_band_series(solid_fit, forward_dates, "lower")
    solid_median = solid_band_series(solid_fit, forward_dates, "median")
    solid_upper = solid_band_series(solid_fit, forward_dates, "upper")
    if assume_future_ath is not None:
        floor_future = float(assume_future_ath) * solid_fit.upper_ath_factor
        future_mask = solid_upper.index > last_history_date
        solid_upper = solid_upper.copy()
        solid_upper.loc[future_mask] = np.maximum(
            solid_upper.loc[future_mask].to_numpy(dtype=float),
            floor_future,
        )

    fig, ax = plt.subplots(figsize=(13, 7))
    ax.set_yscale("log")

    ax.plot(prices.index, prices, color="black", lw=0.9, zorder=4, label="BTC close")

    ax.plot(solid_lower.index, solid_lower, color="#2ca02c", lw=1.4, zorder=3, label="EQM 0.1% (solid)")
    ax.plot(solid_median.index, solid_median, color="#d9c95b", lw=1.4, zorder=3, label="EQM 50% (solid)")
    ax.plot(solid_upper.index, solid_upper, color="#b2182b", lw=1.4, zorder=3, label="EQM 99.9% (solid)")
    ax.plot(qr_low.index, qr_low, color="#2ca02c", lw=1.0, ls=(0, (4, 3)), alpha=0.7, zorder=3, label="QR 0.1% (dashed)")
    ax.plot(qr_median.index, qr_median, color="#d9c95b", lw=1.0, ls=(0, (4, 3)), alpha=0.7, zorder=3, label="QR 50% (dashed)")
    ax.plot(qr_high.index, qr_high, color="#b2182b", lw=1.0, ls=(0, (4, 3)), alpha=0.7, zorder=3, label="QR 99.9% (dashed)")

    ax.axvspan(last_history_date, last_target, color="#dddddd", alpha=0.35, zorder=1, label="projection window")
    ax.axvline(last_history_date, color="#444444", lw=0.8, ls=":", zorder=5)

    risk_50_at_targets = [price_for_risk(fit, t, 0.5) for t in targets]
    risk_0_at_targets = [price_for_risk(fit, t, 0.0) for t in targets]
    risk_100_at_targets = [price_for_risk(fit, t, 1.0) for t in targets]

    for t, p_lo, p_mid, p_hi in zip(targets, risk_0_at_targets, risk_50_at_targets, risk_100_at_targets):
        ax.axvline(t, color="#888888", lw=0.5, ls=":", zorder=2)
        ax.scatter([t, t, t], [p_lo, p_mid, p_hi], color=["#2ca02c", "#d9c95b", "#b2182b"], s=20, zorder=6, edgecolors="white", linewidths=0.6)
        ax.annotate(
            f" {t.year} fair {money(p_mid)}",
            xy=(t, p_mid),
            xytext=(4, 4),
            textcoords="offset points",
            fontsize=7,
            color="#444444",
        )

    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.set_ylabel("USD (log)")
    ax.set_title(f"EQM projection of BTC price {title_suffix}".strip(), fontsize=12, fontweight="bold")
    ax.legend(loc="upper left", ncol=2, fontsize=8, framealpha=0.85)
    fig.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def parse_targets(spec: str) -> list[pd.Timestamp]:
    return [pd.Timestamp(part.strip()) for part in spec.split(",") if part.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Project the EQM model forward in time.")
    parser.add_argument("--local-json", default=str(DEFAULT_LOCAL_JSON), help="Path to local btc_daily.json")
    parser.add_argument("--start-history", default="2014-01-01", help="Earliest BTC history to fit")
    parser.add_argument(
        "--targets",
        default=",".join(DEFAULT_TARGETS),
        help="Comma-separated future dates (yyyy-mm-dd)",
    )
    parser.add_argument(
        "--assume-future-ath",
        type=float,
        default=None,
        help=(
            "If set, treat this as the implied future ATH price and let the "
            "solid 99.9% band track it (price * upper_ath_factor). Useful for "
            "scenario analysis (e.g. 'what if the next cycle prints $250K?')."
        ),
    )
    parser.add_argument("--time-power", type=float, default=0.60, help="time^p exponent for QR and OLS trends")
    parser.add_argument("--low-quantile", type=float, default=0.06, help="EQM Risk lower-anchor residual quantile")
    parser.add_argument("--high-quantile", type=float, default=0.68, help="EQM Risk upper-anchor residual quantile")
    parser.add_argument("--score-power", type=float, default=1.0, help="EQM score exponent")
    parser.add_argument("--plot", default=str(DEFAULT_OUTPUT), help="Output projection chart path")
    parser.add_argument("--no-plot", action="store_true", help="Skip the projection chart")
    args = parser.parse_args()

    targets = parse_targets(args.targets)
    if not targets:
        raise SystemExit("Need at least one target date.")

    prices = clean_price_series(load_local_json(Path(args.local_json)), start=args.start_history)

    fit = fit_eqm(
        prices,
        low_quantile=args.low_quantile,
        high_quantile=args.high_quantile,
        time_power=args.time_power,
        score_power=args.score_power,
    )
    qr_fit = fit_quantile_regression(prices, quantiles=(0.001, 0.5, 0.999), time_power=args.time_power)
    solid_fit = fit_eqm_solid_bands(prices, time_power=args.time_power)

    last_history = prices.index.max()
    last_price = float(prices.loc[last_history])
    df = project_anchors(fit, qr_fit, solid_fit, targets, assume_future_ath=args.assume_future_ath)

    print(
        f"History: {prices.index.min().date()} -> {last_history.date()}  "
        f"(N={len(prices)})  current price = {money(last_price)}"
    )
    if args.assume_future_ath is not None:
        print(f"Scenario: assuming future ATH = {money(args.assume_future_ath)}  "
              f"-> solid 99.9% floor = {money(args.assume_future_ath * solid_fit.upper_ath_factor)}")
    else:
        rolling_ath = float(solid_fit.rolling_ath.iloc[-1])
        print(f"Realized ATH so far: {money(rolling_ath)}  "
              f"-> solid 99.9% floor = {money(rolling_ath * solid_fit.upper_ath_factor)} (no new ATH assumed)")
    print()
    print("Projected anchors at year-end targets:")
    print()
    print(render_table(df))

    if not args.no_plot:
        plot_path = Path(args.plot)
        title = "(2014..)" if args.assume_future_ath is None else f"(scenario: future ATH {money(args.assume_future_ath)})"
        render_projection_chart(
            prices,
            fit,
            qr_fit,
            solid_fit,
            targets,
            plot_path,
            title_suffix=title,
            assume_future_ath=args.assume_future_ath,
        )
        print()
        print(f"Saved projection chart: {plot_path}")


if __name__ == "__main__":
    main()
