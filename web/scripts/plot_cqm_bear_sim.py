#!/usr/bin/env python3
"""
Plot the CQM Risk DCA bot bear/bull simulation.

Reads the daily series exported by `cqm-bear-sim.mts`
(`output/cqm-bear-sim-data.json`) and renders, for each scenario:
  1. Price (log) vs CQM QR-50% fair value vs running avg cost basis (USD)
  2. CQM Risk over time with cool/warm/hot/euphoric bands
  3. Daily trade sizing (buy = green up, sell = red down)
  4. Cumulative BTC accumulated (bot auto-sell vs buy-and-hold)
  5. Portfolio value vs capital deployed (GBP) with underwater shading
  6. Drawdown vs capital deployed (%)

Plus a comparison figure overlaying both scenarios, and a portfolio
value / capital invested / profit-&-loss / ROI figure.

Run:
  .venv-eqm/bin/python web/scripts/plot_cqm_bear_sim.py
"""
import json
import os
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "output"
# Keep matplotlib's cache inside the workspace (sandbox-friendly, no warning).
os.environ.setdefault("MPLCONFIGDIR", str(OUT_DIR / ".mplcache"))
(OUT_DIR / ".mplcache").mkdir(parents=True, exist_ok=True)

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np

plt.style.use("seaborn-v0_8-darkgrid")

DATA_PATH = OUT_DIR / "cqm-bear-sim-data.json"

COL_MID = "#f59e0b"   # amber
COL_DEEP = "#ef4444"  # red
COL_PRICE = "#e5e7eb"
COL_FAIR = "#facc15"
COL_COST = "#38bdf8"
COL_BUY = "#22c55e"
COL_SELL = "#ef4444"
COL_BOT = "#60a5fa"
COL_HOLD = "#a78bfa"


def load():
    with open(DATA_PATH) as fh:
        return json.load(fh)


def to_dates(rows):
    return [datetime.strptime(r["date"], "%Y-%m-%d") for r in rows]


def col(rows, key):
    return np.array([r[key] for r in rows], dtype=float)


def derive(meta, rows):
    """Compute the derived series used across panels."""
    gbpusd = meta["gbpUsd"]
    btc_gbp = col(rows, "btcGbp")
    bot_btc = col(rows, "botBtc")
    hold_btc = col(rows, "holdBtc")
    invested = col(rows, "grossInvestedGbp")
    sold = col(rows, "grossSoldGbp")
    cost_rem = col(rows, "costBasisGbpRemaining")

    equity_bot = bot_btc * btc_gbp + sold
    equity_hold = hold_btc * btc_gbp
    net_invested = invested - sold
    with np.errstate(divide="ignore", invalid="ignore"):
        avg_cost_gbp = np.where(bot_btc > 0, cost_rem / bot_btc, np.nan)
        dd_vs_capital = np.where(invested > 0, equity_bot / invested - 1.0, 0.0)
    avg_cost_usd = avg_cost_gbp * gbpusd
    return {
        "equity_bot": equity_bot,
        "equity_hold": equity_hold,
        "invested": invested,
        "net_invested": net_invested,
        "avg_cost_usd": avg_cost_usd,
        "dd_vs_capital": dd_vs_capital,
        "bot_btc": bot_btc,
        "hold_btc": hold_btc,
    }


def sustained_breakeven_idx(equity, invested):
    """Index of the first day after which equity never dips below invested."""
    underwater = equity < invested
    last_uw = -1
    for i, uw in enumerate(underwater):
        if uw:
            last_uw = i
    if last_uw < 0:
        return 0
    return min(last_uw + 1, len(equity) - 1)


def risk_bands(ax):
    ax.axhspan(0, 25, color="#22c55e", alpha=0.10)
    ax.axhspan(25, 50, color="#84cc16", alpha=0.10)
    ax.axhspan(50, 75, color="#f59e0b", alpha=0.10)
    ax.axhspan(75, 100, color="#ef4444", alpha=0.12)


def year_axis(ax):
    ax.xaxis.set_major_locator(mdates.YearLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))


def fmt_gbp(x, _pos=None):
    if abs(x) >= 1_000_000:
        return f"£{x/1e6:.1f}M"
    if abs(x) >= 1_000:
        return f"£{x/1e3:.0f}k"
    return f"£{x:.0f}"


def fmt_usd(x, _pos=None):
    if abs(x) >= 1_000:
        return f"${x/1e3:.0f}k"
    return f"${x:.0f}"


def plot_scenario(meta, scenario, color):
    rows = scenario["rows"]
    label = scenario["label"]
    dts = to_dates(rows)
    price = col(rows, "priceUsd")
    fair = col(rows, "fairUsd")
    risk = col(rows, "risk") * 100
    buy = col(rows, "buyGbp")
    sell = col(rows, "sellGbp")
    d = derive(meta, rows)

    be_idx = sustained_breakeven_idx(d["equity_bot"], d["invested"])
    peak_dt = datetime.strptime(meta["peakDate"], "%Y-%m-%d")
    trough_i = int(np.argmin(d["dd_vs_capital"]))

    fig, axes = plt.subplots(3, 2, figsize=(16, 13))
    fig.suptitle(
        f"CQM Risk DCA bot — {label}\n"
        f"£{meta['baseGbp']}/day · target = base × (1 − 2 × Risk) · GBPUSD {meta['gbpUsd']}",
        fontsize=14, fontweight="bold",
    )

    # 1) Price vs fair vs cost basis (log USD)
    ax = axes[0, 0]
    ax.plot(dts, price, color=COL_PRICE, lw=1.4, label="BTC price")
    ax.plot(dts, fair, color=COL_FAIR, lw=1.6, ls="--", label="CQM QR-50% fair value")
    ax.plot(dts, d["avg_cost_usd"], color=COL_COST, lw=1.6, label="Avg cost basis")
    ax.set_yscale("log")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt_usd))
    ax.axvline(peak_dt, color="#94a3b8", ls=":", lw=1)
    ax.set_title("Price vs fair value vs avg cost basis (log)")
    ax.legend(fontsize=8, loc="upper left")
    year_axis(ax)

    # 2) CQM risk
    ax = axes[0, 1]
    risk_bands(ax)
    ax.plot(dts, risk, color=color, lw=1.5)
    ax.axhline(50, color="#94a3b8", ls="--", lw=1)
    ax.set_ylim(0, 100)
    ax.set_ylabel("CQM Risk (%)")
    ax.set_title("CQM Risk (buy below 50%, sell above)")
    year_axis(ax)

    # 3) Daily sizing
    ax = axes[1, 0]
    ax.bar(dts, buy, color=COL_BUY, width=1.0, label="Buy £")
    ax.bar(dts, -sell, color=COL_SELL, width=1.0, label="Sell £")
    ax.axhline(0, color="#475569", lw=0.8)
    ax.set_ylabel("Daily trade (£)")
    ax.set_title("Daily trade sizing")
    ax.legend(fontsize=8, loc="upper left")
    year_axis(ax)

    # 4) Cumulative BTC
    ax = axes[1, 1]
    ax.plot(dts, d["hold_btc"], color=COL_HOLD, lw=1.6, label="Buy & hold (no sells)")
    ax.plot(dts, d["bot_btc"], color=COL_BOT, lw=1.6, label="Bot (auto-sell)")
    ax.set_ylabel("BTC accumulated")
    ax.set_title("Cumulative BTC")
    ax.legend(fontsize=8, loc="upper left")
    year_axis(ax)

    # 5) Portfolio value vs capital deployed
    ax = axes[2, 0]
    ax.plot(dts, d["invested"], color="#94a3b8", lw=1.4, label="Capital deployed (gross)")
    ax.plot(dts, d["equity_bot"], color=color, lw=1.7, label="Portfolio value")
    underwater = d["equity_bot"] < d["invested"]
    ax.fill_between(dts, d["equity_bot"], d["invested"], where=underwater,
                    color="#ef4444", alpha=0.25, label="Underwater")
    ax.axvline(dts[be_idx], color="#22c55e", ls=":", lw=1.2)
    ax.text(dts[be_idx], ax.get_ylim()[1] * 0.6, " break-even", color="#22c55e", fontsize=8)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt_gbp))
    ax.set_title("Portfolio value vs capital deployed")
    ax.legend(fontsize=8, loc="upper left")
    year_axis(ax)

    # 6) Underwater plot: drawdown vs capital deployed (positives clipped to 0)
    ax = axes[2, 1]
    uw = np.minimum(d["dd_vs_capital"] * 100, 0.0)
    ax.plot(dts, uw, color="#ef4444", lw=1.3)
    ax.fill_between(dts, uw, 0, color="#ef4444", alpha=0.25)
    ax.axhline(0, color="#475569", lw=0.8)
    ax.scatter([dts[trough_i]], [uw[trough_i]], color="#b91c1c", zorder=5)
    ax.annotate(f"max DD {uw[trough_i]:.1f}%\n{rows[trough_i]['date']}",
                (dts[trough_i], uw[trough_i]), textcoords="offset points",
                xytext=(10, 6), fontsize=8, color="#b91c1c")
    ax.set_ylabel("Underwater vs capital (%)")
    ax.set_ylim(min(uw.min() * 1.25, -2), 1)
    ax.set_title("Drawdown vs capital deployed (underwater plot)")
    year_axis(ax)

    fig.tight_layout(rect=(0, 0, 1, 0.96))
    slug = "mid" if "MID" in label else "deep"
    out = OUT_DIR / f"cqm_bear_sim_{slug}.png"
    fig.savefig(out, dpi=130)
    plt.close(fig)
    return out


def plot_compare(meta, scenarios):
    series = []
    for sc, color, name in (
        (scenarios[0], COL_MID, "Mid bear"),
        (scenarios[1], COL_DEEP, "Deep bear"),
    ):
        rows = sc["rows"]
        series.append({
            "name": name,
            "color": color,
            "dts": to_dates(rows),
            "price": col(rows, "priceUsd"),
            "risk": col(rows, "risk") * 100,
            "d": derive(meta, rows),
        })

    fig, axes = plt.subplots(2, 2, figsize=(16, 10))
    fig.suptitle("CQM Risk DCA bot — mid bear vs deep bear", fontsize=14, fontweight="bold")

    ax = axes[0, 0]
    for s in series:
        ax.plot(s["dts"], s["price"], color=s["color"], lw=1.5, label=s["name"])
    ax.set_yscale("log")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt_usd))
    ax.set_title("BTC price path (log)")
    ax.legend(fontsize=9)
    year_axis(ax)

    ax = axes[0, 1]
    risk_bands(ax)
    for s in series:
        ax.plot(s["dts"], s["risk"], color=s["color"], lw=1.5, label=s["name"])
    ax.axhline(50, color="#94a3b8", ls="--", lw=1)
    ax.set_ylim(0, 100)
    ax.set_title("CQM Risk (%)")
    ax.legend(fontsize=9)
    year_axis(ax)

    ax = axes[1, 0]
    for s in series:
        ax.plot(s["dts"], s["d"]["bot_btc"], color=s["color"], lw=1.6, label=s["name"])
    ax.set_title("Cumulative BTC (bot)")
    ax.legend(fontsize=9)
    year_axis(ax)

    ax = axes[1, 1]
    uw_min = 0.0
    for s in series:
        uw = np.minimum(s["d"]["dd_vs_capital"] * 100, 0.0)
        uw_min = min(uw_min, float(uw.min()))
        ax.plot(s["dts"], uw, color=s["color"], lw=1.5, label=s["name"])
        ax.fill_between(s["dts"], uw, 0, color=s["color"], alpha=0.12)
    ax.axhline(0, color="#475569", lw=0.8)
    ax.set_ylim(uw_min * 1.25, 1)
    ax.set_title("Drawdown vs capital deployed (underwater plot, %)")
    ax.legend(fontsize=9)
    year_axis(ax)

    fig.tight_layout(rect=(0, 0, 1, 0.95))
    out = OUT_DIR / "cqm_bear_sim_compare.png"
    fig.savefig(out, dpi=130)
    plt.close(fig)
    return out


def plot_value_invested_pnl(meta, scenarios):
    """Portfolio value, capital invested and profit & loss, both scenarios."""
    series = []
    for sc, color, name in (
        (scenarios[0], COL_MID, "Mid bear"),
        (scenarios[1], COL_DEEP, "Deep bear"),
    ):
        rows = sc["rows"]
        d = derive(meta, rows)
        pnl = d["equity_bot"] - d["invested"]
        with np.errstate(divide="ignore", invalid="ignore"):
            roi = np.where(d["invested"] > 0, pnl / d["invested"] * 100, 0.0)
        series.append({
            "name": name,
            "color": color,
            "dts": to_dates(rows),
            "value": d["equity_bot"],
            "invested": d["invested"],
            "net_invested": d["net_invested"],
            "pnl": pnl,
            "roi": roi,
        })

    peak_dt = datetime.strptime(meta["peakDate"], "%Y-%m-%d")
    fig, axes = plt.subplots(2, 2, figsize=(16, 10))
    fig.suptitle(
        "CQM Risk DCA bot — portfolio value, capital invested & P&L",
        fontsize=14, fontweight="bold",
    )

    # 1) Portfolio value (current holdings marked-to-market + cash realized)
    ax = axes[0, 0]
    for s in series:
        ax.plot(s["dts"], s["value"], color=s["color"], lw=1.7, label=s["name"])
    ax.axvline(peak_dt, color="#94a3b8", ls=":", lw=1)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt_gbp))
    ax.set_title("Portfolio value (holdings + realized cash)")
    ax.legend(fontsize=9, loc="upper left")
    year_axis(ax)

    # 2) Capital invested (gross deployed; net = gross − sells)
    ax = axes[0, 1]
    for s in series:
        ax.plot(s["dts"], s["invested"], color=s["color"], lw=1.7, label=f"{s['name']} gross")
        ax.plot(s["dts"], s["net_invested"], color=s["color"], lw=1.2, ls="--",
                label=f"{s['name']} net (− sells)")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt_gbp))
    ax.set_title("Capital invested")
    ax.legend(fontsize=8, loc="upper left")
    year_axis(ax)

    # 3) Profit & loss (£) = portfolio value − gross invested
    ax = axes[1, 0]
    for s in series:
        ax.plot(s["dts"], s["pnl"], color=s["color"], lw=1.7, label=s["name"])
        ax.fill_between(s["dts"], s["pnl"], 0, where=s["pnl"] < 0,
                        color=s["color"], alpha=0.18)
    ax.axhline(0, color="#475569", lw=0.9)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(fmt_gbp))
    ax.set_title("Profit & loss (£)")
    ax.legend(fontsize=9, loc="upper left")
    year_axis(ax)

    # 4) ROI (%) = P&L / gross invested
    ax = axes[1, 1]
    for s in series:
        ax.plot(s["dts"], s["roi"], color=s["color"], lw=1.7, label=s["name"])
    ax.axhline(0, color="#475569", lw=0.9)
    ax.set_ylabel("ROI (%)")
    ax.set_title("Return on invested capital (%)")
    ax.legend(fontsize=9, loc="upper left")
    year_axis(ax)

    fig.tight_layout(rect=(0, 0, 1, 0.95))
    out = OUT_DIR / "cqm_bear_sim_value_pnl.png"
    fig.savefig(out, dpi=130)
    plt.close(fig)
    return out


def main():
    data = load()
    meta = data["meta"]
    scenarios = data["scenarios"]
    outputs = []
    outputs.append(plot_scenario(meta, scenarios[0], COL_MID))
    outputs.append(plot_scenario(meta, scenarios[1], COL_DEEP))
    outputs.append(plot_compare(meta, scenarios))
    outputs.append(plot_value_invested_pnl(meta, scenarios))
    print("Wrote:")
    for o in outputs:
        print(f"  {o}")


if __name__ == "__main__":
    main()
