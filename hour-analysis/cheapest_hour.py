#!/usr/bin/env python3
"""Determine which hour of the day BTC tends to trade at its daily low.

Uses Kraken hourly OHLCVT CSVs (XBT<FIAT>_60.csv) across the last N quarters.
For each calendar day we find the hour whose `low` is the lowest of the day,
then report, per hour, the percentage of days that hour held the daily low.

Timestamps in the Kraken data are UTC; analysis is done in UTC by default.
"""

import argparse
import os
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Quarters ordered oldest -> newest. "Last N quarters" takes the tail.
QUARTERS = [
    "Kraken_OHLCVT_Q1_2024",
    "Kraken_OHLCVT_Q2_2024",
    "Kraken_OHLCVT_Q3_2024",
    "Kraken_OHLCVT_Q4_2024",
    "Kraken_OHLCVT_Q1_2025",
    "Kraken_OHLCVT_Q2_2025",
    "Kraken_OHLCVT_Q3_2025",
    "Kraken_OHLCVT_Q4_2025",
    "Kraken_OHLCVT_Q1_2026",
]

INTERVALS = [1, 2, 3, 5, 9]
COLUMNS = ["ts", "open", "high", "low", "close", "volume", "trades"]


def load_hourly(data_dir: Path, pair: str, n_quarters: int, tz: str) -> pd.DataFrame:
    """Load and concatenate the hourly CSV for `pair` over the last n_quarters."""
    frames = []
    for q in QUARTERS[-n_quarters:]:
        fp = data_dir / q / f"{pair}_60.csv"
        if not fp.exists():
            continue
        df = pd.read_csv(fp, header=None, names=COLUMNS)
        frames.append(df)
    if not frames:
        raise FileNotFoundError(f"No {pair}_60.csv found for last {n_quarters} quarters in {data_dir}")
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    dt = pd.to_datetime(df["ts"], unit="s", utc=True)
    if tz != "UTC":
        dt = dt.dt.tz_convert(tz)
    df["dt"] = dt
    df["date"] = df["dt"].dt.date
    df["hour"] = df["dt"].dt.hour
    return df


def cheapest_hour_distribution(df: pd.DataFrame):
    """Return (pct_per_hour Series indexed 0..23, n_days, n_dropped_partial)."""
    hours_per_day = df.groupby("date")["hour"].nunique()
    full_days = hours_per_day[hours_per_day == 24].index
    n_dropped = int((hours_per_day != 24).sum())
    full = df[df["date"].isin(full_days)]

    # Index (within the day) of the row holding the minimum low -> its hour.
    idx_min = full.groupby("date")["low"].idxmin()
    cheap_hours = full.loc[idx_min, "hour"]

    counts = cheap_hours.value_counts().reindex(range(24), fill_value=0).sort_index()
    n_days = len(full_days)
    pct = counts / n_days * 100.0
    return pct, n_days, n_dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(Path.home() / "Downloads" / "btc"))
    ap.add_argument("--pair", default="XBTUSD", help="e.g. XBTUSD, XBTGBP, XBTEUR")
    ap.add_argument("--tz", default="UTC", help="timezone for the hour-of-day (default UTC)")
    ap.add_argument("--out-dir", default=str(Path(__file__).parent / "output"))
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    results = {}
    meta = {}
    for n in INTERVALS:
        df = load_hourly(data_dir, args.pair, n, args.tz)
        pct, n_days, n_dropped = cheapest_hour_distribution(df)
        results[n] = pct
        meta[n] = (n_days, n_dropped)

    table = pd.DataFrame({f"{n}Q ({meta[n][0]}d)": results[n] for n in INTERVALS})
    table.index.name = f"hour ({args.tz})"

    pd.set_option("display.float_format", lambda x: f"{x:5.1f}")
    print(f"\n=== {args.pair}: % of days where each hour had the daily low ({args.tz}) ===\n")
    print(table.to_string())
    print("\nDays analysed (full 24h only) / partial days dropped:")
    for n in INTERVALS:
        print(f"  last {n}Q: {meta[n][0]} days  (dropped {meta[n][1]} partial days)")

    # Highlight the top hours per interval.
    print("\nTop-3 cheapest hours per interval:")
    for n in INTERVALS:
        top = results[n].sort_values(ascending=False).head(3)
        items = ", ".join(f"{h:02d}:00 ({v:.1f}%)" for h, v in top.items())
        print(f"  last {n}Q: {items}")

    csv_path = out_dir / f"{args.pair}_cheapest_hour.csv"
    table.to_csv(csv_path, float_format="%.2f")
    print(f"\nSaved table -> {csv_path}")

    # --- Chart 1: small-multiples bar chart, one panel per interval ---
    uniform = 100.0 / 24.0
    fig, axes = plt.subplots(len(INTERVALS), 1, figsize=(11, 2.1 * len(INTERVALS)), sharex=True)
    for ax, n in zip(axes, INTERVALS):
        pct = results[n]
        top_hour = int(pct.idxmax())
        colors = ["#f4a259" if h != top_hour else "#e63946" for h in range(24)]
        ax.bar(pct.index, pct.values, color=colors)
        ax.axhline(uniform, color="#888", ls="--", lw=0.8)
        ax.set_ylabel(f"last {n}Q\n(%)")
        ax.set_xticks(range(24))
        ax.grid(axis="y", alpha=0.25)
        ax.text(0.99, 0.9, f"peak {top_hour:02d}:00 = {pct.max():.1f}%",
                transform=ax.transAxes, ha="right", va="top", fontsize=8,
                color="#e63946", fontweight="bold")
    axes[-1].set_xlabel(f"hour of day ({args.tz})")
    fig.suptitle(f"{args.pair} - % of days each hour held the daily low\n(dashed = uniform {uniform:.1f}%)",
                 fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    p1 = out_dir / f"{args.pair}_cheapest_hour_bars.png"
    fig.savefig(p1, dpi=130)
    plt.close(fig)

    # --- Chart 2: overlaid lines comparing intervals ---
    fig, ax = plt.subplots(figsize=(11, 5.5))
    cmap = plt.cm.viridis(np.linspace(0, 0.85, len(INTERVALS)))
    for color, n in zip(cmap, INTERVALS):
        ax.plot(results[n].index, results[n].values, marker="o", ms=4,
                color=color, label=f"last {n}Q ({meta[n][0]}d)")
    ax.axhline(uniform, color="#888", ls="--", lw=1, label=f"uniform ({uniform:.1f}%)")
    ax.set_xticks(range(24))
    ax.set_xlabel(f"hour of day ({args.tz})")
    ax.set_ylabel("% of days hour had the daily low")
    ax.set_title(f"{args.pair} - cheapest hour of day across lookback windows", fontweight="bold")
    ax.grid(alpha=0.25)
    ax.legend()
    fig.tight_layout()
    p2 = out_dir / f"{args.pair}_cheapest_hour_compare.png"
    fig.savefig(p2, dpi=130)
    plt.close(fig)

    print(f"Saved charts -> {p1}\n             -> {p2}")


if __name__ == "__main__":
    main()
