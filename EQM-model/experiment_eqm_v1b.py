#!/usr/bin/env python3
"""
EQM v1b experiment — diagnostics atop the production fair-value model.

Production (eqm_model.py / web cqm.ts) now matches v1b: tail-scaled QR fan,
gold SMA display band, global fair-value risk. This script keeps extra tuning
panels and CLI flags (piecewise scale, linear-risk comparison, optional soft
gate) for research. Default anchor-boost flags are legacy; production uses
tail scale only.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass, replace
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.collections import LineCollection
from matplotlib.colors import Normalize

from eqm_model import (
    CQM_DEFAULTS,
    DEFAULT_LOCAL_JSON,
    EQMFit,
    apply_soft_gated_risk,
    asymmetric_quantile_frame,
    build_fair_value_gold,
    build_qr_scaled_frame as build_qr_scaled_frame_anchor,
    clean_price_series,
    compute_gate_blend_weight,
    empirical_percentile,
    fair_residuals,
    fit_asymmetric_quantile_bands,
    fit_eqm,
    full_sample_eqm_signals,
    gated_fair_risk_series,
    global_fair_risk_series,
    load_local_json,
    load_local_plus_binance_tail,
    make_fair_fit,
    price_for_risk_fair,
    risk_for_price_fair,
    risk_from_residual_percentile,
    rolling_empirical_percentiles,
    run_risk_weighted_dca,
    score_for_risk,
    trend_log,
)
from matplotlib.lines import Line2D
from run_eqm import (
    _raw_prices,
    classify_regimes,
    colored_line,
    fmt_quantile,
    load_prices,
    load_prices_full,
    money,
    panel_label,
    pct,
    shade_regimes,
    smooth_regimes,
    snapshot_box,
    trend_risk_band,
    trend_risk_r_squared,
)


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "output" / "eqm_replica_v1b.png"

# BTCAnalytica reference risk for comparison prints
REFERENCE_RISK: dict[str, float] = {
    "2026-05-09": 0.34,
    "2026-05-28": 0.264,
    "2026-06-06": 0.095,
}


@dataclass(frozen=True)
class V1BConfig:
    qr_display_scale: float | None = None
    qr_scale_mode: str = "anchor"  # "anchor" | "piecewise" | "linear" | "uniform"
    qr_anchor_date: str = "2014-01-01"
    qr_anchor_price: float = 220.0
    qr_anchor_converge_date: str = "2020-01-01"
    qr_scale_start_date: str = "2014-01-01"
    qr_scale_start_value: float = 1.0
    # Legacy localized bump (piecewise mode only).
    qr_scale_bump_peak: float = 1.25
    qr_scale_bump_start: str = "2014-01-01"
    qr_scale_bump_rise_end: str = "2015-06-01"
    qr_scale_bump_fall_start: str = "2017-06-01"
    qr_scale_bump_end: str = "2020-01-01"
    qr_scale_ramp_start_date: str = "2022-01-01"
    qr_scale_ramp_power: float = 1.0
    calibration_date: str = "2026-05-28"
    calibration_qr_median_usd: float = 100_800.0
    blend_price_weight: float = 0.5
    gold_sma_weeks: int = 20
    risk_driver: str = "qr50"  # "qr50" | "gold"
    use_soft_gate: bool = True
    risk_roll_days: int = int(CQM_DEFAULTS["risk_roll_days"])
    risk_gate_near_days: int = int(CQM_DEFAULTS["risk_gate_near_days"])
    risk_gate_near_buffer: float = float(CQM_DEFAULTS["risk_gate_near_buffer"])
    risk_gate_weight_power: float = float(CQM_DEFAULTS["risk_gate_weight_power"])
    risk_gate_global_floor: float = float(CQM_DEFAULTS["risk_gate_global_floor"])


def resolve_qr_end_scale(
    asym_frame: pd.DataFrame,
    cfg: V1BConfig,
    dates: pd.DatetimeIndex,
) -> float:
    """Terminal QR scale at the calibration date (e.g. ~0.84 on 2026-05-28)."""
    if cfg.qr_display_scale is not None:
        return float(cfg.qr_display_scale)
    cal = pd.Timestamp(cfg.calibration_date)
    if cal not in dates:
        cal = dates[dates <= cal][-1]
    raw = float(asym_frame.loc[cal, 0.5])
    return cfg.calibration_qr_median_usd / raw


def _lerp(a: float, b: float, t: float) -> float:
    return a + float(np.clip(t, 0.0, 1.0)) * (b - a)


def qr_bump_factor(d: pd.Timestamp, cfg: V1BConfig) -> float:
    """Trapezoidal boost: 1.0 outside 2014–2018, peaks in 2015–2017."""
    start = pd.Timestamp(cfg.qr_scale_bump_start)
    rise_end = pd.Timestamp(cfg.qr_scale_bump_rise_end)
    fall_start = pd.Timestamp(cfg.qr_scale_bump_fall_start)
    end = pd.Timestamp(cfg.qr_scale_bump_end)
    peak = float(cfg.qr_scale_bump_peak)

    if d < start or d > end:
        return 1.0
    if d <= rise_end:
        span = max((rise_end - start).days, 1)
        return _lerp(1.0, peak, (d - start).days / span)
    if d < fall_start:
        return peak
    span = max((end - fall_start).days, 1)
    return _lerp(peak, 1.0, (d - fall_start).days / span)


def qr_tail_ramp_factor(d: pd.Timestamp, cfg: V1BConfig, end_scale: float) -> float:
    """1.0 before 2022, then ramp to terminal calibration scale."""
    ramp_start = pd.Timestamp(cfg.qr_scale_ramp_start_date)
    cal = pd.Timestamp(cfg.calibration_date)
    power = float(cfg.qr_scale_ramp_power)

    if d < ramp_start:
        return 1.0
    if d >= cal:
        return float(end_scale)
    span = max((cal - ramp_start).days, 1)
    progress = ((d - ramp_start).days / span) ** power
    return _lerp(1.0, float(end_scale), progress)


def qr_tail_scale_series(
    dates: pd.DatetimeIndex,
    cfg: V1BConfig,
    end_scale: float,
) -> pd.Series:
    """Post-2022 calibration ramp only (no early bump)."""
    return pd.Series(
        [qr_tail_ramp_factor(pd.Timestamp(date), cfg, end_scale) for date in dates],
        index=dates,
        name="qr_tail_scale",
    )


def qr_anchor_scale_series(
    dates: pd.DatetimeIndex,
    raw_median: pd.Series,
    cfg: V1BConfig,
) -> pd.Series:
    """Early multiplier on the parabolic QR 50% curve.

    Scales the fitted parabola uniformly (per date) so it hits anchor_price at
    anchor_date, then smoothsteps the multiplier to 1.0 by converge_date. The
    log-price curve stays quadratic — no flat plateau from log-blending.
    """
    anchor = pd.Timestamp(cfg.qr_anchor_date)
    converge = pd.Timestamp(cfg.qr_anchor_converge_date)
    if anchor not in dates:
        anchor = dates[dates.get_indexer([anchor], method="nearest")[0]]
    raw_at_anchor = float(raw_median.loc[anchor])
    if not math.isfinite(raw_at_anchor) or raw_at_anchor <= 0:
        raise ValueError(f"invalid raw QR median at anchor date {anchor.date()}")
    peak_ratio = float(cfg.qr_anchor_price) / raw_at_anchor
    span = max((converge - anchor).days, 1)

    values: list[float] = []
    for date in dates:
        d = pd.Timestamp(date)
        if d <= anchor:
            values.append(peak_ratio)
        elif d >= converge:
            values.append(1.0)
        else:
            progress = (d - anchor).days / span
            w = 1.0 - progress
            w = w * w * (3.0 - 2.0 * w)  # smoothstep: 1 at anchor, 0 at converge
            values.append(1.0 + w * (peak_ratio - 1.0))
    return pd.Series(values, index=dates, name="qr_anchor_scale")


def build_qr_scaled_frame(
    asym_frame: pd.DataFrame,
    cfg: V1BConfig,
    end_scale: float,
) -> tuple[pd.DataFrame, pd.Series]:
    """Return scaled QR fan + the per-date scale profile used for diagnostics."""
    dates = asym_frame.index
    if cfg.qr_scale_mode == "anchor":
        return build_qr_scaled_frame_anchor(
            asym_frame,
            end_scale,
            anchor_date=cfg.qr_anchor_date,
            anchor_price=cfg.qr_anchor_price,
            converge_date=cfg.qr_anchor_converge_date,
            calibration_date=cfg.calibration_date,
            calibration_median_usd=cfg.calibration_qr_median_usd,
            ramp_start_date=cfg.qr_scale_ramp_start_date,
            ramp_power=cfg.qr_scale_ramp_power,
        )

    scale_profile = qr_scale_series(dates, cfg, end_scale)
    return scale_qr_frame(asym_frame, scale_profile), scale_profile


def qr_scale_series(
    dates: pd.DatetimeIndex,
    cfg: V1BConfig,
    end_scale: float,
) -> pd.Series:
    """Per-date QR scale.

    piecewise (default): localized 2014–2018 bump × post-2022 tail ramp.
      bump(d)  = 1.0 → peak → 1.0 between bump_start and bump_end
      tail(d)  = 1.0 until ramp_start, then → end_scale at calibration
      scale(d) = bump(d) × tail(d)
    linear: single ramp from start_date → calibration (legacy behaviour)
    """
    if cfg.qr_scale_mode == "uniform":
        return pd.Series(float(end_scale), index=dates, name="qr_scale")

    if cfg.qr_scale_mode == "piecewise":
        values = [
            qr_bump_factor(pd.Timestamp(date), cfg)
            * qr_tail_ramp_factor(pd.Timestamp(date), cfg, end_scale)
            for date in dates
        ]
        return pd.Series(values, index=dates, name="qr_scale")

    # linear
    cal = pd.Timestamp(cfg.calibration_date)
    power = float(cfg.qr_scale_ramp_power)
    start = pd.Timestamp(cfg.qr_scale_start_date)
    start_scale = float(cfg.qr_scale_start_value)
    span_days = max((cal - start).days, 1)
    values = []
    for date in dates:
        d = pd.Timestamp(date)
        if d <= start:
            values.append(start_scale)
        elif d >= cal:
            values.append(float(end_scale))
        else:
            progress = ((d - start).days / span_days) ** power
            values.append(start_scale + progress * (end_scale - start_scale))
    return pd.Series(values, index=dates, name="qr_scale")


def scale_qr_frame(frame: pd.DataFrame, scale: float | pd.Series) -> pd.DataFrame:
    if np.isscalar(scale):
        return frame.astype(float) * float(scale)
    aligned = scale.reindex(frame.index).ffill().bfill()
    return frame.astype(float).multiply(aligned, axis=0)


def format_qr_scale_label(scale_at_date: float, cfg: V1BConfig, end_scale: float) -> str:
    if cfg.qr_scale_mode == "uniform":
        return f"scaled QR ×{scale_at_date:.3f}"
    if cfg.qr_scale_mode == "anchor":
        return (
            f"QR 50% parabola ×scale @ ${cfg.qr_anchor_price:,.0f} "
            f"{cfg.qr_anchor_date[:4]}→{cfg.qr_anchor_converge_date[:4]}"
        )
    if cfg.qr_scale_mode == "piecewise":
        return (
            f"QR bump ×{cfg.qr_scale_bump_peak:.2f} "
            f"({cfg.qr_scale_bump_start[:4]}–{cfg.qr_scale_bump_end[:4]}) "
            f"· tail→{end_scale:.3f}"
        )
    return (
        f"QR scale ramp {cfg.qr_scale_start_value:.2f}→{end_scale:.3f} "
        f"({cfg.qr_scale_start_date}→{cfg.calibration_date})"
    )


def build_experimental_gold(
    prices: pd.Series,
    qr_fair: pd.Series,
    cfg: V1BConfig,
) -> pd.Series:
    return build_fair_value_gold(
        prices,
        qr_fair,
        blend_price_weight=cfg.blend_price_weight,
        gold_sma_weeks=cfg.gold_sma_weeks,
    ).rename("gold_v1b")


def risk_fair_series(cfg: V1BConfig, qr_scaled: pd.DataFrame, gold: pd.Series) -> pd.Series:
    if cfg.risk_driver == "gold":
        return gold
    return qr_scaled[0.5]


def risk_from_residual_percentile_linear(fit: EQMFit, residual_percentile: float) -> float:
    """Linear [0,1] map with fixed low/high quantile anchors (no cycle γ or high_q)."""
    span = fit.high_quantile - fit.low_quantile
    if math.isclose(span, 0.0):
        return float("nan")
    soft_z = (residual_percentile - fit.low_quantile) / span
    return float(np.clip(soft_z, 0.0, 1.0))


def risk_for_price_fair_linear(
    fit: EQMFit,
    fair: pd.Series,
    date: pd.Timestamp,
    price: float,
    window_days: int | None = None,
) -> float:
    date = pd.Timestamp(date)
    fair_level = float(fair.loc[date])
    if not math.isfinite(fair_level) or fair_level <= 0:
        return float("nan")
    residual = math.log(price) - math.log(fair_level)
    if window_days is None:
        hist = fit.residuals.dropna()
        residual_pct = empirical_percentile(hist, residual)
    else:
        hist = fit.residuals.loc[:date].tail(window_days).dropna()
        residual_pct = empirical_percentile(hist, residual)
    return risk_from_residual_percentile_linear(fit, residual_pct)


def v1b_global_risk_series(
    fit: EQMFit,
    prices: pd.Series,
    fair: pd.Series,
) -> pd.Series:
    return global_fair_risk_series(fit, prices, fair)


def v1b_linear_risk_series(
    fit: EQMFit,
    prices: pd.Series,
    fair: pd.Series,
) -> pd.Series:
    """Full-sample linear risk (fixed 6%/68% anchors, γ=1, no gate)."""
    return pd.Series(
        [
            risk_for_price_fair_linear(fit, fair, date, float(price))
            for date, price in prices.items()
        ],
        index=prices.index,
        name="risk_linear",
    )


def v1b_risk_series(
    fit: EQMFit,
    prices: pd.Series,
    fair: pd.Series,
    cfg: V1BConfig,
    global_risks: pd.Series | None = None,
) -> pd.Series:
    return gated_fair_risk_series(
        fit,
        prices,
        fair,
        global_risks=global_risks,
        roll_window_days=cfg.risk_roll_days,
        near_low_window_days=cfg.risk_gate_near_days,
        near_low_buffer=cfg.risk_gate_near_buffer,
        weight_power=cfg.risk_gate_weight_power,
        global_floor=cfg.risk_gate_global_floor,
        use_soft_gate=cfg.use_soft_gate,
    )


def expanding_v1b_signals(
    prices: pd.Series,
    qr_scaled: pd.DataFrame,
    gold: pd.Series,
    base_fit: EQMFit,
    cfg: V1BConfig,
    min_history_days: int = 1095,
) -> pd.DataFrame:
    """Causal no-lookahead v1b risk for backtest comparison."""
    rows: list[dict[str, float | pd.Timestamp]] = []

    for i in range(min_history_days, len(prices)):
        hist_prices = prices.iloc[: i + 1]
        hist_qr = qr_scaled[0.5].iloc[: i + 1]
        hist_gold = gold.iloc[: i + 1]
        fair_hist = hist_qr if cfg.risk_driver == "qr50" else hist_gold
        residuals = fair_residuals(hist_prices, fair_hist)
        fit = make_fair_fit(base_fit, residuals)

        date = hist_prices.index[-1]
        price = float(hist_prices.iloc[-1])
        fair_level = float(fair_hist.iloc[-1])
        if not math.isfinite(fair_level):
            continue

        residual = math.log(price) - math.log(fair_level)
        global_pct = empirical_percentile(residuals.dropna(), residual)
        global_risk = risk_from_residual_percentile(fit, date, global_pct)

        if cfg.use_soft_gate:
            roll_hist = residuals.tail(cfg.risk_roll_days).dropna()
            if len(roll_hist) >= max(cfg.risk_roll_days // 4, 30):
                roll_pct = empirical_percentile(roll_hist, residual)
                rolling_risk = risk_from_residual_percentile(fit, date, roll_pct)
                near_low = float(hist_prices.tail(cfg.risk_gate_near_days).min())
                weight = compute_gate_blend_weight(
                    price,
                    near_low,
                    near_low_buffer=cfg.risk_gate_near_buffer,
                )
                risk = apply_soft_gated_risk(
                    global_risk,
                    rolling_risk,
                    weight,
                    weight_power=cfg.risk_gate_weight_power,
                    global_floor=cfg.risk_gate_global_floor,
                ) if weight > 0 else global_risk
            else:
                risk = global_risk
        else:
            risk = global_risk

        rows.append(
            {
                "date": date,
                "price": price,
                "fair": fair_level,
                "risk": risk,
                "score": score_for_risk(risk, base_fit.score_power),
            }
        )

    return pd.DataFrame(rows).set_index("date")


def v1b_snapshot(
    fit: EQMFit,
    fair: pd.Series,
    prices: pd.Series,
    date: pd.Timestamp,
    cfg: V1BConfig,
) -> dict[str, float]:
    date = pd.Timestamp(date)
    price = float(prices.loc[date])
    risk = float(v1b_risk_series(fit, prices.loc[:date], fair.loc[:date], cfg).iloc[-1])
    return {
        "price": price,
        "fair": float(fair.loc[date]),
        "risk": risk,
        "score": score_for_risk(risk, fit.score_power),
        "eqm_0_pct": price_for_risk_fair(fit, fair, date, 0.0),
        "eqm_50_pct": price_for_risk_fair(fit, fair, date, 0.5),
        "eqm_100_pct": price_for_risk_fair(fit, fair, date, 1.0),
    }


def gold_trend_r_squared(prices: pd.Series, gold: pd.Series) -> float:
    """R² of log(price) explained by the v1b gold fair-value line."""
    aligned = pd.concat([np.log(prices), np.log(gold)], axis=1, keys=["y", "yhat"]).dropna()
    if aligned.empty:
        return float("nan")
    y = aligned["y"].to_numpy(dtype=float)
    y_hat = aligned["yhat"].to_numpy(dtype=float)
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    if ss_tot == 0:
        return float("nan")
    ss_res = float(np.sum((y - y_hat) ** 2))
    return 1.0 - ss_res / ss_tot


def parse_weeks_list(value: str) -> list[int]:
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def build_v1b_signals(
    prices: pd.Series,
    qr_scaled: pd.DataFrame,
    base_fit: EQMFit,
    cfg: V1BConfig,
) -> tuple[pd.Series, pd.Series, EQMFit, pd.DataFrame]:
    gold = build_experimental_gold(prices, qr_scaled[0.5], cfg)
    fair = risk_fair_series(cfg, qr_scaled, gold)
    risk_fit = make_fair_fit(base_fit, fair_residuals(prices, fair))
    risk_linear = v1b_linear_risk_series(risk_fit, prices, fair)
    risk_global = v1b_global_risk_series(risk_fit, prices, fair)
    risk_gated = v1b_risk_series(risk_fit, prices, fair, cfg, global_risks=risk_global)
    signals = pd.DataFrame(
        {
            "price": prices,
            "gold": gold,
            "fair": fair,
            "risk_linear": risk_linear,
            "risk_global": risk_global,
            "risk": risk_gated,
        }
    )
    signals["score"] = [score_for_risk(float(r), base_fit.score_power) for r in signals["risk"]]
    return gold, fair, risk_fit, signals


def print_sma_sweep_table(
    baseline: pd.DataFrame,
    sweep: dict[int, pd.DataFrame],
    dates: list[str],
) -> None:
    weeks_cols = sorted(sweep)
    header = f"{'Date':<12} {'Price':>10} {'Baseline':>10}"
    for w in weeks_cols:
        header += f" {f'{w}w':>8}"
    header += f" {'BTCAnalytica':>14}"
    print("\nSMA length sweep (full-sample risk)")
    print(header)
    print("-" * (44 + 9 * len(weeks_cols)))
    for ds in dates:
        d = pd.Timestamp(ds)
        if d not in baseline.index:
            continue
        price = float(baseline.loc[d, "price"])
        row = (
            f"{ds:<12} {money(price):>10} {pct(float(baseline.loc[d, 'risk'])):>10}"
        )
        for w in weeks_cols:
            sig = sweep[w]
            if d in sig.index:
                row += f" {pct(float(sig.loc[d, 'risk'])):>8}"
            else:
                row += f" {'n/a':>8}"
        ref = REFERENCE_RISK.get(ds)
        row += f" {pct(ref) if ref is not None else 'n/a':>14}"
        print(row)


def ols_trend_series(fit: EQMFit, dates: pd.DatetimeIndex) -> pd.Series:
    """Production CQM fair-value trend: exp(intercept + slope * days^time_power)."""
    return pd.Series(np.exp(trend_log(fit, dates)), index=dates, name="ols_trend")


def print_comparison_table(
    baseline: pd.DataFrame,
    v1b: pd.DataFrame,
    dates: list[str],
) -> None:
    print("\nRisk comparison (OLS baseline vs v1b fair-value risk)")
    print(f"{'Date':<12} {'Price':>10} {'OLS':>10} {'v1b':>10} {'BTCAnalytica':>14} {'Fair':>10}")
    print("-" * 72)
    for ds in dates:
        d = pd.Timestamp(ds)
        if d not in baseline.index or d not in v1b.index:
            continue
        price = float(baseline.loc[d, "price"])
        b_risk = float(baseline.loc[d, "risk"])
        v_risk = float(v1b.loc[d, "risk"])
        ref = REFERENCE_RISK.get(ds)
        ref_s = pct(ref) if ref is not None else "n/a"
        fair = float(v1b.loc[d, "fair"]) if "fair" in v1b.columns else float("nan")
        print(
            f"{ds:<12} {money(price):>10} {pct(b_risk):>10} {pct(v_risk):>10} "
            f"{ref_s:>14} {money(fair):>10}"
        )


def print_tuning_table(signals: pd.DataFrame, dates: list[str]) -> None:
    print("\nRisk tuning breakdown (linear → global → gated)")
    print(
        f"{'Date':<12} {'Linear':>10} {'Global':>10} {'Gated':>10} "
        f"{'Tuning Δ':>10} {'Gate Δ':>10} {'BTCAnalytica':>14}"
    )
    print("-" * 82)
    for ds in dates:
        d = pd.Timestamp(ds)
        if d not in signals.index:
            continue
        linear = float(signals.loc[d, "risk_linear"])
        global_r = float(signals.loc[d, "risk_global"])
        gated = float(signals.loc[d, "risk"])
        ref = REFERENCE_RISK.get(ds)
        ref_s = pct(ref) if ref is not None else "n/a"
        print(
            f"{ds:<12} {pct(linear):>10} {pct(global_r):>10} {pct(gated):>10} "
            f"{100 * (global_r - linear):+9.1f}pp {100 * (gated - global_r):+9.1f}pp {ref_s:>14}"
        )


def plot_eqm_v1b(
    prices: pd.Series,
    signals: pd.DataFrame,
    gold: pd.Series,
    fair: pd.Series,
    qr_scaled: pd.DataFrame,
    risk_fit: EQMFit,
    output: Path,
    snapshot_date: pd.Timestamp,
    qr_scale_label: str,
    scale_at_date: float,
    cfg: V1BConfig,
) -> None:
    dates = prices.index
    last_date = pd.Timestamp(snapshot_date)
    if last_date not in prices.index:
        last_date = prices.loc[:last_date].index[-1]
    last_price = float(prices.loc[last_date])
    last_qr50 = float(qr_scaled[0.5].loc[last_date])
    last_v1b_risk = float(signals["risk"].loc[last_date])
    last_fair = float(fair.loc[last_date])
    risk_driver_label = "QR 50%" if cfg.risk_driver == "qr50" else "gold SMA"

    regimes = smooth_regimes(classify_regimes(prices), min_run_days=90)
    band_r2 = gold_trend_r_squared(prices, fair)
    trend_band = trend_risk_band(prices, window=60)
    composite_r2 = trend_risk_r_squared(prices, trend_band)

    fig, axes = plt.subplots(5, 1, figsize=(13, 18), sharex=False)
    fig.suptitle(
        "Bitcoin Empirical Quantile Model (EQM) — v1b Experiment",
        fontsize=14,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.962,
        (
            f"{last_date.date()} (close)  ·  {qr_scale_label} (now ×{scale_at_date:.3f})  ·  "
            f"risk vs {risk_driver_label}  ·  "
            f"solid = SMA({cfg.gold_sma_weeks}w) blend"
        ),
        ha="center",
        fontsize=10,
        style="italic",
        color="#555555",
    )

    band_colors = ["#2ca02c", "#d9c95b", "#b2182b"]
    band_labels = ["EQM 0.1%", "EQM 50%", "EQM 99.9%"]

    # --- Panel 1: price bands ---
    ax = axes[0]
    shade_regimes(ax, regimes)
    ax.plot(prices.index, prices, color="black", lw=0.9, zorder=3)

    solid_lower = qr_scaled[0.001]
    solid_median = gold
    solid_upper = qr_scaled[0.999]
    for series, color, label in zip(
        [solid_lower, solid_median, solid_upper],
        band_colors,
        band_labels,
        strict=True,
    ):
        ax.plot(series.index, series, color=color, lw=1.6, zorder=4, label=label, solid_capstyle="round")

    asym_colors = {0.001: "#2ca02c", 0.5: "#e0a81f", 0.999: "#b2182b"}
    for quantile in [0.001, 0.5, 0.999]:
        series = qr_scaled[quantile]
        is_median = abs(quantile - 0.5) < 1e-9
        ax.plot(
            series.index,
            series,
            color=asym_colors[quantile],
            lw=1.3 if is_median else 1.0,
            ls=(0, (1, 1.6)),
            alpha=0.95 if is_median else 0.85,
            zorder=5 if is_median else 4,
            label=f"QR {fmt_quantile(quantile)}",
        )

    ax.set_yscale("log")
    ax.set_ylabel("USD")
    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.legend(loc="upper left", ncol=2, fontsize=6.5, framealpha=0.85, bbox_to_anchor=(0.0, 1.0))
    panel_label(ax, f"EQM Price Bands  (R²={band_r2:.4f})")
    snapshot_box(
        ax,
        [
            ("Price", money(last_price)),
            ("QR 50%", money(last_qr50)),
            ("EQM 50%", money(float(solid_median.loc[last_date]))),
            ("QR 0.1%", money(float(qr_scaled[0.001].loc[last_date]))),
            ("QR 99.9%", money(float(qr_scaled[0.999].loc[last_date]))),
            (f"{risk_driver_label} risk", f"{last_v1b_risk * 100:.1f}%"),
        ],
    )

    # --- Panel 2: trend-risk composite ---
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
    ax.plot(gold.index, gold, color="#d9c95b", lw=1.0, ls=(0, (4, 3)), alpha=0.85, zorder=4, label="v1b gold SMA")
    for quantile in [0.001, 0.5, 0.999]:
        ax.plot(
            qr_scaled[quantile].index,
            qr_scaled[quantile],
            color=asym_colors[quantile],
            lw=0.9,
            ls=(0, (4, 3)),
            alpha=0.7,
            zorder=4,
        )
    ax.set_yscale("log")
    ax.set_ylabel("USD")
    ax.grid(True, which="both", alpha=0.2, zorder=1)
    ax.legend(loc="upper left", fontsize=7, framealpha=0.85, bbox_to_anchor=(0.0, 1.0))
    panel_label(ax, f"EQM Trend-Risk Composite  (R²={composite_r2:.4f})")
    trend_value = float(trend_band["median"].loc[:last_date].dropna().iloc[-1])
    snapshot_box(
        ax,
        [
            ("Price", money(last_price)),
            ("QR 50%", money(last_qr50)),
            ("v1b Gold", money(float(gold.loc[last_date]))),
        ],
    )

    # --- Panel 3: linear vs cycle-tuned global risk (pre soft-gate) ---
    ax = axes[2]
    shade_regimes(ax, regimes)
    linear_risk_values = signals["risk_linear"].to_numpy(dtype=float) * 100.0
    global_risk_values = signals["risk_global"].to_numpy(dtype=float) * 100.0
    colored_line(ax, signals.index, linear_risk_values, cmap="RdYlGn_r", vmin=0.0, vmax=100.0)
    ax.plot(
        signals.index,
        global_risk_values,
        color="#5c3d99",
        lw=1.2,
        ls=(0, (5, 3)),
        alpha=0.95,
        zorder=5,
    )
    ax.axhline(50.0, color="#999999", lw=0.6, ls=":", zorder=2)
    ax.set_ylim(-2, 102)
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2, zorder=1)
    ax.legend(
        handles=[
            Line2D([0], [0], color="#d95f02", lw=2.0, label="Linear (6%/68%, γ=1)"),
            Line2D([0], [0], color="#5c3d99", lw=1.2, ls=(0, (5, 3)), label="Global (cycle γ + high_q)"),
        ],
        loc="upper left",
        fontsize=7,
        framealpha=0.85,
        bbox_to_anchor=(0.0, 1.0),
    )
    panel_label(ax, f"Risk Tuning  (vs {risk_driver_label}, pre-gate)")
    last_linear_risk = float(signals["risk_linear"].loc[last_date])
    last_global_risk = float(signals["risk_global"].loc[last_date])
    tuning_delta = last_global_risk - last_linear_risk
    gate_delta = last_v1b_risk - last_global_risk
    snapshot_box(
        ax,
        [
            ("Linear risk", f"{last_linear_risk * 100:.1f}%"),
            ("Global risk", f"{last_global_risk * 100:.1f}%"),
            ("Tuning Δ", f"{tuning_delta * 100:+.1f}pp"),
            ("Gated risk", f"{last_v1b_risk * 100:.1f}%"),
            ("Gate Δ", f"{gate_delta * 100:+.1f}pp"),
        ],
    )

    # --- Panel 4: risk ---
    ax = axes[3]
    shade_regimes(ax, regimes)
    risk_values = signals["risk"].to_numpy(dtype=float) * 100.0
    colored_line(ax, signals.index, risk_values, cmap="RdYlGn_r", vmin=0.0, vmax=100.0)
    ax.axhline(50.0, color="#999999", lw=0.6, ls=":", zorder=2)
    ax.set_ylim(-2, 102)
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2, zorder=1)
    ax.legend(
        handles=[Line2D([0], [0], color="#d95f02", lw=2.0, label=f"{risk_driver_label} risk")],
        loc="upper right",
        fontsize=7,
        framealpha=0.85,
        bbox_to_anchor=(1.0, 1.0),
    )
    panel_label(ax, f"EQM Risk  (vs {risk_driver_label})")
    last_risk = float(signals["risk"].loc[last_date])
    snapshot_box(
        ax,
        [
            (f"{risk_driver_label} risk", f"{last_risk * 100:.1f}%"),
            ("Fair value", money(last_fair)),
            ("QR 50%", money(last_qr50)),
        ],
    )

    # --- Panel 5: risk vs price ---
    ax = axes[4]
    p_lo = price_for_risk_fair(risk_fit, fair, last_date, 0.0)
    p_hi = price_for_risk_fair(risk_fit, fair, last_date, 1.0)
    grid_prices = np.linspace(max(p_lo * 0.5, 1.0), p_hi * 1.10, 600)
    grid_risks = np.array([risk_for_price_fair(risk_fit, fair, last_date, float(p)) for p in grid_prices])
    points = np.column_stack([grid_prices, grid_risks * 100.0]).reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    lc = LineCollection(segments, cmap="RdYlGn_r", norm=Normalize(0.0, 1.0), linewidth=2.2)
    lc.set_array(grid_risks[:-1])
    ax.add_collection(lc)
    ax.scatter(
        [last_price],
        [last_risk * 100.0],
        color="#222222",
        s=30,
        zorder=5,
        edgecolors="white",
        linewidths=1.2,
    )
    ax.set_xlim(0, max(p_hi * 1.10, last_price * 1.20))
    ax.set_ylim(-2, 102)
    ax.set_xlabel("USD")
    ax.set_ylabel("Risk (%)")
    ax.grid(True, alpha=0.2, zorder=1)
    panel_label(ax, "EQM Risk as a Function of Price")
    knot_lines: list[tuple[str, str]] = [
        ("Price", money(last_price)),
        (f"{risk_driver_label} risk", f"{last_risk * 100:.1f}%"),
        ("Fair value", money(last_fair)),
        ("QR 50%", money(last_qr50)),
        (f"{risk_driver_label} 50%", money(price_for_risk_fair(risk_fit, fair, last_date, 0.5))),
    ]
    for risk in [0.0, 0.25, 0.50, 0.75, 1.0]:
        knot_lines.append(
            (f"Risk {risk * 100:.0f}%", money(price_for_risk_fair(risk_fit, fair, last_date, risk)))
        )
    snapshot_box(ax, knot_lines)

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=180)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="EQM v1b experiment (scaled QR + blended gold SMA)")
    parser.add_argument("--local-json", default=str(DEFAULT_LOCAL_JSON))
    parser.add_argument("--fetch-binance-tail", action="store_true")
    parser.add_argument("--start-history", default="2014-01-01")
    parser.add_argument("--snapshot-date", help="Snapshot date; defaults to last price")
    parser.add_argument("--plot", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--qr-scale", type=float, help="Fixed terminal QR scale (default: calibrate on May 28)")
    parser.add_argument(
        "--qr-scale-mode",
        choices=["anchor", "piecewise", "linear", "uniform"],
        default="anchor",
        help=(
            "anchor: scale parabolic QR 50% to $200 in 2014, ×1 by 2018; "
            "piecewise: localized bump; linear/uniform: legacy scale modes"
        ),
    )
    parser.add_argument("--qr-anchor-date", default="2014-01-01")
    parser.add_argument("--qr-anchor-price", type=float, default=220.0)
    parser.add_argument(
        "--qr-anchor-converge-date",
        default="2020-01-01",
        help="Date by which dotted QR 50% equals the regular tail-scaled median",
    )
    parser.add_argument("--qr-scale-start-date", default="2014-01-01")
    parser.add_argument("--qr-scale-start-value", type=float, default=1.0)
    parser.add_argument(
        "--qr-scale-bump-peak",
        type=float,
        default=1.25,
        help="Peak QR multiplier during the 2014–2018 bump (piecewise mode)",
    )
    parser.add_argument("--qr-scale-bump-start", default="2014-01-01")
    parser.add_argument("--qr-scale-bump-rise-end", default="2015-06-01")
    parser.add_argument("--qr-scale-bump-fall-start", default="2017-06-01")
    parser.add_argument("--qr-scale-bump-end", default="2018-01-01")
    parser.add_argument(
        "--qr-scale-ramp-start-date",
        default="2022-01-01",
        help="Start downward ramp toward calibration (piecewise mode)",
    )
    parser.add_argument(
        "--qr-scale-ramp-power",
        type=float,
        default=1.0,
        help="Exponent on the post-2022 ramp segment (>1 delays correction)",
    )
    parser.add_argument("--calibration-date", default="2026-05-28")
    parser.add_argument("--calibration-qr-median", type=float, default=100_800.0)
    parser.add_argument("--blend-price-weight", type=float, default=0.5, help="Weight on BTC price in log blend (0–1)")
    parser.add_argument(
        "--risk-driver",
        choices=["qr50", "gold"],
        default="qr50",
        help="Fair-value line for v1b risk: scaled QR 50% (default) or gold SMA blend",
    )
    parser.add_argument("--gold-sma-weeks", type=int, default=20, help="SMA weeks for gold band (primary chart)")
    parser.add_argument(
        "--compare-sma-weeks",
        default="20,50,100",
        help="Comma-separated SMA lengths to chart and compare (set empty to disable)",
    )
    parser.add_argument("--no-soft-gate", action="store_true")
    parser.add_argument("--backtest-start", default="2021-11-10")
    parser.add_argument("--backtest-end")
    parser.add_argument("--base-amount", type=float, default=500.0)
    parser.add_argument("--skip-expanding", action="store_true", help="Skip slow causal backtest loop")
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
    base_cfg = V1BConfig(
        qr_display_scale=args.qr_scale,
        qr_scale_mode=args.qr_scale_mode,
        qr_anchor_date=args.qr_anchor_date,
        qr_anchor_price=args.qr_anchor_price,
        qr_anchor_converge_date=args.qr_anchor_converge_date,
        qr_scale_start_date=args.qr_scale_start_date,
        qr_scale_start_value=args.qr_scale_start_value,
        qr_scale_bump_peak=args.qr_scale_bump_peak,
        qr_scale_bump_start=args.qr_scale_bump_start,
        qr_scale_bump_rise_end=args.qr_scale_bump_rise_end,
        qr_scale_bump_fall_start=args.qr_scale_bump_fall_start,
        qr_scale_bump_end=args.qr_scale_bump_end,
        qr_scale_ramp_start_date=args.qr_scale_ramp_start_date,
        qr_scale_ramp_power=args.qr_scale_ramp_power,
        calibration_date=args.calibration_date,
        calibration_qr_median_usd=args.calibration_qr_median,
        blend_price_weight=args.blend_price_weight,
        gold_sma_weeks=args.gold_sma_weeks,
        risk_driver=args.risk_driver,
        use_soft_gate=not args.no_soft_gate,
    )

    print("Fitting asymmetric QR (full history)...")
    asym_fit = fit_asymmetric_quantile_bands(prices_full)
    asym_frame = asymmetric_quantile_frame(asym_fit, prices.index, [0.001, 0.5, 0.999])
    end_scale = resolve_qr_end_scale(asym_frame, base_cfg, prices.index)
    qr_scaled, scale_profile = build_qr_scaled_frame(asym_frame, base_cfg, end_scale)
    print(f"  QR terminal scale ({base_cfg.calibration_date}): {end_scale:.4f}")
    print(f"  QR scale mode: {base_cfg.qr_scale_mode}")
    if base_cfg.qr_scale_mode == "anchor":
        raw_anchor = float(asym_frame.loc[pd.Timestamp(base_cfg.qr_anchor_date), 0.5])
        peak_ratio = base_cfg.qr_anchor_price / raw_anchor
        print(
            f"  QR 50% parabola scale: ×{peak_ratio:.3f} @ {base_cfg.qr_anchor_date} "
            f"(→ ${base_cfg.qr_anchor_price:,.0f}), ×1.0 by {base_cfg.qr_anchor_converge_date}"
        )
    elif base_cfg.qr_scale_mode == "piecewise":
        print(
            f"  QR bump: peak ×{base_cfg.qr_scale_bump_peak:.2f} "
            f"({base_cfg.qr_scale_bump_start} → {base_cfg.qr_scale_bump_end}), "
            f"tail ramp → {end_scale:.3f} @ {base_cfg.calibration_date}"
        )

    check_dates = [
        "2014-01-01", "2014-06-01", "2015-01-14", "2017-06-01", "2017-12-17",
        "2018-06-01", "2021-04-14", "2022-01-01", "2024-03-01", "2026-05-28",
    ]
    print("\n  QR 50% check (raw vs tail-scaled vs display):")
    tail_only = scale_qr_frame(asym_frame, qr_tail_scale_series(prices.index, base_cfg, end_scale))
    for ds in check_dates:
        d = pd.Timestamp(ds)
        if d not in prices.index:
            d = prices.index[prices.index.get_indexer([d], method="nearest")[0]]
        raw = float(asym_frame.loc[d, 0.5])
        tail = float(tail_only.loc[d, 0.5])
        display = float(qr_scaled.loc[d, 0.5])
        factor = float(scale_profile.loc[d]) if d in scale_profile.index else float("nan")
        print(
            f"    {d.date()}  raw {money(raw):>8}  tail {money(tail):>8}  "
            f"display {money(display):>8}  (tail ×{factor:.3f})"
        )

    base_fit = fit_eqm(prices)
    ols_trend = ols_trend_series(base_fit, prices.index)
    baseline_signals = full_sample_eqm_signals(
        base_fit,
        prices,
        risk_gate_roll_days=int(CQM_DEFAULTS["risk_roll_days"]),
        risk_gate_near_days=int(CQM_DEFAULTS["risk_gate_near_days"]),
        risk_gate_near_buffer=float(CQM_DEFAULTS["risk_gate_near_buffer"]),
    )

    compare_weeks = parse_weeks_list(args.compare_sma_weeks) if args.compare_sma_weeks else []
    if args.gold_sma_weeks not in compare_weeks:
        compare_weeks.append(args.gold_sma_weeks)
    compare_weeks = sorted(set(compare_weeks))

    snapshot_date = pd.Timestamp(args.snapshot_date) if args.snapshot_date else prices.index.max()
    compare_dates = sorted(set(REFERENCE_RISK) | {str(snapshot_date.date())})
    sweep_signals: dict[int, pd.DataFrame] = {}
    primary_gold: pd.Series | None = None
    primary_risk_fit: EQMFit | None = None
    primary_fair: pd.Series | None = None
    primary_signals: pd.DataFrame | None = None
    primary_cfg = replace(base_cfg, gold_sma_weeks=args.gold_sma_weeks)

    for weeks in compare_weeks:
        cfg = replace(base_cfg, gold_sma_weeks=weeks)
        gold, fair, risk_fit, signals = build_v1b_signals(prices, qr_scaled, base_fit, cfg)
        sweep_signals[weeks] = signals

        stem = Path(args.plot).stem
        suffix = f"_w{weeks}" if len(compare_weeks) > 1 else ""
        plot_path = Path(args.plot).with_name(f"{stem}{suffix}.png")
        scale_at_snapshot = float(scale_profile.loc[snapshot_date])
        plot_eqm_v1b(
            prices,
            signals,
            gold,
            fair,
            qr_scaled,
            risk_fit,
            plot_path,
            snapshot_date,
            format_qr_scale_label(scale_at_snapshot, cfg, end_scale),
            scale_at_snapshot,
            cfg,
        )
        print(f"Saved chart ({weeks}w SMA): {plot_path}")

        if weeks == args.gold_sma_weeks:
            primary_gold = gold
            primary_risk_fit = risk_fit
            primary_fair = fair
            primary_signals = signals
            Path(args.plot).write_bytes(plot_path.read_bytes())

    if primary_signals is None or primary_gold is None or primary_risk_fit is None or primary_fair is None:
        raise RuntimeError("Primary SMA variant failed to build")

    print(f"\nSaved primary chart: {args.plot} ({args.gold_sma_weeks}w SMA)")
    snap = v1b_snapshot(primary_risk_fit, primary_fair, prices, snapshot_date, primary_cfg)
    driver = "QR 50%" if primary_cfg.risk_driver == "qr50" else "gold SMA"
    print(f"\nv1b snapshot for {snapshot_date.date()} (risk vs {driver})")
    print(f"  BTC price:       {money(snap['price'])}")
    print(f"  Fair ({driver}): {money(snap['fair'])}")
    print(f"  Solid gold band: {money(float(primary_gold.loc[snapshot_date]))}")
    print(f"  OLS trend:       {money(float(ols_trend.loc[snapshot_date]))}  (production CQM)")
    print(f"  OLS risk:        {pct(float(baseline_signals.loc[snapshot_date, 'risk']))}")
    last_linear = float(primary_signals.loc[snapshot_date, "risk_linear"])
    last_global = float(primary_signals.loc[snapshot_date, "risk_global"])
    last_gated = float(primary_signals.loc[snapshot_date, "risk"])
    print(f"  Linear risk:     {pct(last_linear)}  (6%/68%, γ=1)")
    print(f"  Global risk:     {pct(last_global)}  (tuning Δ {100 * (last_global - last_linear):+.1f}pp)")
    print(f"  Gated risk:      {pct(last_gated)}  (gate Δ {100 * (last_gated - last_global):+.1f}pp)")
    print(f"  EQM score:       {snap['score']:.3f}")
    print(f"  0% risk price:   {money(snap['eqm_0_pct'])}")
    print(f" 50% risk price:   {money(snap['eqm_50_pct'])}")
    print(f"100% risk price:   {money(snap['eqm_100_pct'])}")

    risk_csv = Path(args.plot).with_name("eqm_v1b_risk_series.csv")
    primary_signals.to_csv(risk_csv)
    print(f"Saved daily risk CSV: {risk_csv}")

    print_comparison_table(baseline_signals, primary_signals, compare_dates)
    print_tuning_table(primary_signals, compare_dates)
    if len(compare_weeks) > 1:
        print_sma_sweep_table(baseline_signals, sweep_signals, compare_dates)

    if not args.skip_expanding:
        print(f"\nComputing expanding (causal) v1b signals ({args.gold_sma_weeks}w SMA)...")
        expanding = expanding_v1b_signals(prices, qr_scaled, primary_gold, base_fit, primary_cfg)
        expanding_csv = Path(args.plot).with_name("eqm_v1b_expanding_risk.csv")
        expanding.to_csv(expanding_csv)
        print(f"Saved expanding risk CSV: {expanding_csv}")
        print_comparison_table(baseline_signals, expanding, compare_dates)

        bt, summary = run_risk_weighted_dca(
            expanding,
            start=args.backtest_start,
            end=args.backtest_end,
            base_amount=args.base_amount,
        )
        bt_path = Path(args.plot).with_name("eqm_v1b_dca_backtest.csv")
        bt.to_csv(bt_path)
        print("\nv1b risk-weighted DCA backtest (expanding signals)")
        print(f"  Window:          {summary.start.date()} to {summary.end.date()}")
        print(f"  Final equity:    {money(summary.final_equity)}")
        print(f"  Max drawdown:    {pct(summary.max_drawdown)}")
        print(f"  CAGR peak cap:   {pct(summary.cagr_peak_capital)}")
        print(f"  Saved backtest:  {bt_path}")

        baseline_bt, baseline_summary = run_risk_weighted_dca(
            baseline_signals,
            start=args.backtest_start,
            end=args.backtest_end,
            base_amount=args.base_amount,
        )
        print("\nBaseline OLS gated DCA (same window, for reference)")
        print(f"  Final equity:    {money(baseline_summary.final_equity)}")
        print(f"  Max drawdown:    {pct(baseline_summary.max_drawdown)}")
        print(f"  CAGR peak cap:   {pct(baseline_summary.cagr_peak_capital)}")


if __name__ == "__main__":
    main()
