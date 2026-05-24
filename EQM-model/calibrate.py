#!/usr/bin/env python3
"""
Calibrate the EQM prototype against a target reference snapshot.

Strategy:
  1. Load BTC history.
  2. Grid-search over (time_power, low_quantile, high_quantile).
  3. For each candidate, fit the EQM and score the percent error of the
     replica's risk knot prices versus the reference table.
  4. Print the best candidate and the resulting diff.
  5. Optionally save calibrated parameters to JSON.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from itertools import product
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from eqm_model import (
    DEFAULT_LOCAL_JSON,
    clean_price_series,
    current_snapshot,
    fit_eqm,
    load_local_json,
)


REFERENCE_KNOTS_2026_05_22: dict[float, float] = {
    0.0: 45_000.0,
    0.10: 59_000.0,
    0.25: 72_000.0,
    0.50: 101_000.0,
    0.75: 125_000.0,
    0.90: 138_000.0,
    1.0: 160_000.0,
}

REFERENCE_PRICE_2026_05_22 = 75_500.0
REFERENCE_RISK_2026_05_22 = 0.285
REFERENCE_SCORE_2026_05_22 = 0.145


@dataclass
class Candidate:
    time_power: float
    low_quantile: float
    high_quantile: float
    knot_prices: dict[float, float] = field(default_factory=dict)
    risk: float = float("nan")
    score: float = float("nan")
    knot_mape: float = float("nan")
    risk_abs_pp: float = float("nan")
    objective: float = float("nan")


def candidate_objective(candidate: Candidate, risk_weight: float = 0.5) -> float:
    """Combined fit objective: knot price MAPE plus weighted risk error."""
    return candidate.knot_mape + risk_weight * candidate.risk_abs_pp


def evaluate_candidate(
    prices: pd.Series,
    snapshot_date: pd.Timestamp,
    time_power: float,
    low_quantile: float,
    high_quantile: float,
) -> Candidate | None:
    if low_quantile >= high_quantile:
        return None
    try:
        fit = fit_eqm(
            prices,
            low_quantile=low_quantile,
            high_quantile=high_quantile,
            time_power=time_power,
        )
    except ValueError:
        return None

    snapshot = current_snapshot(fit, prices, snapshot_date)
    knot_prices = {
        0.0: snapshot["eqm_0_1_pct"],
        0.10: snapshot["eqm_10_pct"],
        0.25: snapshot["eqm_25_pct"],
        0.50: snapshot["eqm_50_pct"],
        0.75: snapshot["eqm_75_pct"],
        0.90: snapshot["eqm_90_pct"],
        1.0: snapshot["eqm_99_9_pct"],
    }

    pct_errors = []
    for risk, target in REFERENCE_KNOTS_2026_05_22.items():
        replica = knot_prices[risk]
        if target == 0:
            continue
        pct_errors.append(abs(replica - target) / target * 100.0)
    knot_mape = float(np.mean(pct_errors)) if pct_errors else float("nan")
    risk_abs_pp = abs(snapshot["risk"] - REFERENCE_RISK_2026_05_22) * 100.0

    candidate = Candidate(
        time_power=time_power,
        low_quantile=low_quantile,
        high_quantile=high_quantile,
        knot_prices=knot_prices,
        risk=snapshot["risk"],
        score=snapshot["score"],
        knot_mape=knot_mape,
        risk_abs_pp=risk_abs_pp,
    )
    candidate.objective = candidate_objective(candidate)
    return candidate


def grid_search(
    prices: pd.Series,
    snapshot_date: pd.Timestamp,
    time_powers: Iterable[float],
    low_quantiles: Iterable[float],
    high_quantiles: Iterable[float],
) -> list[Candidate]:
    candidates: list[Candidate] = []
    combos = list(product(time_powers, low_quantiles, high_quantiles))
    for tp, lq, hq in combos:
        candidate = evaluate_candidate(prices, snapshot_date, tp, lq, hq)
        if candidate is not None:
            candidates.append(candidate)
    candidates.sort(key=lambda c: c.objective)
    return candidates


def fmt_money(value: float) -> str:
    if abs(value) >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.2f}"


def print_candidate_table(candidates: list[Candidate], top_n: int) -> None:
    headers = [
        "rank",
        "time_pow",
        "low_q",
        "high_q",
        "knot MAPE %",
        "risk pp err",
        "objective",
    ]
    rows = []
    for i, candidate in enumerate(candidates[:top_n], start=1):
        rows.append(
            [
                str(i),
                f"{candidate.time_power:.2f}",
                f"{candidate.low_quantile:.3f}",
                f"{candidate.high_quantile:.3f}",
                f"{candidate.knot_mape:.2f}",
                f"{candidate.risk_abs_pp:+.2f}",
                f"{candidate.objective:.3f}",
            ]
        )
    widths = [max(len(h), max(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    print("  ".join(h.ljust(w) for h, w in zip(widths, headers, strict=False))) if False else None
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))


def print_best_diff(candidate: Candidate) -> None:
    print()
    print("Best candidate vs reference (May 22, 2026):")
    print(f"  time_power      = {candidate.time_power}")
    print(f"  low_quantile    = {candidate.low_quantile}")
    print(f"  high_quantile   = {candidate.high_quantile}")
    print(f"  EQM risk        replica {candidate.risk * 100:.2f}%  reference 28.50%")
    print(f"  EQM score       replica {candidate.score:.3f}        reference 0.145")
    print("  Score uses independent score_lower/score_upper residual anchors, not risk^p.")
    print()

    headers = ["risk %", "reference", "replica", "abs error", "% error"]
    rows = []
    for risk, ref in REFERENCE_KNOTS_2026_05_22.items():
        replica = candidate.knot_prices[risk]
        abs_err = replica - ref
        pct_err = (replica - ref) / ref * 100.0
        rows.append(
            [
                f"{risk * 100:.0f}",
                fmt_money(ref),
                fmt_money(replica),
                fmt_money(abs_err),
                f"{pct_err:+.2f}%",
            ]
        )
    widths = [max(len(h), max(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))


def save_calibration(path: Path, candidate: Candidate, snapshot_date: pd.Timestamp) -> None:
    payload = {
        "snapshot_date": str(snapshot_date.date()),
        "time_power": candidate.time_power,
        "low_quantile": candidate.low_quantile,
        "high_quantile": candidate.high_quantile,
        "knot_mape_pct": candidate.knot_mape,
        "risk_abs_pp": candidate.risk_abs_pp,
        "replica_risk": candidate.risk,
        "replica_score": candidate.score,
        "knot_prices": candidate.knot_prices,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calibrate EQM anchors to a reference snapshot")
    parser.add_argument("--start-history", default="2014-01-01")
    parser.add_argument("--snapshot-date", default="2026-05-22")
    parser.add_argument(
        "--time-powers",
        default="0.40,0.45,0.50,0.55,0.60,0.70,0.85,1.00",
        help="Comma-separated time-power candidates",
    )
    parser.add_argument(
        "--low-quantiles",
        default="0.05,0.08,0.10,0.12,0.15,0.18,0.20,0.25",
        help="Comma-separated low-quantile candidates",
    )
    parser.add_argument(
        "--high-quantiles",
        default="0.70,0.75,0.78,0.80,0.82,0.85,0.88,0.92",
        help="Comma-separated high-quantile candidates",
    )
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument(
        "--save",
        default="EQM-model/output/eqm_calibration.json",
        help="Path to save the best calibration parameters",
    )
    return parser.parse_args()


def parse_floats(value: str) -> list[float]:
    return [float(v) for v in value.split(",") if v.strip()]


def main() -> None:
    args = parse_args()
    prices = clean_price_series(load_local_json(DEFAULT_LOCAL_JSON), start=args.start_history)
    snapshot_date = pd.Timestamp(args.snapshot_date)

    time_powers = parse_floats(args.time_powers)
    low_quantiles = parse_floats(args.low_quantiles)
    high_quantiles = parse_floats(args.high_quantiles)

    print(
        f"Calibrating against {len(time_powers) * len(low_quantiles) * len(high_quantiles)} "
        f"combinations on history starting {args.start_history}."
    )
    candidates = grid_search(prices, snapshot_date, time_powers, low_quantiles, high_quantiles)
    if not candidates:
        raise SystemExit("No valid candidates found. Widen the search grid.")

    print()
    print(f"Top {args.top_n} candidates by combined objective:")
    print_candidate_table(candidates, args.top_n)

    best = candidates[0]
    print_best_diff(best)

    save_path = Path(args.save)
    save_calibration(save_path, best, snapshot_date)
    print(f"\nSaved calibration: {save_path}")


if __name__ == "__main__":
    main()
