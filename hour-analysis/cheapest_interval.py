#!/usr/bin/env python3
"""Find the cheapest intraday interval (5/15/60-min) for BTC.

Same idea as cheapest_hour.py but at finer granularity: for each calendar day
(UTC) we find the intraday bucket whose `low` is the lowest of the day, then
report, per bucket, the percentage of days that bucket held the daily low.

Kraken timestamps are UTC; analysis is UTC by default.
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

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


def load(data_dir: Path, pair: str, gran: int, n_quarters: int, tz: str) -> pd.DataFrame:
    frames = []
    for q in QUARTERS[-n_quarters:]:
        fp = data_dir / q / f"{pair}_{gran}.csv"
        if fp.exists():
            frames.append(pd.read_csv(fp, header=None, names=COLUMNS))
    if not frames:
        raise FileNotFoundError(f"No {pair}_{gran}.csv for last {n_quarters}Q in {data_dir}")
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    dt = pd.to_datetime(df["ts"], unit="s", utc=True)
    if tz != "UTC":
        dt = dt.dt.tz_convert(tz)
    df["dt"] = dt
    df["date"] = df["dt"].dt.date
    df["bucket"] = (df["dt"].dt.hour * 60 + df["dt"].dt.minute) // gran
    return df


def distribution(df: pd.DataFrame, gran: int):
    n_buckets = 1440 // gran
    per_day = df.groupby("date")["bucket"].nunique()
    full_days = per_day[per_day == n_buckets].index
    n_dropped = int((per_day != n_buckets).sum())
    full = df[df["date"].isin(full_days)]
    idx_min = full.groupby("date")["low"].idxmin()
    cheap = full.loc[idx_min, "bucket"]
    counts = cheap.value_counts().reindex(range(n_buckets), fill_value=0).sort_index()
    pct = counts / len(full_days) * 100.0
    return pct, len(full_days), n_dropped


def label(bucket: int, gran: int) -> str:
    m = bucket * gran
    return f"{m // 60:02d}:{m % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(Path.home() / "Downloads" / "btc"))
    ap.add_argument("--pair", default="XBTUSD")
    ap.add_argument("--gran", type=int, default=5, choices=[5, 15, 60])
    ap.add_argument("--tz", default="UTC")
    ap.add_argument("--out-dir", default=str(Path(__file__).parent / "output"))
    ap.add_argument("--top", type=int, default=12)
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    gran = args.gran
    n_buckets = 1440 // gran
    uniform = 100.0 / n_buckets

    results, meta = {}, {}
    for n in INTERVALS:
        df = load(data_dir, args.pair, gran, n, args.tz)
        pct, n_days, n_dropped = distribution(df, gran)
        results[n] = pct
        meta[n] = (n_days, n_dropped)

    times = [label(b, gran) for b in range(n_buckets)]
    table = pd.DataFrame({f"{n}Q ({meta[n][0]}d)": results[n].values for n in INTERVALS},
                         index=times)
    table.index.name = f"{gran}min start ({args.tz})"
    csv_path = out_dir / f"{args.pair}_cheapest_{gran}min.csv"
    table.to_csv(csv_path, float_format="%.3f")

    print(f"\n=== {args.pair} @ {gran}-min: % of days each interval held the daily low ({args.tz}) ===")
    print(f"(uniform baseline = {uniform:.3f}% across {n_buckets} buckets)\n")
    for n in INTERVALS:
        top = results[n].sort_values(ascending=False).head(args.top)
        print(f"-- last {n}Q ({meta[n][0]} days, dropped {meta[n][1]} partial) — top {args.top} --")
        for b, v in top.items():
            print(f"     {label(b, gran)}  {v:5.2f}%   ({v / uniform:4.1f}x)")
        print()

    # Concentration around the midnight band: cumulative share in 23:00-01:00.
    print("Share of daily lows landing in the 23:00-01:00 UTC band:")
    for n in INTERVALS:
        pct = results[n]
        band = [b for b in range(n_buckets) if (label(b, gran) >= "23:00") or (label(b, gran) < "01:00")]
        print(f"  last {n}Q: {pct.iloc[band].sum():.1f}%")
    print(f"Saved table -> {csv_path}")

    # --- Chart: % vs time-of-day, one line per window ---
    x = np.arange(n_buckets) * gran / 60.0
    fig, ax = plt.subplots(figsize=(13, 6))
    cmap = plt.cm.viridis(np.linspace(0, 0.85, len(INTERVALS)))
    for color, n in zip(cmap, INTERVALS):
        ax.plot(x, results[n].values, color=color, lw=1.1,
                label=f"last {n}Q ({meta[n][0]}d)")
    ax.axhline(uniform, color="#888", ls="--", lw=1, label=f"uniform ({uniform:.2f}%)")
    ax.set_xticks(range(0, 25, 1))
    ax.set_xlim(0, 24)
    ax.set_xlabel(f"hour of day ({args.tz})")
    ax.set_ylabel(f"% of days the {gran}-min interval was the daily low")
    ax.set_title(f"{args.pair} - cheapest {gran}-min interval of day across lookback windows",
                 fontweight="bold")
    ax.grid(alpha=0.25)
    ax.legend()
    fig.tight_layout()
    p1 = out_dir / f"{args.pair}_cheapest_{gran}min_compare.png"
    fig.savefig(p1, dpi=130)
    plt.close(fig)

    # --- Chart: bars for the 9Q (most data) window, colored peak ---
    fig, ax = plt.subplots(figsize=(13, 4.5))
    pct9 = results[9]
    peak = int(pct9.values.argmax())
    colors = ["#e63946" if b == peak else "#4895ef" for b in range(n_buckets)]
    ax.bar(x, pct9.values, width=gran / 60.0 * 0.9, color=colors)
    ax.axhline(uniform, color="#888", ls="--", lw=1)
    ax.set_xticks(range(0, 25, 1))
    ax.set_xlim(0, 24)
    ax.set_xlabel(f"hour of day ({args.tz})")
    ax.set_ylabel("% of days (9Q)")
    ax.set_title(f"{args.pair} @ {gran}-min - daily-low distribution, last 9 quarters "
                 f"(peak {label(peak, gran)} = {pct9.max():.2f}%)", fontweight="bold")
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout()
    p2 = out_dir / f"{args.pair}_cheapest_{gran}min_9Q_bars.png"
    fig.savefig(p2, dpi=130)
    plt.close(fig)

    print(f"Saved charts -> {p1}\n             -> {p2}")


if __name__ == "__main__":
    main()
