#!/usr/bin/env python3
"""Reverse-engineered EQM prototype.

This script focuses on the part of BTCAnalytica's published EQM chart that can
be reconstructed from visible values: the monotone mapping from BTC price to
EQM risk, and the DCA sizing rule derived from that risk.

CSV mode also includes a dependency-free log-linear residual quantile envelope.
It is not a full quantile-regression clone, but it gives a useful baseline for
calibrating against the screenshot.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Sequence


@dataclass(frozen=True)
class RiskKnot:
    """A point on the price-to-risk curve."""

    risk: float
    price: float


@dataclass(frozen=True)
class BandSnapshot:
    """One-date EQM band state."""

    price: float
    empirical_001: float
    empirical_050: float
    empirical_999: float
    qr_001: float | None = None
    qr_050: float | None = None
    qr_999: float | None = None
    as_of: str | None = None


@dataclass(frozen=True)
class TrendFit:
    """Simple log-price trend fit and residual quantiles."""

    intercept: float
    slope: float
    residual_quantiles: dict[float, float]
    latest_index: int
    latest_price: float

    def price_at(self, index: int, quantile: float) -> float:
        if quantile not in self.residual_quantiles:
            raise KeyError(f"quantile {quantile} was not fitted")
        log_price = self.intercept + self.slope * index + self.residual_quantiles[quantile]
        return math.exp(log_price)


SCREENSHOT_KNOTS: tuple[RiskKnot, ...] = (
    RiskKnot(0.00, 45_000),
    RiskKnot(0.10, 59_000),
    RiskKnot(0.25, 72_000),
    RiskKnot(0.50, 101_000),
    RiskKnot(0.75, 125_000),
    RiskKnot(0.90, 138_000),
    RiskKnot(1.00, 160_000),
)

SCREENSHOT_SNAPSHOT = BandSnapshot(
    as_of="2026-05-22",
    price=75_500,
    empirical_001=45_400,
    empirical_050=109_600,
    empirical_999=159_900,
    qr_001=50_800,
    qr_050=100_400,
    qr_999=269_400,
)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def interpolate_risk(price: float, knots: Sequence[RiskKnot]) -> float:
    """Map price to risk with linear interpolation through sorted knots."""

    if len(knots) < 2:
        raise ValueError("at least two risk knots are required")

    sorted_knots = sorted(knots, key=lambda knot: knot.price)

    if price <= sorted_knots[0].price:
        return sorted_knots[0].risk
    if price >= sorted_knots[-1].price:
        return sorted_knots[-1].risk

    for left, right in zip(sorted_knots, sorted_knots[1:]):
        if left.price <= price <= right.price:
            span = right.price - left.price
            if span <= 0:
                raise ValueError("risk knots must have strictly increasing prices")
            weight = (price - left.price) / span
            return left.risk + weight * (right.risk - left.risk)

    raise RuntimeError("failed to interpolate risk")


def dca_amount(base_amount: float, risk: float) -> float:
    """BTCAnalytica's risk-weighted DCA rule."""

    return base_amount * (1.0 - 2.0 * clamp(risk))


def screenshot_like_knots(snapshot: BandSnapshot) -> tuple[RiskKnot, ...]:
    """Build a simple seven-point risk curve from one band snapshot.

    The screenshot suggests the 0% and 100% anchors are close to the empirical
    0.1% and 99.9% bands, while 50% is close to the QR median.
    Intermediate knots are interpolated from the visible screenshot table's
    proportions and should be recalibrated as more BTCAnalytica charts are
    collected.
    """

    median_anchor = snapshot.qr_050 or snapshot.empirical_050
    lower = snapshot.empirical_001
    upper = snapshot.empirical_999

    # These proportions reproduce the visible May 2026 table reasonably well:
    # 10% is roughly 24% of the lower-to-median distance, 25% is roughly 48%;
    # 75% is roughly 41% of the median-to-upper distance, 90% is roughly 64%.
    lower_to_mid = median_anchor - lower
    mid_to_upper = upper - median_anchor

    return (
        RiskKnot(0.00, lower),
        RiskKnot(0.10, lower + 0.24 * lower_to_mid),
        RiskKnot(0.25, lower + 0.48 * lower_to_mid),
        RiskKnot(0.50, median_anchor),
        RiskKnot(0.75, median_anchor + 0.41 * mid_to_upper),
        RiskKnot(0.90, median_anchor + 0.64 * mid_to_upper),
        RiskKnot(1.00, upper),
    )


def quantile(values: Sequence[float], q: float) -> float:
    """Inclusive linear-interpolated quantile."""

    if not values:
        raise ValueError("cannot compute quantile of empty sequence")
    if not 0 <= q <= 1:
        raise ValueError("q must be between 0 and 1")

    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]

    position = q * (len(sorted_values) - 1)
    left = math.floor(position)
    right = math.ceil(position)
    if left == right:
        return sorted_values[left]

    weight = position - left
    return sorted_values[left] * (1.0 - weight) + sorted_values[right] * weight


def fit_log_linear_residual_quantiles(
    prices: Sequence[float],
    quantiles: Iterable[float] = (0.001, 0.10, 0.25, 0.50, 0.75, 0.90, 0.999),
) -> TrendFit:
    """Fit log(price) = intercept + slope * day and residual quantiles."""

    clean_prices = [price for price in prices if price > 0 and math.isfinite(price)]
    if len(clean_prices) < 3:
        raise ValueError("at least three positive finite prices are required")

    y_values = [math.log(price) for price in clean_prices]
    x_values = list(range(len(y_values)))
    x_mean = sum(x_values) / len(x_values)
    y_mean = sum(y_values) / len(y_values)

    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, y_values))
    denominator = sum((x - x_mean) ** 2 for x in x_values)
    if denominator == 0:
        raise ValueError("cannot fit trend with zero x variance")

    slope = numerator / denominator
    intercept = y_mean - slope * x_mean
    residuals = [y - (intercept + slope * x) for x, y in zip(x_values, y_values)]
    residual_quantiles = {q: quantile(residuals, q) for q in quantiles}

    return TrendFit(
        intercept=intercept,
        slope=slope,
        residual_quantiles=residual_quantiles,
        latest_index=len(clean_prices) - 1,
        latest_price=clean_prices[-1],
    )


def read_price_csv(path: Path, date_col: str, price_col: str) -> list[tuple[str, float]]:
    rows: list[tuple[str, float]] = []

    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            raw_date = row.get(date_col)
            raw_price = row.get(price_col)
            if not raw_date or not raw_price:
                continue
            try:
                price = float(raw_price)
            except ValueError:
                continue
            if price > 0 and math.isfinite(price):
                rows.append((raw_date, price))

    if not rows:
        raise ValueError(f"no valid rows found in {path}")
    return rows


def format_usd(value: float) -> str:
    if abs(value) >= 1_000_000:
        return f"${value / 1_000_000:,.2f}M"
    if abs(value) >= 1_000:
        return f"${value / 1_000:,.1f}K"
    return f"${value:,.2f}"


def run_demo(base_amount: float) -> None:
    visible_risk = interpolate_risk(SCREENSHOT_SNAPSHOT.price, SCREENSHOT_KNOTS)
    fitted_knots = screenshot_like_knots(SCREENSHOT_SNAPSHOT)
    fitted_risk = interpolate_risk(SCREENSHOT_SNAPSHOT.price, fitted_knots)

    print("EQM screenshot demo")
    print(f"As of: {SCREENSHOT_SNAPSHOT.as_of}")
    print(f"BTC price: {format_usd(SCREENSHOT_SNAPSHOT.price)}")
    print()
    print("Visible chart knots:")
    for knot in SCREENSHOT_KNOTS:
        print(f"  risk {knot.risk:>5.0%}: {format_usd(knot.price)}")
    print()
    print(f"Risk from visible knots: {visible_risk:.2%}")
    print(f"DCA amount at {visible_risk:.2%} risk: {format_usd(dca_amount(base_amount, visible_risk))}")
    print()
    print("Rebuilt knots from band snapshot:")
    for knot in fitted_knots:
        print(f"  risk {knot.risk:>5.0%}: {format_usd(knot.price)}")
    print()
    print(f"Risk from rebuilt knots: {fitted_risk:.2%}")
    print(f"DCA amount at {fitted_risk:.2%} risk: {format_usd(dca_amount(base_amount, fitted_risk))}")


def run_csv(path: Path, date_col: str, price_col: str, base_amount: float) -> None:
    rows = read_price_csv(path, date_col, price_col)
    prices = [price for _, price in rows]
    fit = fit_log_linear_residual_quantiles(prices)

    latest_date = rows[-1][0] or date.today().isoformat()
    q001 = fit.price_at(fit.latest_index, 0.001)
    q050 = fit.price_at(fit.latest_index, 0.50)
    q999 = fit.price_at(fit.latest_index, 0.999)
    snapshot = BandSnapshot(
        as_of=latest_date,
        price=fit.latest_price,
        empirical_001=q001,
        empirical_050=q050,
        empirical_999=q999,
        qr_050=q050,
    )

    knots = screenshot_like_knots(snapshot)
    risk = interpolate_risk(snapshot.price, knots)

    print("EQM CSV prototype")
    print(f"Rows: {len(rows)}")
    print(f"As of: {snapshot.as_of}")
    print(f"Latest price: {format_usd(snapshot.price)}")
    print()
    print("Log-linear residual quantile bands:")
    print(f"  0.1%: {format_usd(q001)}")
    print(f"  50% : {format_usd(q050)}")
    print(f"  99.9%: {format_usd(q999)}")
    print()
    print("Risk knots:")
    for knot in knots:
        print(f"  risk {knot.risk:>5.0%}: {format_usd(knot.price)}")
    print()
    print(f"Risk: {risk:.2%}")
    print(f"DCA amount: {format_usd(dca_amount(base_amount, risk))}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reverse-engineered EQM prototype")
    parser.add_argument("--demo", action="store_true", help="run the screenshot-calibrated demo")
    parser.add_argument("--csv", type=Path, help="CSV file with daily BTC prices")
    parser.add_argument("--date-col", default="Date", help="date column name for CSV mode")
    parser.add_argument("--price-col", default="BTCUSD", help="price column name for CSV mode")
    parser.add_argument("--base-amount", type=float, default=500.0, help="base DCA amount")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.demo:
        run_demo(args.base_amount)
        return

    if args.csv:
        run_csv(args.csv, args.date_col, args.price_col, args.base_amount)
        return

    raise SystemExit("pass --demo or --csv path/to/btc_daily.csv")


if __name__ == "__main__":
    main()
