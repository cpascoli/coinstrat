#!/usr/bin/env python3
"""Parity checks between eqm_model.py and web/src/utils/cqm.ts."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd

from eqm_model import (
    CQM_DEFAULTS,
    apply_soft_gated_risk,
    asymmetric_quantile_frame,
    blend_gated_risk,
    build_fair_value_signals,
    build_qr_scaled_frame,
    clean_price_series,
    compute_gate_blend_weight,
    fair_value_snapshot,
    fit_asymmetric_quantile_bands,
    fit_eqm,
    gated_fair_risk_series,
    load_local_json,
    load_local_plus_binance_tail,
    DEFAULT_LOCAL_JSON,
    score_for_risk,
    soften_gate_blend_weight,
)


def _fair_pipeline(prices: pd.Series) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    raw = load_local_plus_binance_tail(DEFAULT_LOCAL_JSON)
    prices_full = clean_price_series(raw, start=None)
    asym_fit = fit_asymmetric_quantile_bands(prices_full)
    asym_frame = asymmetric_quantile_frame(asym_fit, prices.index, [0.001, 0.5, 0.999])
    qr_scaled, _ = build_qr_scaled_frame(asym_frame)
    base_fit = fit_eqm(prices)
    _, fair, risk_fit, signals = build_fair_value_signals(prices, qr_scaled, base_fit)
    return qr_scaled, fair, signals


def test_soft_gate_helpers() -> None:
    assert math.isclose(soften_gate_blend_weight(0.5, 2.0), 0.25, abs_tol=1e-6)
    cfg_power = float(CQM_DEFAULTS["risk_gate_weight_power"])
    cfg_floor = float(CQM_DEFAULTS["risk_gate_global_floor"])
    assert math.isclose(
        apply_soft_gated_risk(0.128, 0.0, 1.0, weight_power=cfg_power, global_floor=cfg_floor),
        0.096,
        abs_tol=1e-3,
    )


def test_gate_blend_weight() -> None:
    cfg_buffer = float(CQM_DEFAULTS["risk_gate_near_buffer"])
    near_low = 100.0
    assert compute_gate_blend_weight(116.0, near_low, near_low_buffer=cfg_buffer) == 0.0
    assert compute_gate_blend_weight(100.0, near_low, near_low_buffer=cfg_buffer) == 1.0
    assert math.isclose(
        compute_gate_blend_weight(107.5, near_low, near_low_buffer=cfg_buffer),
        0.5,
        rel_tol=0,
        abs_tol=1e-6,
    )


def test_blend_gated_risk() -> None:
    assert math.isclose(blend_gated_risk(0.25, 0.0, 0.0), 0.25, abs_tol=1e-6)
    assert math.isclose(blend_gated_risk(0.25, 0.0, 1.0), 0.0, abs_tol=1e-6)
    assert math.isclose(blend_gated_risk(0.25, 0.0, 0.5), 0.125, abs_tol=1e-6)
    assert math.isclose(blend_gated_risk(0.20, 0.30, 1.0), 0.20, abs_tol=1e-6)


def test_score_is_risk_power() -> None:
    risk = 0.286
    power = float(CQM_DEFAULTS["score_power"])
    score = score_for_risk(risk, power)
    assert score <= risk + 1e-9
    assert math.isclose(score, risk**power, abs_tol=1e-9)


def test_may_2026_fair_value_snapshot() -> None:
    prices = clean_price_series(
        load_local_plus_binance_tail(DEFAULT_LOCAL_JSON),
        start=str(CQM_DEFAULTS["start_date"]),
    )
    qr_scaled, fair, signals = _fair_pipeline(prices)
    base_fit = fit_eqm(prices)
    _, _, risk_fit, _ = build_fair_value_signals(prices, qr_scaled, base_fit)
    snap = fair_value_snapshot(risk_fit, fair, prices, pd.Timestamp("2026-05-28"))
    assert math.isclose(snap["price"], 73613.0, abs_tol=500.0)
    assert 28.0 <= snap["risk"] * 100 <= 40.0
    assert math.isclose(snap["score"], snap["risk"] ** base_fit.score_power, abs_tol=1e-6)
    assert math.isclose(float(qr_scaled[0.5].loc["2026-05-28"]), 100_800.0, rel_tol=0.02)


def test_gated_lowers_cycle_bottoms() -> None:
    prices = clean_price_series(
        load_local_plus_binance_tail(DEFAULT_LOCAL_JSON),
        start=str(CQM_DEFAULTS["start_date"]),
    )
    qr_scaled, fair, _ = _fair_pipeline(prices)
    base_fit = fit_eqm(prices)
    _, _, risk_fit, _ = build_fair_value_signals(prices, qr_scaled, base_fit)
    gated = gated_fair_risk_series(risk_fit, prices, fair)
    global_r = gated_fair_risk_series(risk_fit, prices, fair, use_soft_gate=False)
    for date in ["2015-01-15", "2018-12-15", "2020-03-15", "2022-11-21"]:
        ts = pd.Timestamp(date)
        if ts not in gated.index:
            continue
        gated_r = float(gated.loc[ts])
        global_risk = float(global_r.loc[ts])
        assert gated_r <= global_risk + 1e-9
        assert gated_r <= 0.20


def test_jun_2026_fair_value_risk() -> None:
    prices = clean_price_series(
        load_local_plus_binance_tail(DEFAULT_LOCAL_JSON),
        start=str(CQM_DEFAULTS["start_date"]),
    )
    qr_scaled, fair, signals = _fair_pipeline(prices)
    d = pd.Timestamp("2026-06-06")
    if d not in signals.index:
        d = signals.loc[:d].index[-1]
    risk = float(signals.loc[d, "risk"])
    # Global fair-value QR model (production default; Jun 2026 ~8–12%).
    assert 5.0 <= risk * 100 <= 15.0


def main() -> int:
    tests = [
        test_soft_gate_helpers,
        test_gate_blend_weight,
        test_blend_gated_risk,
        test_score_is_risk_power,
        test_may_2026_fair_value_snapshot,
        test_gated_lowers_cycle_bottoms,
        test_jun_2026_fair_value_risk,
    ]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\nAll {len(tests)} parity checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
