#!/usr/bin/env python3
"""
CLI runner for the reverse-engineered BTC EQM prototype.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.collections import LineCollection
from matplotlib.colors import Normalize

from eqm_model import (
    DEFAULT_LOCAL_JSON,
    clean_price_series,
    current_snapshot,
    expanding_eqm_signals,
    fetch_stooq_btc,
    fit_eqm,
    fit_eqm_solid_bands,
    fit_quantile_regression,
    full_sample_eqm_signals,
    load_csv,
    load_local_json,
    load_local_plus_binance_tail,
    price_for_risk,
    quantile_regression_series,
    risk_for_price,
    run_risk_weighted_dca,
    solid_band_series,
)


REGIME_COLORS: dict[str, str] = {
    "bull": "#ffffff",
    "double_tap": "#ececec",
    "bear": "#cfcfcf",
}
REGIME_LABELS: dict[str, str] = {
    "bull": "Bull",
    "double_tap": "Double tap",
    "bear": "Bear",
}


def classify_regimes(prices: pd.Series) -> pd.Series:
    """Tag each day as bull / double_tap / bear based on drawdown from 365d high."""
    rolling_high = prices.rolling(365, min_periods=30).max()
    drawdown = prices / rolling_high - 1.0
    regime = pd.Series("bull", index=prices.index)
    regime[drawdown <= -0.10] = "double_tap"
    regime[drawdown <= -0.30] = "bear"
    return regime


def shade_regimes(ax, regimes: pd.Series) -> None:
    """Apply background shading for bull / double_tap / bear runs."""
    if regimes.empty:
        return
    runs: list[tuple[pd.Timestamp, pd.Timestamp, str]] = []
    start = regimes.index[0]
    current = regimes.iloc[0]
    for date, value in regimes.items():
        if value != current:
            runs.append((start, date, current))
            start = date
            current = value
    runs.append((start, regimes.index[-1], current))

    for run_start, run_end, label in runs:
        color = REGIME_COLORS[label]
        ax.axvspan(run_start, run_end, color=color, alpha=0.7, zorder=0, linewidth=0)


def colored_line(
    ax,
    dates: pd.DatetimeIndex,
    values: np.ndarray,
    cmap: str,
    vmin: float,
    vmax: float,
    color_values: np.ndarray | None = None,
) -> None:
    """Draw a line whose y-values can be colored by a separate signal."""
    if color_values is None:
        color_values = values
    x = mdates.date2num(dates.to_pydatetime())
    points = np.column_stack([x, values]).reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    lc = LineCollection(
        segments,
        cmap=cmap,
        norm=Normalize(vmin=vmin, vmax=vmax),
        linewidth=1.1,
        alpha=0.95,
    )
    lc.set_array(color_values[:-1])
    ax.add_collection(lc)
    ax.set_xlim(dates[0], dates[-1])


def smooth_band(series: pd.Series, window: int = 21) -> pd.Series:
    """Light centered rolling-mean smoothing for the solid EQM bands.

    The reverse-engineered shelved bands are piecewise-flat with sharp vertical
    steps at new ATHs / cycle transitions, which reads as "blocky" next to the
    BTCAnalytica original where the same bands are visibly rounded. A short
    centered moving average rounds those corners without shifting the level or
    erasing the deliberate deep-value dips in the green floor (so we do NOT
    force monotonicity here).
    """
    if window <= 1:
        return series
    return series.astype(float).rolling(window=window, center=True, min_periods=1).mean()


def panel_label(ax, text: str) -> None:
    """Render the panel title as a left-aligned bold subplot title."""
    ax.set_title(text, loc="left", fontsize=10, fontweight="bold", pad=4)


def snapshot_box(ax, lines: list[tuple[str, str]]) -> None:
    """Place a small key/value snapshot table in the bottom-right corner."""
    if not lines:
        return
    label_width = max(len(label) for label, _ in lines)
    value_width = max(len(value) for _, value in lines)
    formatted = "\n".join(
        f"{label.ljust(label_width)}  {value.rjust(value_width)}"
        for label, value in lines
    )
    ax.text(
        0.995,
        0.04,
        formatted,
        transform=ax.transAxes,
        fontsize=8,
        family="monospace",
        ha="right",
        va="bottom",
        zorder=6,
        bbox={
            "facecolor": "white",
            "edgecolor": "#bbbbbb",
            "alpha": 0.92,
            "pad": 3.5,
            "linewidth": 0.5,
        },
    )


def smooth_regimes(regimes: pd.Series, min_run_days: int = 90, max_passes: int = 50) -> pd.Series:
    """Suppress regime flips that don't last at least `min_run_days`.

    Each pass merges the single shortest run into its longer neighbour so the
    sequence is guaranteed to make progress and cannot oscillate indefinitely.
    """
    if regimes.empty:
        return regimes

    values = regimes.tolist()

    def collect_runs(seq: list[str]) -> list[tuple[int, int, str]]:
        runs: list[tuple[int, int, str]] = []
        if not seq:
            return runs
        start = 0
        for i in range(1, len(seq)):
            if seq[i] != seq[start]:
                runs.append((start, i, seq[start]))
                start = i
        runs.append((start, len(seq), seq[start]))
        return runs

    for _ in range(max_passes):
        runs = collect_runs(values)
        short_runs = [(idx, run) for idx, run in enumerate(runs) if (run[1] - run[0]) < min_run_days]
        if not short_runs:
            break
        idx, (a, b, _label) = min(short_runs, key=lambda item: item[1][1] - item[1][0])
        prev_run = runs[idx - 1] if idx > 0 else None
        next_run = runs[idx + 1] if idx + 1 < len(runs) else None
        if prev_run and next_run:
            replacement = prev_run[2] if (prev_run[1] - prev_run[0]) >= (next_run[1] - next_run[0]) else next_run[2]
        elif prev_run:
            replacement = prev_run[2]
        elif next_run:
            replacement = next_run[2]
        else:
            break
        for j in range(a, b):
            values[j] = replacement

    return pd.Series(values, index=regimes.index)


def trend_r_squared(prices: pd.Series, fit) -> float:
    """R^2 of log(price) vs the EQM trend at each date."""
    log_prices = np.log(prices.to_numpy(dtype=float))
    residuals = (log_prices - log_prices.mean())
    ss_tot = float(np.sum(residuals ** 2))
    if ss_tot == 0:
        return float("nan")
    ss_res = float(np.sum(fit.residuals.to_numpy(dtype=float) ** 2))
    return 1.0 - ss_res / ss_tot


def trend_risk_band(prices: pd.Series, window: int = 60) -> pd.DataFrame:
    """Local rolling envelope used as the EQM Trend-Risk proxy.

    Returns lower / median / upper of price over the rolling window.
    """
    rolling = prices.rolling(window, min_periods=max(window // 4, 10))
    df = pd.DataFrame(
        {
            "lower": rolling.quantile(0.10),
            "median": rolling.median(),
            "upper": rolling.quantile(0.90),
        }
    )
    return df


def trend_risk_r_squared(prices: pd.Series, band: pd.DataFrame) -> float:
    """R^2 of log(price) vs the rolling Trend-Risk median."""
    aligned = pd.concat([np.log(prices), np.log(band["median"])], axis=1).dropna()
    if aligned.empty:
        return float("nan")
    y = aligned.iloc[:, 0].to_numpy(dtype=float)
    y_hat = aligned.iloc[:, 1].to_numpy(dtype=float)
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    if ss_tot == 0:
        return float("nan")
    ss_res = float(np.sum((y - y_hat) ** 2))
    return 1.0 - ss_res / ss_tot


def money(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    abs_value = abs(value)
    if abs_value >= 1_000_000:
        return f"${value / 1_000_000:,.2f}M"
    if abs_value >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.2f}"


def pct(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value * 100:,.1f}%"


def parse_float_list(value: str) -> list[float]:
    return [float(part.strip()) for part in value.split(",") if part.strip()]


def load_prices(args: argparse.Namespace) -> pd.Series:
    if args.csv:
        return clean_price_series(load_csv(Path(args.csv), args.date_col, args.price_col), start=args.start_history)
    if args.fetch_stooq:
        return clean_price_series(fetch_stooq_btc(), start=args.start_history)
    if args.fetch_binance_tail:
        return clean_price_series(load_local_plus_binance_tail(Path(args.local_json)), start=args.start_history)
    return clean_price_series(load_local_json(Path(args.local_json)), start=args.start_history)


def print_snapshot(snapshot: dict[str, float], date: pd.Timestamp) -> None:
    print(f"\nEQM snapshot for {date.date()}")
    print(f"  BTC price:      {money(snapshot['price'])}")
    print(f"  EQM score:      {snapshot['score']:.3f}")
    print(f"  EQM risk:       {pct(snapshot['risk'])}")
    print(f"  0% risk price:  {money(snapshot['eqm_0_1_pct'])}")
    print(f" 10% risk price:  {money(snapshot['eqm_10_pct'])}")
    print(f" 25% risk price:  {money(snapshot['eqm_25_pct'])}")
    print(f" 50% risk price:  {money(snapshot['eqm_50_pct'])}")
    print(f" 75% risk price:  {money(snapshot['eqm_75_pct'])}")
    print(f" 90% risk price:  {money(snapshot['eqm_90_pct'])}")
    print(f"100% risk price:  {money(snapshot['eqm_99_9_pct'])}")


def plot_eqm(
    prices: pd.Series,
    signals: pd.DataFrame,
    fit,
    qr_fit,
    output: Path,
    title_suffix: str,
    price_band_risks: list[float],
    qr_quantiles: list[float],
    snapshot_date: pd.Timestamp | None = None,
    solid_fit=None,
    band_smooth_window: int = 21,
) -> None:
    dates = prices.index
    last_date = pd.Timestamp(snapshot_date) if snapshot_date is not None else dates[-1]
    if last_date not in prices.index:
        last_date = prices.loc[:last_date].index[-1]
    last_price = float(prices.loc[last_date])

    regimes = smooth_regimes(classify_regimes(prices), min_run_days=90)
    band_r2 = trend_r_squared(prices, fit)
    trend_band = trend_risk_band(prices, window=60)
    composite_r2 = trend_risk_r_squared(prices, trend_band)

    fig, axes = plt.subplots(5, 1, figsize=(13, 18), sharex=False)
    fig.suptitle(
        f"Bitcoin Empirical Quantile Model (EQM) — Replica  {title_suffix}",
        fontsize=14,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.962,
        f"{last_date.date()} (close)  ·  calibrated against @BTCAnalytica reference",
        ha="center",
        fontsize=10,
        style="italic",
        color="#555555",
    )

    band_colors = ["#2ca02c", "#d9c95b", "#b2182b"]
    band_labels = ["EQM 0.1%", "EQM 50%", "EQM 99.9%"]
    band_keys = ["lower", "median", "upper"]

    # --- Panel 1: EQM Price Bands ---
    ax = axes[0]
    shade_regimes(ax, regimes)
    ax.plot(prices.index, prices, color="black", lw=0.9, zorder=3)
    solid_band_values: dict[str, pd.Series] = {}
    if solid_fit is not None:
        for key, color, label in zip(band_keys, band_colors, band_labels, strict=True):
            band = smooth_band(solid_band_series(solid_fit, dates, key), window=band_smooth_window)
            ax.plot(band.index, band, color=color, lw=1.6, zorder=4, label=label, solid_capstyle="round")
            solid_band_values[key] = band
    else:
        for risk, color, label in zip(price_band_risks, band_colors, band_labels, strict=False):
            band = pd.Series([price_for_risk(fit, date, risk) for date in dates], index=dates)
            ax.plot(band.index, band, color=color, lw=1.6, zorder=4, label=label, solid_capstyle="round")
            solid_band_values[label] = band

    # Dashed quantile-regression trendlines (the smooth parabolic "QR" fan).
    # The yellow median QR trendline is the one called out in the reference
    # legend; render it as a distinct dotted goldenrod so it reads separately
    # from the solid gold EQM-50% band that it crosses.
    qr_band_values: dict[float, pd.Series] = {}
    if qr_fit is not None:
        qr_colors = {0.001: "#2ca02c", 0.5: "#e0a81f", 0.999: "#b2182b"}
        for quantile in qr_quantiles:
            color = qr_colors.get(quantile, "#888888")
            is_median = abs(quantile - 0.5) < 1e-9
            ax.plot(
                quantile_regression_series(qr_fit, dates, quantile).index,
                quantile_regression_series(qr_fit, dates, quantile),
                color=color,
                lw=1.3 if is_median else 1.0,
                ls=(0, (1, 1.6)),
                alpha=0.95 if is_median else 0.8,
                zorder=5 if is_median else 4,
                label=f"QR {quantile:.1%}",
            )
            qr_band_values[quantile] = quantile_regression_series(qr_fit, dates, quantile)
    ax.set_yscale("log")
    ax.set_ylabel("USD")
    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.legend(loc="upper right", ncol=2, fontsize=7, framealpha=0.85, bbox_to_anchor=(1.0, 1.0))
    panel_label(ax, f"EQM Price Bands  (R²={band_r2:.4f})")

    snap_lines: list[tuple[str, str]] = [("Price", money(last_price))]
    for key, label in [("median", "EQM 50%"), ("lower", "EQM 0.1%"), ("upper", "EQM 99.9%")]:
        if key in solid_band_values:
            value = float(solid_band_values[key].loc[last_date])
            snap_lines.append((label, money(value)))
    for quantile in [0.5, 0.001, 0.999]:
        if quantile in qr_band_values:
            value = float(qr_band_values[quantile].loc[last_date])
            snap_lines.append((f"EQM QR {quantile:.1%}", money(value)))
    snapshot_box(ax, snap_lines)

    # --- Panel 2: EQM Trend-Risk Composite ---
    ax = axes[1]
    shade_regimes(ax, regimes)
    ax.plot(prices.index, prices, color="black", lw=0.8, zorder=3)
    ax.fill_between(
        trend_band.index,
        trend_band["lower"],
        trend_band["upper"],
        color="#7aa3d4",
        alpha=0.30,
        zorder=2,
        label="60d trend-risk envelope",
    )
    ax.plot(trend_band.index, trend_band["median"], color="#3a6ea0", lw=1.0, zorder=4, label="60d trend-risk median")
    if qr_fit is not None:
        for quantile in qr_quantiles:
            color = {0.001: "#2ca02c", 0.5: "#d9c95b", 0.999: "#b2182b"}.get(quantile, "#888888")
            band = quantile_regression_series(qr_fit, dates, quantile)
            ax.plot(band.index, band, color=color, lw=0.9, ls=(0, (4, 3)), alpha=0.7, zorder=4)
    ax.set_yscale("log")
    ax.set_ylabel("USD")
    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.legend(loc="upper right", fontsize=7, framealpha=0.85, bbox_to_anchor=(1.0, 1.0))
    panel_label(ax, f"EQM Trend-Risk Composite  (R²={composite_r2:.4f})")

    trend_value = float(trend_band["median"].loc[:last_date].dropna().iloc[-1])
    snapshot_box(
        ax,
        [
            ("Price", money(last_price)),
            ("EQM Trend-Risk", money(trend_value)),
        ],
    )

    # --- Panel 3: EQM Score ---
    ax = axes[2]
    shade_regimes(ax, regimes)
    score_values = signals["score"].to_numpy(dtype=float)
    score_color_values = signals["risk"].to_numpy(dtype=float)
    colored_line(
        ax,
        signals.index,
        score_values,
        cmap="RdYlGn_r",
        vmin=0.0,
        vmax=1.0,
        color_values=score_color_values,
    )
    ax.axhline(0.5, color="#999999", lw=0.6, ls=":", zorder=2)
    ax.set_ylim(-0.02, 1.02)
    ax.set_ylabel("Score")
    ax.grid(True, alpha=0.2, zorder=1)
    panel_label(ax, "EQM Score")
    last_score = float(signals["score"].loc[:last_date].iloc[-1])
    snapshot_box(ax, [("EQM Score", f"{last_score:.3f}")])

    # --- Panel 4: EQM Risk ---
    ax = axes[3]
    shade_regimes(ax, regimes)
    risk_values = signals["risk"].to_numpy(dtype=float) * 100.0
    colored_line(ax, signals.index, risk_values, cmap="RdYlGn_r", vmin=0.0, vmax=100.0)
    ax.axhline(50.0, color="#999999", lw=0.6, ls=":", zorder=2)
    ax.set_ylim(-2, 102)
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2, zorder=1)
    panel_label(ax, "EQM Risk")
    last_risk = float(signals["risk"].loc[:last_date].iloc[-1])
    snapshot_box(ax, [("EQM Risk", f"{last_risk * 100:.1f}%")])

    # --- Panel 5: EQM Risk as a Function of Price ---
    ax = axes[4]
    p_lo = price_for_risk(fit, last_date, 0.0)
    p_hi = price_for_risk(fit, last_date, 1.0)
    grid_prices = np.linspace(p_lo * 0.5, p_hi * 1.10, 600)
    grid_risks = np.array([risk_for_price(fit, last_date, float(p)) for p in grid_prices])
    points = np.column_stack([grid_prices, grid_risks * 100.0]).reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    lc = LineCollection(segments, cmap="RdYlGn_r", norm=Normalize(0.0, 1.0), linewidth=2.2)
    lc.set_array(grid_risks[:-1])
    ax.add_collection(lc)
    ax.scatter([last_price], [last_risk * 100.0], color="#222222", s=30, zorder=5, edgecolors="white", linewidths=1.2)
    ax.set_xlim(0, max(p_hi * 1.10, last_price * 1.20))
    ax.set_ylim(-2, 102)
    ax.set_xlabel("USD")
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2, zorder=1)
    panel_label(ax, "EQM Risk as a Function of Price")

    knot_lines: list[tuple[str, str]] = [("Price", money(last_price)), ("EQM Risk", f"{last_risk * 100:.1f}%")]
    for risk in [0.0, 0.10, 0.25, 0.50, 0.75, 0.90, 1.0]:
        knot_lines.append((f"EQM Risk {risk * 100:.0f}%", money(price_for_risk(fit, last_date, risk))))
    snapshot_box(ax, knot_lines)

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=180)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reverse-engineered Bitcoin EQM prototype")
    parser.add_argument("--local-json", default=str(DEFAULT_LOCAL_JSON), help="Path to local btc_daily.json")
    parser.add_argument("--csv", help="Optional CSV price file")
    parser.add_argument("--date-col", default="date", help="CSV date column")
    parser.add_argument("--price-col", default="close", help="CSV price column")
    parser.add_argument("--fetch-stooq", action="store_true", help="Fetch BTCUSD daily data from Stooq")
    parser.add_argument(
        "--fetch-binance-tail",
        action="store_true",
        help="Extend the local btc_daily.json history with the live Binance daily tail (BTCUSDT)",
    )
    parser.add_argument("--start-history", default="2014-01-01", help="Earliest BTC history to use")
    parser.add_argument("--snapshot-date", help="Date for current snapshot; defaults to last price")
    parser.add_argument(
        "--plot",
        default=str(Path(__file__).resolve().parent / "output" / "eqm_replica.png"),
        help="Output chart path",
    )
    parser.add_argument("--signals-mode", choices=["full-sample", "expanding"], default="full-sample")
    parser.add_argument("--min-history-days", type=int, default=1095, help="Minimum history for expanding signals")
    # Defaults below are the grid-search optimum (calibrate_eqm.py) against the
    # May 28, 2026 BTCAnalytica risk-price knots: log-RMSE 0.024 / MAPE ~1.9%,
    # vs 0.045 / 3.8% for the previous (0.60 / 0.06 / 0.68) values.
    parser.add_argument("--time-power", type=float, default=0.70, help="Power transform for days_since_start")
    parser.add_argument("--low-quantile", type=float, default=0.005, help="Lower residual anchor")
    parser.add_argument("--high-quantile", type=float, default=0.61, help="Upper residual anchor")
    parser.add_argument(
        "--score-power",
        type=float,
        default=1.0,
        help="Power transform applied to the independent pointy score oscillator",
    )
    parser.add_argument(
        "--score-lower-quantile",
        type=float,
        default=0.06,
        help="Lower residual anchor for the pointy EQM score",
    )
    parser.add_argument(
        "--score-upper-quantile",
        type=float,
        default=0.86,
        help=(
            "Upper residual anchor for the pointy EQM score. Re-tuned to 0.86 "
            "alongside time_power=0.70 so the snapshot score (~0.137) re-matches "
            "the reference 0.138 while keeping 2017/2021 peaks at 1.0."
        ),
    )
    parser.add_argument(
        "--price-band-risks",
        default="0,0.5,1",
        help="Solid EQM price-band risks to plot, comma-separated",
    )
    parser.add_argument(
        "--qr-quantiles",
        default="0.001,0.5,0.999",
        help="Dashed quantile-regression bands to fit/plot, comma-separated",
    )
    parser.add_argument("--no-qr", action="store_true", help="Disable quantile-regression fitting")
    parser.add_argument(
        "--band-smooth-window",
        type=int,
        default=21,
        help=(
            "Centered rolling-mean window (days) used to round the solid EQM "
            "bands for display so they match the smoother BTCAnalytica lines. "
            "Set 1 to disable smoothing."
        ),
    )
    parser.add_argument(
        "--solid-bands",
        action="store_true",
        default=True,
        help="Use the QR-median solid-band model for the green/gold/red price-band lines",
    )
    parser.add_argument(
        "--no-solid-bands",
        dest="solid_bands",
        action="store_false",
        help="Use the OLS-trend EQM Risk envelope for the green/gold/red price-band lines instead",
    )
    parser.add_argument(
        "--solid-low-tau",
        type=float,
        default=0.001,
        help="Empirical residual quantile for the solid lower band (default 0.001)",
    )
    parser.add_argument(
        "--solid-upper-ath-factor",
        type=float,
        default=1.28,
        help="Multiplier on rolling all-time-high used for the solid upper band (default 1.28)",
    )
    parser.add_argument(
        "--solid-gold-window",
        type=int,
        default=730,
        help=(
            "Rolling-window length (days) for the shelved-gold band: "
            "running_max(ATH(t) * Q0.5(price/ATH over last N days)). "
            "730 was the closest fit to the BTCAnalytica May 22, 2026 snapshot."
        ),
    )
    parser.add_argument(
        "--solid-green-half-life",
        type=float,
        default=1.0,
        help=(
            "Half-life in YEARS for the time-decayed weighted quantile that "
            "drives the shelved-green band. 1.0 was the closest fit to the "
            "BTCAnalytica May 22, 2026 snapshot ($45.4K → $46.2K, +1.8%%)."
        ),
    )
    parser.add_argument(
        "--solid-green-quantile",
        type=float,
        default=0.05,
        help=(
            "Quantile q for the time-decayed weighted Q_q(price/ATH) used by "
            "the shelved-green band. Default 0.05 mirrors the empirical "
            "lower envelope of recent BTC drawdown ratios."
        ),
    )
    parser.add_argument(
        "--solid-gold-floor-window",
        type=int,
        default=30,
        help=(
            "Rolling window (days) for the gold-band price-relative ceiling "
            "that pulls gold down during deep bear bottoms toward the "
            "realistic fair-value range."
        ),
    )
    parser.add_argument(
        "--solid-gold-floor-buffer",
        type=float,
        default=2.0,
        help=(
            "Multiplier on rolling-min price for the gold-band price-relative "
            "ceiling. 2.0 means gold is clipped at 2× the recent rolling-min "
            "price during bears (so it stays approximately between red and "
            "green) while NOT binding in bulls/corrections from peak (so the "
            "snapshot match is preserved)."
        ),
    )
    parser.add_argument(
        "--solid-green-floor-window",
        type=int,
        default=30,
        help=(
            "Rolling window (days) for the price-floor constraint that "
            "forces the green band below recent price during bear bottoms. "
            "30d matches the typical duration of a cycle low's basing pattern."
        ),
    )
    parser.add_argument(
        "--solid-green-floor-buffer",
        type=float,
        default=0.95,
        help=(
            "Multiplier on rolling-min price for the green-band price-floor "
            "constraint. 0.95 leaves a 5%% safety margin between the floor "
            "and the actual cycle low while preserving the snapshot match."
        ),
    )
    parser.add_argument("--backtest", action="store_true", help="Run risk-weighted DCA backtest")
    parser.add_argument("--backtest-start", default="2021-11-10", help="Backtest start date")
    parser.add_argument("--backtest-end", help="Backtest end date")
    parser.add_argument("--base-amount", type=float, default=500.0, help="Daily DCA base amount")
    args = parser.parse_args()

    prices = load_prices(args)
    fit = fit_eqm(
        prices,
        low_quantile=args.low_quantile,
        high_quantile=args.high_quantile,
        time_power=args.time_power,
        score_lower_quantile=args.score_lower_quantile,
        score_upper_quantile=args.score_upper_quantile,
        score_power=args.score_power,
    )
    price_band_risks = parse_float_list(args.price_band_risks)
    qr_quantiles = parse_float_list(args.qr_quantiles)
    qr_fit = None
    if not args.no_qr:
        print("\nFitting quantile regression bands...")
        qr_fit = fit_quantile_regression(prices, quantiles=qr_quantiles, time_power=args.time_power)
    solid_fit = None
    if args.solid_bands:
        print(
            "Fitting solid EQM bands "
            "(floor-clipped gold + green, ATH-anchored red)..."
        )
        solid_fit = fit_eqm_solid_bands(
            prices,
            low_tau=args.solid_low_tau,
            upper_ath_factor=args.solid_upper_ath_factor,
            time_power=args.time_power,
            gold_window=args.solid_gold_window,
            gold_floor_window=args.solid_gold_floor_window,
            gold_floor_buffer=args.solid_gold_floor_buffer,
            green_half_life_years=args.solid_green_half_life,
            green_quantile=args.solid_green_quantile,
            green_floor_window=args.solid_green_floor_window,
            green_floor_buffer=args.solid_green_floor_buffer,
        )
    snapshot_date = pd.Timestamp(args.snapshot_date) if args.snapshot_date else prices.index.max()
    snapshot = current_snapshot(fit, prices, snapshot_date)
    print_snapshot(snapshot, snapshot_date)

    if args.signals_mode == "expanding":
        print("\nComputing expanding-history signals. This can take a minute on long histories...")
        signals = expanding_eqm_signals(
            prices,
            min_history_days=args.min_history_days,
            low_quantile=args.low_quantile,
            high_quantile=args.high_quantile,
            time_power=args.time_power,
            score_lower_quantile=args.score_lower_quantile,
            score_upper_quantile=args.score_upper_quantile,
            score_power=args.score_power,
        )
        title_suffix = "(expanding-history signals)"
    else:
        signals = full_sample_eqm_signals(fit, prices)
        title_suffix = "(full-sample chart fit)"

    plot_eqm(
        prices,
        signals,
        fit,
        qr_fit,
        Path(args.plot),
        title_suffix,
        price_band_risks,
        qr_quantiles,
        snapshot_date=snapshot_date,
        solid_fit=solid_fit,
        band_smooth_window=args.band_smooth_window,
    )
    print(f"\nSaved chart: {args.plot}")

    if args.backtest:
        backtest, summary = run_risk_weighted_dca(
            signals,
            start=args.backtest_start,
            end=args.backtest_end,
            base_amount=args.base_amount,
        )
        backtest_path = Path(args.plot).with_name("eqm_dca_backtest.csv")
        backtest.to_csv(backtest_path)

        print("\nRisk-weighted DCA backtest")
        print(f"  Window:          {summary.start.date()} to {summary.end.date()}")
        print(f"  Base amount:     {money(summary.base_amount)}")
        print(f"  Final BTC:       {summary.final_btc:,.6f}")
        print(f"  Final cash:      {money(summary.final_cash)}")
        print(f"  Final equity:    {money(summary.final_equity)}")
        print(f"  Avg buy price:   {money(summary.avg_buy_price)}")
        print(f"  Avg sell price:  {money(summary.avg_sell_price)}")
        print(f"  Spread:          {money(summary.spread)}")
        print(f"  Max drawdown:    {pct(summary.max_drawdown)}")
        print(f"  Peak capital:    {money(summary.peak_capital)}")
        print(f"  Mean capital:    {money(summary.mean_capital)}")
        print(f"  CAGR peak cap:   {pct(summary.cagr_peak_capital)}")
        print(f"  CAGR mean cap:   {pct(summary.cagr_mean_capital)}")
        print(f"  Saved backtest:  {backtest_path}")


if __name__ == "__main__":
    main()
