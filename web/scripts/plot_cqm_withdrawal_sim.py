#!/usr/bin/env python3
"""
Plot the CQM forward "deposit then withdraw" simulation.

Reads the daily series exported by tests/cqm-forward-withdrawal.test.ts
(`output/cqm-withdrawal-sim-data.json`) and renders a single PNG with:
  1. Simulated Bitcoin price (log scale)
  2. Deposits  — cumulative + the $500/day deposit window shaded
  3. Withdrawals — cumulative + monthly $10k markers
  4. Portfolio value — BTC vs cash split, vs net capital contributed

Run:
  MPLCONFIGDIR=web/scripts/output/.mplcache \
    .venv/bin/python web/scripts/plot_cqm_withdrawal_sim.py
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "output"
os.environ.setdefault("MPLCONFIGDIR", str(OUT_DIR / ".mplcache"))
(OUT_DIR / ".mplcache").mkdir(parents=True, exist_ok=True)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
import numpy as np

DATA = OUT_DIR / (sys.argv[1] if len(sys.argv) > 1 else "cqm-withdrawal-sim-data.json")
OUT_PNG = OUT_DIR / (sys.argv[2] if len(sys.argv) > 2 else "cqm_withdrawal_sim.png")


def usd(x, _pos=None):
    ax = abs(x)
    if ax >= 1_000_000:
        return f"${x/1_000_000:.1f}M"
    if ax >= 1_000:
        return f"${x/1_000:.0f}k"
    return f"${x:.0f}"


def main():
    payload = json.loads(DATA.read_text())
    meta = payload["meta"]
    rows = payload["rows"]

    dates = [datetime.strptime(r["date"], "%Y-%m-%d") for r in rows]
    price = np.array([r["price"] for r in rows])
    btc_value = np.array([r["btcValue"] for r in rows])
    cash = np.array([r["cash"] for r in rows])
    pv = np.array([r["portfolioValue"] for r in rows])
    cum_dep = np.array([r["cumDeposits"] for r in rows])
    cum_wd = np.array([r["cumWithdrawals"] for r in rows])
    net_contrib = cum_dep - cum_wd

    dep_cutoff = datetime.strptime(meta["depositCutoff"], "%Y-%m-%d")
    wd_start = datetime.strptime(meta["withdrawalStart"], "%Y-%m-%d")
    start = dates[0]
    summary = meta["summary"]

    # Monthly withdrawal markers
    wd_dates = [d for d, r in zip(dates, rows) if r["withdrawalToday"] > 0]
    wd_amts = [r["withdrawalToday"] for r in rows if r["withdrawalToday"] > 0]

    plt.rcParams.update({"font.size": 10, "axes.grid": True, "grid.alpha": 0.25,
                         "text.parse_math": False})
    scenario = meta.get("scenario", "median")
    fig, axes = plt.subplots(4, 1, figsize=(13, 15), sharex=True)
    fig.suptitle(
        f"CQM Risk DCA — $500/day for 18 months, then $10k/month withdrawals "
        f"({scenario} scenario, seed 0x{meta['seed']:x})",
        fontsize=14, fontweight="bold", y=0.995,
    )

    # ---- Panel 1: Bitcoin price -------------------------------------------
    ax = axes[0]
    ax.plot(dates, price, color="#f7931a", lw=1.4)
    ax.set_yscale("log")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(usd))
    ax.yaxis.set_minor_formatter(mticker.NullFormatter())
    ax.set_ylabel("BTC price (log)")
    ax.set_title("Simulated Bitcoin price", loc="left", fontsize=11, fontweight="bold")
    peak_i = int(np.argmax(price))
    ax.annotate(f"peak {usd(price[peak_i])}\n{dates[peak_i]:%b %Y}",
                xy=(dates[peak_i], price[peak_i]),
                xytext=(0, 14), textcoords="offset points",
                ha="center", fontsize=8.5,
                arrowprops=dict(arrowstyle="->", color="#999"))

    # ---- Panel 2: Deposits -------------------------------------------------
    ax = axes[1]
    ax.fill_between(dates, 0, cum_dep, color="#2e7d32", alpha=0.18)
    ax.plot(dates, cum_dep, color="#2e7d32", lw=1.8, label="Cumulative deposits")
    ax.axvspan(start, dep_cutoff, color="#2e7d32", alpha=0.07)
    ax.axvline(dep_cutoff, color="#2e7d32", ls="--", lw=1)
    ax.annotate("deposits stop\n(18 months)", xy=(dep_cutoff, cum_dep.max()),
                xytext=(8, -28), textcoords="offset points", fontsize=8.5,
                color="#2e7d32")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(usd))
    ax.set_ylabel("USD")
    ax.set_title(f"Deposits — $500/day until {meta['depositCutoff']} "
                 f"(total {usd(summary['totalDeposited'])})",
                 loc="left", fontsize=11, fontweight="bold")
    ax.legend(loc="lower right", fontsize=9)

    # ---- Panel 3: Withdrawals ---------------------------------------------
    ax = axes[2]
    ax.fill_between(dates, 0, cum_wd, color="#c62828", alpha=0.15)
    ax.plot(dates, cum_wd, color="#c62828", lw=1.8, label="Cumulative withdrawals")
    ax.scatter(wd_dates, np.full(len(wd_dates), 0), s=10, color="#c62828",
               alpha=0.6, label="$10k monthly draw")
    ax.axvline(wd_start, color="#c62828", ls="--", lw=1)
    ax.annotate("withdrawals\nbegin", xy=(wd_start, cum_wd.max() * 0.85),
                xytext=(8, 0), textcoords="offset points", fontsize=8.5,
                color="#c62828")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(usd))
    ax.set_ylabel("USD")
    ax.set_title(f"Withdrawals — $10,000/month from {meta['withdrawalStart']} "
                 f"(total {usd(summary['totalWithdrawn'])})",
                 loc="left", fontsize=11, fontweight="bold")
    ax.legend(loc="upper left", fontsize=9)

    # ---- Panel 4: Portfolio value -----------------------------------------
    ax = axes[3]
    ax.stackplot(dates, btc_value, cash,
                 labels=["BTC value", "Cash"],
                 colors=["#f7931a", "#90caf9"], alpha=0.85)
    ax.plot(dates, pv, color="#212121", lw=1.6, label="Portfolio value")
    ax.plot(dates, net_contrib, color="#6a1b9a", lw=1.4, ls="--",
            label="Net capital contributed (deposits − withdrawals)")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(usd))
    ax.set_ylabel("USD")
    final_v = pv[-1]
    ax.annotate(f"final {usd(final_v)}", xy=(dates[-1], final_v),
                xytext=(-10, 12), textcoords="offset points", ha="right",
                fontsize=9, fontweight="bold")
    ax.set_title(f"Portfolio value — ends {usd(final_v)} "
                 f"({scenario}; cohort {usd(summary['minFinal'])}–{usd(summary['maxFinal'])})",
                 loc="left", fontsize=11, fontweight="bold")
    ax.legend(loc="upper left", fontsize=9)

    ax.xaxis.set_major_locator(mdates.YearLocator())
    ax.xaxis.set_minor_locator(mdates.MonthLocator((1, 4, 7, 10)))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
    ax.set_xlabel("Date")

    fig.tight_layout(rect=[0, 0, 1, 0.99])
    fig.savefig(OUT_PNG, dpi=140, bbox_inches="tight")
    print(f"Wrote {OUT_PNG}")


if __name__ == "__main__":
    main()
