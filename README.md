# CoinStrat — Bitcoin Pre-Accumulation Signal Engine

A macro-driven signal engine and interactive dashboard that identifies optimal Bitcoin accumulation windows by synthesising valuation, liquidity, currency, and business-cycle data into actionable signals.

## Overview

CoinStrat combines five scoring factors into two composite signals — **CORE** (stateful accumulation permission) and **MACRO** (intensity modifier) — to produce a final **ACCUM** signal that tells you *when* and *how aggressively* to dollar-cost average into Bitcoin.

The web dashboard fetches live data from FRED, Binance, Blockchain.info, and BGeometrics, computes all scores in the browser, and provides interactive charts, a score breakdown, logic-flow visualisation, and a full backtest simulator.

---

## Signal Architecture

### Scoring Factors

| Factor | Source | Range | What it measures |
|--------|--------|-------|------------------|
| **VAL_SCORE** | MVRV (Blockchain.info) + LTH SOPR (BGeometrics) | 0 / 1 / 2 / 3 | 4-tier on-chain valuation — 3 = extreme (MVRV < 1.0 AND LTH SOPR < 1.0), 2 = strong (MVRV < 1.0 alone, or MVRV < 1.8 + capitulation), 1 = fair/neutral (MVRV < 3.5, not cheap), 0 = euphoria (MVRV ≥ 3.5, near cycle peaks) |
| **LIQ_SCORE** | US Net Liquidity (FRED: WALCL − WTREGEN − RRPONTSYD) | 0 / 1 / 2 | Macro liquidity regime — YoY and 13-week momentum of Fed net liquidity |
| **DXY_SCORE** | USD Index (FRED: DTWEXBGS) | 0 / 1 / 2 | Currency headwind/tailwind — 200-day rate of change of the broad trade-weighted dollar. Includes a **20/30-day persistence filter** to prevent whipsaw entries |
| **CYCLE_SCORE** | Sahm Rule, Yield Curve, New Orders (FRED) | 0 / 1 / 2 | Business cycle positioning — recession risk vs expansion |
| **PRICE_REGIME_ON** | BTC 40-week MA | 0 / 1 | Trend confirmation — requires BTC above its 40W MA for ≥ 20 of the last 30 days |

### Signal Aggregation

```
CORE_ON (stateful, with hysteresis)
  Entry:  (VAL_SCORE >= 3) OR (VAL_SCORE >= 1 AND PRICE_REGIME = 1)
          AND DXY_SCORE ≥ 1 (persistence-filtered)
  Exit:   (PRICE_REGIME = 0 AND VAL_SCORE ≤ 2) OR (VAL_SCORE = 0 AND DXY_SCORE = 0)

MACRO_ON (stateless)
  (LIQ_SCORE + CYCLE_SCORE ≥ 3) AND (DXY_SCORE ≥ 1)

ACCUM_ON = CORE_ON
  CORE is the sole gatekeeper for accumulation permission.
  MACRO only modifies DCA intensity (3×) when CORE is already ON.
```

### Display-Only Metrics

These are charted for context but do not directly produce their own score:

- **G3 Global Liquidity** — Fed + ECB + BOJ total assets converted to USD
- **NUPL** — Net Unrealised Profit/Loss (BGeometrics) — mathematically related to MVRV, kept for visual confirmation

Note: **LTH SOPR** is now used in scoring — it amplifies VAL_SCORE in the MVRV fair-value zone (see above).

---

## Web Dashboard

### Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Live signal status, recommendation (PAUSE / BASE / ACCEL), snapshot metrics including BTC 40W MA, and recent signal history |
| **Score Breakdown** | Detailed view of each scoring factor with current values, thresholds, and input metrics |
| **Signal Synthesis** | Visual logic-flow showing how CORE, MACRO, and ACCUM gates combine |
| **Charts** | Interactive time-series for every metric, organised by category (System State, Valuation, Liquidity, Business Cycle, Global Liquidity). Includes regime-shaded backgrounds and BTC price overlays |
| **Backtest** | Full DCA backtest simulator with configurable time range, frequency, off-signal behaviour, and MACRO 3× acceleration |

### Backtest Simulator

Compare three strategies side-by-side:

1. **Baseline DCA** — constant dollar-cost averaging regardless of signals
2. **CoinStrat DCA** — buys only when ACCUM_ON (CORE) is active
3. **CoinStrat + MACRO 3×** — same as above but 3× DCA amount when MACRO_ON

Configurable parameters:
- **Time range**: 1Y, 2Y, 3Y, 4Y, 5Y, All (from Jan 2013), or custom date
- **DCA frequency**: daily, weekly, monthly
- **DCA amount**: USD per period
- **Off-signal behaviour**: pause buys, sell matching DCA amount, or sell entire position

Output metrics: Total Return, Final Portfolio Value, Total Invested, Total Withdrawn, BTC Accumulated, Max Drawdown.

---

## Data Sources

| Source | Series | Proxy |
|--------|--------|-------|
| **FRED** (Federal Reserve) | WALCL, WTREGEN, RRPONTSYD, DTWEXBGS, SAHMREALTIME, T10Y3M, AMTMNO, ECBASSETSW, JPNASSETS, DEXUSEU, DEXJPUS | Netlify Function (`/api/fred/`) |
| **Binance** | BTCUSDT klines (daily) | Direct client-side |
| **Blockchain.info** | MVRV ratio | Direct client-side |
| **BGeometrics** | LTH SOPR (`lth_sopr`), NUPL (`lth_nupl`) | Netlify Function (`/api/bgeometrics/`) |
| **Local** | `public/data/btc_daily.json` — historical BTC prices pre-2018 for backtest coverage | Bundled |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Vite |
| **UI** | Material UI 5, Tailwind CSS, Lucide icons |
| **Charting** | Recharts |
| **Serverless** | Netlify Functions (FRED + BGeometrics proxies) |
| **Hosting** | Netlify |

---

## Project Structure

```
pre-accumulation-model/
├── signals.py                  # Original Python signal engine
├── dashboard_2026.py           # Python dashboard / plotting
├── plot_*.py                   # Various Python plotting scripts
├── signals_*.csv               # Pre-computed signal CSVs
│
└── web/                        # Web dashboard (SPA)
    ├── netlify.toml             # Build + redirect config
    ├── netlify/functions/
    │   ├── fred.ts              # FRED API proxy
    │   └── bgeometrics.ts       # BGeometrics proxy
    ├── public/data/
    │   └── btc_daily.json       # Historical BTC prices
    └── src/
        ├── App.tsx              # Root layout, routing, data loading
        ├── theme.ts             # MUI dark theme
        ├── services/
        │   ├── engine.ts        # Core scoring + signal engine
        │   ├── crypto.ts        # BTC price, MVRV, LTH SOPR, NUPL fetchers
        │   ├── fred.ts          # FRED API client
        │   └── backtest.ts      # DCA backtest simulation engine
        └── views/
            ├── Dashboard.tsx    # Live signal dashboard
            ├── ScoreBreakdown.tsx
            ├── LogicFlow.tsx    # Signal synthesis visualisation
            ├── ChartsView.tsx   # All charts (valuation, liquidity, etc.)
            └── Backtest.tsx     # Backtest UI + charts
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A FRED API key (free at https://fred.stlouisfed.org/docs/api/api_key.html)

### Local Development

```bash
cd web
npm install

# Create .env with your FRED API key
echo "FRED_API_KEY=your_key_here" > .env

# Start dev server (with Netlify Functions)
npx netlify dev
```

The app will be available at `http://localhost:8888`.

### Build for Production

```bash
cd web
npm run build
```

Output is in `web/dist/`, ready for deployment to Netlify or any static host.

### Deploy to Netlify

```bash
cd web
npx netlify deploy --prod
```

Ensure the `FRED_API_KEY` environment variable is set in your Netlify site settings.

---

## NaN Handling

When input data is unavailable (e.g. a FRED series hasn't updated yet), the engine carries forward the **last valid score** for each factor rather than defaulting to 0. A console warning is logged so you can identify when scores may be approximate.

---

## Key Design Decisions

1. **CORE as sole gatekeeper** — ACCUM_ON equals CORE_ON. MACRO cannot independently permit accumulation; it only amplifies the DCA amount (3×) when CORE is already active. This prevents buying during structurally unfavourable periods.

2. **Persistence filters** — Both PRICE_REGIME and DXY_SCORE use a 20-of-30-day rolling persistence filter to smooth out short-term noise and prevent whipsaw entries/exits.

3. **Stateful CORE with hysteresis** — CORE uses separate entry and exit conditions, preventing rapid on/off cycling. Entry requires favourable valuation + DXY; exit requires *both* DXY headwind *and* bearish price regime.

4. **Browser-side computation** — All scoring runs in the client. This keeps the architecture simple (no backend database), enables instant what-if exploration, and avoids stale pre-computed signals.

---

## License

Private — all rights reserved.
