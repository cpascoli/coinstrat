#!/usr/bin/env python3
"""Does the 'cheapest hour' pattern hold for every day of the week?

For each calendar day (UTC) we find the hour with the lowest `low`, tag it with
the day's weekday, then within each weekday report the % of those days that each
hour held the daily low. Output is a weekday x hour heatmap + table.

Uses hourly Kraken CSVs (XBT<FIAT>_60.csv). UTC by default.
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

QUARTERS = [
    "Kraken_OHLCVT_Q1_2024", "Kraken_OHLCVT_Q2_2024", "Kraken_OHLCVT_Q3_2024",
    "Kraken_OHLCVT_Q4_2024", "Kraken_OHLCVT_Q1_2025", "Kraken_OHLCVT_Q2_2025",
    "Kraken_OHLCVT_Q3_2025", "Kraken_OHLCVT_Q4_2025", "Kraken_OHLCVT_Q1_2026",
]
COLUMNS = ["ts", "open", "high", "low", "close", "volume", "trades"]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load(data_dir: Path, pair: str, n_quarters: int, tz: str) -> pd.DataFrame:
    frames = []
    for q in QUARTERS[-n_quarters:]:
        fp = data_dir / q / f"{pair}_60.csv"
        if fp.exists():
            frames.append(pd.read_csv(fp, header=None, names=COLUMNS))
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    dt = pd.to_datetime(df["ts"], unit="s", utc=True)
    if tz != "UTC":
        dt = dt.dt.tz_convert(tz)
    df["dt"] = dt
    df["date"] = df["dt"].dt.date
    df["hour"] = df["dt"].dt.hour
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(Path.home() / "Downloads" / "btc"))
    ap.add_argument("--pair", default="XBTUSD")
    ap.add_argument("--quarters", type=int, default=9, help="lookback window in quarters")
    ap.add_argument("--tz", default="UTC")
    ap.add_argument("--out-dir", default=str(Path(__file__).parent / "output"))
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df = load(data_dir, args.pair, args.quarters, args.tz)
    hours_per_day = df.groupby("date")["hour"].nunique()
    full_days = hours_per_day[hours_per_day == 24].index
    full = df[df["date"].isin(full_days)].copy()

    idx_min = full.groupby("date")["low"].idxmin()
    cheap = full.loc[idx_min, ["date", "hour"]].copy()
    cheap["weekday"] = pd.to_datetime(cheap["date"]).dt.weekday  # 0=Mon

    # Counts of (weekday, hour) and per-weekday day totals.
    counts = (cheap.groupby(["weekday", "hour"]).size()
              .unstack(fill_value=0).reindex(index=range(7), columns=range(24), fill_value=0))
    day_totals = cheap.groupby("weekday").size().reindex(range(7), fill_value=0)
    pct = counts.div(day_totals, axis=0) * 100.0
    pct.index = WEEKDAYS

    print(f"\n=== {args.pair}: cheapest-hour distribution by weekday "
          f"(last {args.quarters}Q, {len(full_days)} days, {args.tz}) ===\n")
    print("Days per weekday:")
    for wd, tot in zip(WEEKDAYS, day_totals):
        print(f"  {wd}: {tot}")

    print("\nPeak (most common low) hour per weekday:")
    for wd in WEEKDAYS:
        row = pct.loc[wd]
        top = row.sort_values(ascending=False).head(3)
        items = ", ".join(f"{h:02d}:00 ({v:.1f}%)" for h, v in top.items())
        print(f"  {wd}: {items}")

    band = [23, 0]  # 23:00 and 00:00 hour buckets (the midnight cluster)
    print("\nShare of daily lows in the 23:00-01:00 UTC band, by weekday:")
    for wd in WEEKDAYS:
        s = pct.loc[wd, [23, 0, 1]].sum()
        print(f"  {wd}: {s:.1f}%  (hour 00 alone: {pct.loc[wd, 0]:.1f}%)")

    csv_path = out_dir / f"{args.pair}_cheapest_hour_by_weekday_{args.quarters}Q.csv"
    pct.to_csv(csv_path, float_format="%.2f")
    print(f"\nSaved table -> {csv_path}")

    # --- Heatmap weekday x hour ---
    fig, ax = plt.subplots(figsize=(13, 4.8))
    data = pct.values
    im = ax.imshow(data, aspect="auto", cmap="magma", origin="upper")
    ax.set_xticks(range(24))
    ax.set_xticklabels(range(24))
    ax.set_yticks(range(7))
    ax.set_yticklabels(WEEKDAYS)
    ax.set_xlabel(f"hour of day ({args.tz})")
    ax.set_title(f"{args.pair} - % of days each hour held the daily low, by weekday "
                 f"(last {args.quarters}Q)", fontweight="bold")
    for i in range(7):
        for j in range(24):
            v = data[i, j]
            if v >= 6:
                ax.text(j, i, f"{v:.0f}", ha="center", va="center",
                        color="white" if v < data.max() * 0.6 else "black", fontsize=7)
    cbar = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
    cbar.set_label("% of that weekday's days")
    fig.tight_layout()
    p1 = out_dir / f"{args.pair}_cheapest_hour_by_weekday_{args.quarters}Q.png"
    fig.savefig(p1, dpi=130)
    plt.close(fig)

    # --- Small multiples: one bar panel per weekday ---
    fig, axes = plt.subplots(7, 1, figsize=(11, 11), sharex=True)
    uniform = 100.0 / 24.0
    for ax, wd in zip(axes, WEEKDAYS):
        row = pct.loc[wd]
        peak = int(row.values.argmax())
        colors = ["#e63946" if h == peak else "#457b9d" for h in range(24)]
        ax.bar(range(24), row.values, color=colors)
        ax.axhline(uniform, color="#888", ls="--", lw=0.8)
        ax.set_ylabel(wd)
        ax.set_xticks(range(24))
        ax.grid(axis="y", alpha=0.2)
        ax.text(0.99, 0.85, f"peak {peak:02d}:00 = {row.max():.1f}%",
                transform=ax.transAxes, ha="right", va="top", fontsize=8,
                color="#e63946", fontweight="bold")
    axes[-1].set_xlabel(f"hour of day ({args.tz})")
    fig.suptitle(f"{args.pair} - cheapest hour by weekday (last {args.quarters}Q, "
                 f"dashed = uniform {uniform:.1f}%)", fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.98])
    p2 = out_dir / f"{args.pair}_cheapest_hour_by_weekday_{args.quarters}Q_bars.png"
    fig.savefig(p2, dpi=130)
    plt.close(fig)

    print(f"Saved charts -> {p1}\n             -> {p2}")


if __name__ == "__main__":
    main()
