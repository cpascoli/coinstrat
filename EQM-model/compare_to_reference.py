#!/usr/bin/env python3
"""
Compare the reverse-engineered EQM replica to BTCAnalytica's reference image.

Outputs:
- EQM-model/output/eqm_compare_side_by_side.png
- EQM-model/output/eqm_compare_diff.csv

The numerical comparison uses the visible May 22, 2026 values from the
reference screenshot (EQM/btcanalytica_model.jpeg).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import matplotlib.image as mpimg
import matplotlib.pyplot as plt
import pandas as pd

from eqm_model import (
    DEFAULT_LOCAL_JSON,
    clean_price_series,
    current_snapshot,
    fit_eqm,
    fit_eqm_solid_bands,
    fit_quantile_regression,
    load_local_plus_binance_tail,
    quantile_regression_series,
    solid_band_series,
)

# Calibrated risk-curve params (see calibrate_eqm.py) — keep in sync with run_eqm.py.
CALIB_TIME_POWER = 0.70
CALIB_LOW_QUANTILE = 0.005
CALIB_HIGH_QUANTILE = 0.61
CALIB_SCORE_LOWER = 0.06
CALIB_SCORE_UPPER = 0.86

REFERENCE_IMAGE = Path(__file__).resolve().parents[1] / "EQM" / "btcanalytica_model_20250528.jpeg"
DEFAULT_REPLICA_IMAGE = Path(__file__).resolve().parent / "output" / "eqm_replica.png"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"


@dataclass(frozen=True)
class ReferenceSnapshot:
    """Visible May 28, 2026 close values from the BTCAnalytica chart.

    Price / score / risk / 7 risk-price knots are read directly from the chart's
    boxes. The solid-band and QR values have no on-chart box in the reference, so
    they are approximate visual reads (and barely move week-over-week).
    """

    as_of: str = "2026-05-28"
    price: float = 73_000.0
    eqm_score: float = 0.138
    eqm_risk: float = 0.264
    eqm_trend_risk: float = 71_400.0
    eqm_band_001: float = 45_000.0
    eqm_band_50: float = 108_000.0
    eqm_band_999: float = 160_000.0
    eqm_qr_001: float = 50_600.0
    eqm_qr_50: float = 108_500.0
    eqm_qr_999: float = 261_300.0
    risk_price_0: float = 45_000.0
    risk_price_10: float = 59_000.0
    risk_price_25: float = 72_000.0
    risk_price_50: float = 101_000.0
    risk_price_75: float = 125_000.0
    risk_price_90: float = 138_000.0
    risk_price_100: float = 161_000.0


def fmt_money(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    if abs(value) >= 1_000_000:
        return f"${value / 1_000_000:,.2f}M"
    if abs(value) >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.2f}"


def fmt_pct(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value * 100:,.2f}%"


def percent_diff(replica: float, reference: float) -> float:
    if reference == 0:
        return float("nan")
    return (replica - reference) / reference * 100.0


def build_diff_table(snapshot: dict[str, float], reference: ReferenceSnapshot) -> pd.DataFrame:
    rows = [
        ("BTC price", "USD", snapshot["price"], reference.price, fmt_money),
        ("EQM score", "0..1", snapshot["score"], reference.eqm_score, lambda v: f"{v:.3f}"),
        ("EQM risk", "0..1", snapshot["risk"], reference.eqm_risk, fmt_pct),
        ("EQM 0.1% solid band", "USD", snapshot["solid_lower"], reference.eqm_band_001, fmt_money),
        ("EQM 50% solid band", "USD", snapshot["solid_median"], reference.eqm_band_50, fmt_money),
        ("EQM 99.9% solid band", "USD", snapshot["solid_upper"], reference.eqm_band_999, fmt_money),
        ("EQM 0.1% QR (dashed)", "USD", snapshot["qr_001"], reference.eqm_qr_001, fmt_money),
        ("EQM 50% QR (dashed)", "USD", snapshot["qr_50"], reference.eqm_qr_50, fmt_money),
        ("EQM 99.9% QR (dashed)", "USD", snapshot["qr_999"], reference.eqm_qr_999, fmt_money),
        ("Risk 0% price", "USD", snapshot["eqm_0_1_pct"], reference.risk_price_0, fmt_money),
        ("Risk 50% price", "USD", snapshot["eqm_50_pct"], reference.risk_price_50, fmt_money),
        ("Risk 100% price", "USD", snapshot["eqm_99_9_pct"], reference.risk_price_100, fmt_money),
    ]

    table = []
    for metric, unit, replica, ref, formatter in rows:
        table.append(
            {
                "metric": metric,
                "unit": unit,
                "reference": formatter(ref),
                "replica": formatter(replica),
                "abs_error": replica - ref,
                "pct_error": percent_diff(replica, ref),
            }
        )
    return pd.DataFrame(table)


def render_diff_table_text(df: pd.DataFrame) -> str:
    columns = ["metric", "reference", "replica", "abs_error", "pct_error"]
    headers = ["Metric", "Reference", "Replica", "Abs error", "% error"]

    formatted = []
    for _, row in df.iterrows():
        abs_err = row["abs_error"]
        if row["unit"] == "USD":
            abs_str = fmt_money(abs_err)
        elif row["unit"] == "0..1" and row["metric"] == "EQM risk":
            abs_str = f"{abs_err * 100:+.2f} pp"
        else:
            abs_str = f"{abs_err:+.3f}"
        pct_err = row["pct_error"]
        pct_str = "n/a" if pd.isna(pct_err) else f"{pct_err:+.2f}%"
        formatted.append(
            [row["metric"], row["reference"], row["replica"], abs_str, pct_str]
        )

    widths = [
        max(len(h), max(len(r[i]) for r in formatted)) for i, h in enumerate(headers)
    ]
    lines = ["  ".join(h.ljust(w) for h, w in zip(headers, widths))]
    lines.append("  ".join("-" * w for w in widths))
    for row in formatted:
        lines.append("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))
    return "\n".join(lines)


def build_side_by_side_figure(
    reference_path: Path,
    replica_path: Path,
    output_path: Path,
    diff_text: str,
) -> None:
    reference_image = mpimg.imread(reference_path)
    replica_image = mpimg.imread(replica_path)

    fig = plt.figure(figsize=(20, 14))
    grid = fig.add_gridspec(2, 2, height_ratios=[6, 1])

    ax_ref = fig.add_subplot(grid[0, 0])
    ax_ref.imshow(reference_image)
    ax_ref.set_title("Reference: BTCAnalytica EQM (May 28, 2026)", fontsize=12, fontweight="bold")
    ax_ref.axis("off")

    ax_rep = fig.add_subplot(grid[0, 1])
    ax_rep.imshow(replica_image)
    ax_rep.set_title("Replica: prototype EQM (May 28, 2026)", fontsize=12, fontweight="bold")
    ax_rep.axis("off")

    ax_diff = fig.add_subplot(grid[1, :])
    ax_diff.axis("off")
    ax_diff.text(
        0.0,
        1.0,
        diff_text,
        family="monospace",
        fontsize=10,
        va="top",
        ha="left",
    )

    fig.suptitle(
        "Bitcoin Empirical Quantile Model — Reference vs Replica",
        fontsize=14,
        fontweight="bold",
    )
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare EQM replica to reference")
    parser.add_argument(
        "--snapshot-date",
        default="2026-05-28",
        help="Snapshot date for the replica (must exist in the price history)",
    )
    parser.add_argument(
        "--start-history",
        default="2014-01-01",
        help="Earliest history used to fit the EQM",
    )
    parser.add_argument(
        "--reference-image",
        default=str(REFERENCE_IMAGE),
        help="Path to the BTCAnalytica reference screenshot",
    )
    parser.add_argument(
        "--replica-image",
        default=str(DEFAULT_REPLICA_IMAGE),
        help="Path to the replica chart produced by run_eqm.py",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory for comparison artefacts",
    )
    args = parser.parse_args()

    reference_path = Path(args.reference_image)
    replica_path = Path(args.replica_image)
    output_dir = Path(args.output_dir)

    if not reference_path.exists():
        raise FileNotFoundError(f"reference image not found: {reference_path}")
    if not replica_path.exists():
        raise FileNotFoundError(
            f"replica image not found at {replica_path}. "
            "Run run_eqm.py first to generate it."
        )

    prices = clean_price_series(load_local_plus_binance_tail(DEFAULT_LOCAL_JSON), start=args.start_history)
    fit = fit_eqm(
        prices,
        low_quantile=CALIB_LOW_QUANTILE,
        high_quantile=CALIB_HIGH_QUANTILE,
        time_power=CALIB_TIME_POWER,
        score_lower_quantile=CALIB_SCORE_LOWER,
        score_upper_quantile=CALIB_SCORE_UPPER,
    )
    qr_fit = fit_quantile_regression(prices, quantiles=(0.001, 0.5, 0.999), time_power=CALIB_TIME_POWER)
    solid_fit = fit_eqm_solid_bands(prices, time_power=CALIB_TIME_POWER)
    snapshot_date = pd.Timestamp(args.snapshot_date)
    snapshot = current_snapshot(fit, prices, snapshot_date)

    snapshot["solid_lower"] = float(solid_band_series(solid_fit, [snapshot_date], "lower").iloc[0])
    snapshot["solid_median"] = float(solid_band_series(solid_fit, [snapshot_date], "median").iloc[0])
    snapshot["solid_upper"] = float(solid_band_series(solid_fit, [snapshot_date], "upper").iloc[0])
    snapshot["qr_001"] = float(quantile_regression_series(qr_fit, [snapshot_date], 0.001).iloc[0])
    snapshot["qr_50"] = float(quantile_regression_series(qr_fit, [snapshot_date], 0.5).iloc[0])
    snapshot["qr_999"] = float(quantile_regression_series(qr_fit, [snapshot_date], 0.999).iloc[0])

    reference = ReferenceSnapshot()
    diff_df = build_diff_table(snapshot, reference)

    diff_csv = output_dir / "eqm_compare_diff.csv"
    diff_csv.parent.mkdir(parents=True, exist_ok=True)
    diff_df.to_csv(diff_csv, index=False)

    diff_text_header = (
        f"Reference snapshot: {reference.as_of}\n"
        f"Replica snapshot:   {snapshot_date.date()}\n"
    )
    diff_text = diff_text_header + "\n" + render_diff_table_text(diff_df)

    side_by_side_path = output_dir / "eqm_compare_side_by_side.png"
    build_side_by_side_figure(reference_path, replica_path, side_by_side_path, diff_text)

    print(diff_text)
    print()
    print(f"Saved diff CSV:           {diff_csv}")
    print(f"Saved side-by-side image: {side_by_side_path}")


if __name__ == "__main__":
    main()
