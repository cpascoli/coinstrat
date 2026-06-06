#!/usr/bin/env python3
"""Parity checks between eqm_model.py and web/src/utils/cqm.ts."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd

from eqm_model import (
    CQM_DEFAULTS,
    blend_gated_risk,
    clean_price_series,
    compute_gate_blend_weight,
    current_snapshot,
    fit_eqm,
    gated_rolling_risk_series,
    load_local_json,
    risk_for_price,
    score_for_risk,
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


def test_may_2026_snapshot() -> None:
    path = Path(__file__).resolve().parents[1] / "web" / "public" / "data" / "btc_daily.json"
    raw = load_local_json(path)
    prices = clean_price_series(raw, start=str(CQM_DEFAULTS["start_date"]))
    fit = fit_eqm(prices)
    snap = current_snapshot(
        fit,
        prices,
        pd.Timestamp("2026-05-22"),
        risk_gate_roll_days=int(CQM_DEFAULTS["risk_roll_days"]),
        risk_gate_near_days=int(CQM_DEFAULTS["risk_gate_near_days"]),
        risk_gate_near_buffer=float(CQM_DEFAULTS["risk_gate_near_buffer"]),
    )
    assert math.isclose(snap["price"], 75466.52, abs_tol=1.0)
    assert math.isclose(snap["risk"] * 100, 28.6, abs_tol=1.0)
    assert math.isclose(snap["score"], snap["risk"] ** fit.score_power, abs_tol=1e-6)


def test_gated_lowers_cycle_bottoms() -> None:
    path = Path(__file__).resolve().parents[1] / "web" / "public" / "data" / "btc_daily.json"
    prices = clean_price_series(load_local_json(path), start=str(CQM_DEFAULTS["start_date"]))
    fit = fit_eqm(prices)
    gated = gated_rolling_risk_series(fit, prices)
    for date in ["2015-01-15", "2018-12-15", "2020-03-15", "2022-11-21"]:
        ts = pd.Timestamp(date)
        price = float(prices.loc[:ts].iloc[-1])
        global_r = risk_for_price(fit, ts, price)
        gated_r = float(gated.loc[ts])
        assert gated_r <= global_r + 1e-9
        assert gated_r <= 0.15


def main() -> int:
    tests = [
        test_gate_blend_weight,
        test_blend_gated_risk,
        test_score_is_risk_power,
        test_may_2026_snapshot,
        test_gated_lowers_cycle_bottoms,
    ]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\nAll {len(tests)} parity checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
