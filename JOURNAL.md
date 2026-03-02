# CoinStrat Development Journal

A chronological log of the development of the CoinStrat Pre-Accumulation Model — from a pair of Python scripts to a full React/TypeScript web application with live data, backtesting, and a refined signal engine.

---

## Session 1 — ~24 Dec 2025

### Work done

- **Reviewed the original Python scripts** (`signals.py`, `dashboard_2026.py`) that formed the foundation of the model: a multi-factor regime-switching system for Bitcoin accumulation timing.
- **Architecture assessment**: Documented the data ingestion layer (FRED, Blockchain.info, Stooq), signal generation (VAL_SCORE, LIQ_SCORE, DXY_SCORE, CYCLE_SCORE), aggregator logic (CORE_ON, MACRO_ON, ACCUM_ON), and presentation layer.
- **Identified strengths and weaknesses**: Praised the macro-fundamental alignment and hysteresis design; flagged the lack of backtesting, single-metric valuation (MVRV-only), no persistence filters, and fragile data dependencies.
- **Built the React/TypeScript web application** from scratch: Vite + React + Tailwind CSS + Recharts. Created the full directory structure with proper separation of concerns (`services/`, `views/`).
- **Translated the Python engine into TypeScript** (`engine.ts`): Replicated rolling means, pct change, diff, scoring logic, and the CORE/MACRO state machines entirely in the browser.
- **Pivoted architecture**: Originally planned to use Python-generated JSON. User correctly insisted on a fully client-side engine so the static Netlify site could show live data on every visit. This was a key architectural decision.
- **Created Netlify deployment config**: `netlify.toml` with build settings and SPA redirects; Netlify Functions for FRED API proxy (to secure the API key and bypass CORS).

### Challenges

- **CoinGecko API limit**: The free tier only allows 365 days of historical data. Had to switch BTC price source to Blockchain.info.
- **Blockchain.info 404 for MVRV**: The API required specific undocumented parameters (`sampled=true&metadata=false&daysAverageString=1d`). User discovered the correct URL by inspecting their browser.
- **TypeScript build errors**: `import.meta.env` typing required adding `"types": ["vite/client"]` to tsconfig; Vite's module resolution rejected `.tsx` file extensions in imports.

### Learnings

- Static sites can be surprisingly powerful when the computation runs client-side. The trade-off is initial load time vs. operational simplicity.
- Free-tier API limitations are a real constraint for financial data. Always have a fallback data source plan.

### Reflections

The Python scripts were a solid prototype. Translating the logic into TypeScript forced a deeper understanding of every calculation — the kind of rigour you get from rewriting, not just reading.

---

## Session 2 — ~25–26 Dec 2025

### Work done

- **Debugged Blockchain.info data gaps**: The `market-price` endpoint returns data points with multi-day gaps (sampled, not daily). This broke rolling calculations.
- **Tried Stooq as BTC price source**: Created a Netlify Function (`stooq.ts`) to proxy CSV data. Hit a routing issue — the SPA catch-all redirect was intercepting `/api/stooq` before the function redirect. Fixed by reordering `netlify.toml` rules.
- **Discovered Stooq skips weekends**: Stooq treats BTC like a traditional asset and omits Saturday/Sunday data. This creates gaps that compound in rolling windows.
- **Implemented the hybrid BTC price strategy**: User provided a local JSON file (`btc_daily.json`) with historical daily closes. Combined with live data from Binance API's `klines` endpoint using `fetchBinanceKlines` + `mergeUnique`. Deleted the now-unnecessary Stooq proxy function.
- **Fixed chart rendering**: Charts tab was completely blank. Root causes: log scale with zero/NaN values, missing date parsing, animation overhead with large datasets. Fixed by switching to linear scale, adding defensive checks, and disabling Recharts animations.
- **Data alignment overhaul**: Rewrote the engine's data alignment to generate a continuous daily timeline from the first BTC data point to today, then forward-fill all series. This eliminated gaps from weekly/monthly FRED data and ensured consistent array indexing.

### Challenges

- **The BTC price data journey** (CoinGecko → Blockchain.info → Stooq → Hybrid) was the most time-consuming part. Each source had a different failure mode: API limits, data gaps, weekend skipping, CORS restrictions.
- **Netlify redirect ordering** is a subtle gotcha. The catch-all SPA rule must always be last, or it swallows API requests silently (returning `index.html` as if it were JSON).

### Learnings

- For financial time series, data quality is everything. A single gap in daily data can cascade through rolling windows and produce NaN scores for weeks.
- The hybrid approach (local historical + live API tail) is a robust pattern for financial apps: deep history is static and reliable, only the recent tail needs live fetching.

### Reflections

What started as "just swap the data source" turned into a multi-day journey through four different BTC price APIs. The lesson: financial data that seems trivially available ("just get the BTC price") is surprisingly hard to get reliably, continuously, and for free.

---

## Session 3 — ~Jan 2026 (early)

### Work done

- **Full architecture review of the web app**: Revisited the signal engine, data feeds, scoring, and signal logic with fresh eyes. Provided qualitative and quantitative assessment.
- **Built the backtest engine** (`backtest.ts`): Designed and implemented a full backtesting system with:
  - Multiple strategies: Baseline DCA, CoinStrat DCA (pause buys), Sell matching, Sell all.
  - Configurable time ranges (1Y, 2Y, 3Y, 4Y, 5Y, All).
  - Daily/weekly/monthly DCA frequency.
  - MACRO 3× acceleration toggle.
  - Performance metrics: total return, max drawdown, BTC accumulated, cash deployed/withdrawn.
- **Built the Backtest UI** (`Backtest.tsx`): Interactive page with portfolio value chart (with BTC price overlay on log scale), BTC holdings chart, transaction log, and strategy comparison cards.
- **Fixed NaN propagation**: Changed the engine from skipping scoring when inputs are NaN to carrying forward the last valid score, with console warnings for transparency.

### Challenges

- **Backtest edge cases**: The "Sell all" strategy had a bug where it showed 0% return for certain start dates. Root cause was the re-entry logic not properly redeploying idle cash when accumulation resumed.
- **Portfolio value calculation**: Needed to handle the case where a strategy holds both BTC and USD simultaneously, and track unrealised vs. realised gains correctly.

### Learnings

- Backtesting is deceptively complex. The simple concept ("simulate DCA with these signals") has dozens of edge cases: partial fills, re-entry after selling, cash management during pauses, handling the first/last day boundary.
- Carrying forward scores (rather than skipping) produces more realistic early-history behaviour, since in practice you'd use whatever information is available.

### Reflections

The backtest was the first time we could objectively evaluate whether the signal engine actually adds value over blind DCA. Seeing the numbers was motivating — but it also exposed weaknesses in the exit logic.

---

## Session 4 — ~Jan 2026 (mid)

### Work done

- **Added on-chain valuation metrics**: Integrated LTH SOPR and NUPL from BGeometrics. Created the BGeometrics Netlify Function proxy. Added charts with conditional colouring (green when SOPR ≥ 1, red when < 1; green NUPL above 0, red below).
- **Expanded VAL_SCORE from 2-tier to 4-tier** (0–3):
  - Score 3: Extreme deep value (MVRV < 1.0 AND LTH SOPR < 1.0 — both confirming capitulation).
  - Score 2: Strong value (MVRV < 1.0, or MVRV < 1.8 with LTH SOPR capitulation).
  - Score 1: Fair/neutral (MVRV 1.8–3.5 — normal bull market range).
  - Score 0: Euphoria/overheated (MVRV ≥ 3.5 — near cycle peaks).
- **Updated CORE entry logic** to use the 4-tier score: VAL ≥ 3 enters unconditionally; VAL ≥ 1 with PRICE_REGIME = 1 enters with trend confirmation.
- **Added DXY persistence filter** (20/30 days): Analogous to the PRICE_REGIME persistence filter. Prevents brief DXY fluctuations from triggering premature CORE entries or exits.
- **Changed ACCUM_ON from `CORE | MACRO` to `CORE` only**: MACRO now serves purely as an intensity modifier (3× DCA) when CORE is already ON, rather than independently permitting accumulation. This was a significant strategic decision.
- **Overhauled the backtest cash management**: Implemented consistent DCA deposits into the portfolio as cash first, then buying BTC only when accumulation is permitted. Added the "extra cash reserve" concept for 3× MACRO acceleration.

### Challenges

- **MVRV peak decay across cycles**: The user observed that MVRV peaks at progressively lower values each cycle (2012: 5.58, 2017: 4.29, 2021: 3.9, 2024: 2.66). This meant the original euphoria threshold of 1.8 was triggered far too early in bull markets. Raised to 3.5 after analysis, but this may need further adjustment in future cycles.
- **LTH SOPR outliers**: A few extreme SOPR values (>10) skewed the chart rendering despite setting Y-axis limits. Required clamping values at the rendering level.
- **G3 Global Liquidity**: Added ECB and BOJ balance sheet data converted to USD for a display-only G3 liquidity composite. The complexity of cross-currency normalisation (EUR/USD, JPY/USD rates) was non-trivial.

### Learnings

- Multi-metric valuation scoring is significantly more robust than single-metric. LTH SOPR as a "flow" metric complements MVRV as a "stock" metric — one measures realised behaviour, the other measures paper value.
- Persistence filters are essential for noisy inputs. Without the DXY filter, brief dollar strength episodes caused false CORE exits in the backtest.
- The decision to make ACCUM = CORE (not CORE | MACRO) was counterintuitive but correct: MACRO conditions can be favourable even when BTC is overvalued, and you don't want the model buying at cycle peaks just because liquidity is expanding.

### Reflections

This session felt like the model was "growing up." Moving from a 2-tier to 4-tier valuation score, adding persistence filters, and separating CORE from MACRO — each change was small individually but collectively made the model much more nuanced. The MVRV peak decay observation is concerning for long-term model stability and will need monitoring.

---

## Session 5 — ~Jan 31, 2026

### Work done

- **UI polish**: Reordered charts (Price Regime before Valuation), reordered score cards, reordered navigation menu items.
- **Investigated ISM Manufacturing PMI** as a potential business cycle indicator. Confirmed it's available via FRED as series `NAPM` but noted licensing concerns for commercial use.
- **STRATEGY.md created**: Documented the full business vision for CoinStrat as a product — the four-layer stack (Distribution, Intelligence, Execution, Trust), competitive advantages, revenue model, go-to-market strategy, and the dogfooding concept.

### Challenges

- Finding the right balance between model complexity and explainability. Each new indicator adds signal but also adds a dimension the user needs to understand and trust.

### Learnings

- The gap between "personal tool" and "product" is significant. Writing the strategy document forced clarity on what the signal engine actually is (intelligence layer), what it isn't (trading advice), and how it fits into a larger ecosystem.

### Reflections

A good day for stepping back from code and thinking about the bigger picture. The dogfooding concept — investing CoinStrat's own revenue using its own signals, with on-chain proof — is a genuinely novel positioning in the analytics space.

---

## Session 6 — ~Feb 15, 2026

### Work done

- **Brainstormed entrepreneurial ideas** leveraging the existing CoinStrat tech stack. Explored concepts like SignalDCA (subscription-based smart DCA), a no-code strategy builder, a unified crypto+macro data API, and a non-custodial DCA vault using smart contracts.
- Evaluated each idea against criteria: problem clarity, revenue path, competitive landscape, and alignment with existing skills.

### Challenges

- The crypto analytics space is crowded at the top end (Glassnode, CryptoQuant) but underserved for accumulation-focused retail users. Finding the right positioning niche required careful market analysis.

### Reflections

The most interesting insight was that CoinStrat's value proposition isn't the data (which is mostly public) or the model (which could be replicated) — it's the synthesis and the execution layer. The combination of macro + on-chain signals, delivered through a simple accumulate/pause/accelerate framework, with self-custodial on-chain execution and a verifiable track record, is genuinely differentiated.

---

## Session 7 — ~Feb 15–17, 2026

### Work done

- **Debugged the Jan 2023 false "Sell all" exit**: The backtest showed a sell-all transaction near the absolute bear market bottom. Traced the cause to the CORE exit condition being too simplistic — it fired whenever PRICE_REGIME and VAL_SCORE crossed certain thresholds, without requiring confirmation of a genuine cycle top.
- **Researched cycle-top identification methods**: Analysed Supply in Profit (BGeometrics), Pi Cycle Top indicator, 40W SMA, and MVRV reversals. User decided against Pi Cycle Top after it failed to signal in 2025.
- **Designed the "Euphoria Exhaustion" exit framework**: A two-phase state machine:
  - Phase 1 (ARM): Supply in Profit > 95% for 14+ consecutive days.
  - Phase 2 (CONFIRM): SIP drops below 90% and fails to reclaim 95% within 60 days.
- **Integrated Supply in Profit data**: Added `fetchSupplyInProfit()` to `crypto.ts`, added `fillSeries` call in `engine.ts`, implemented the full Euphoria Exhaustion state machine with diagnostic fields.
- **Updated LogicFlow UI**: Refactored to correctly evaluate and display entry/exit conditions using actual signal data, not just the CORE status bit.
- **Fixed the BGeometrics allow-list bug**: The `bgeometrics.ts` Netlify Function only allowed `lth_sopr` and `lth_nupl` — `profit_loss` was missing. This meant SIP data never loaded in production, making the exit condition permanently inert. Added `profit_loss` to the allow-list.

### Challenges

- **The CORE exit problem is fundamentally hard**: Identifying cycle tops in real-time is one of the hardest problems in financial modelling. Every indicator is either too early (causing premature exits during bull market corrections) or too late (exiting well after the peak). The Euphoria Exhaustion approach is a compromise: it waits for sustained euphoria before arming, then requires confirmation.
- **The BGeometrics allow-list bug** was a perfect example of an integration failure hiding in plain sight. The proxy function returned a clean 400 error, the fetch handler caught it gracefully and returned an empty array, the engine forward-filled NaN, and the state machine silently never armed. No errors in the console, no crashes — just a permanently broken exit condition.
- **LogicFlow UI was lying**: The entry condition displayed "TRUE" when it should have been "FALSE" because it was wired to `coreStatus` (the current state) rather than the actual evaluation of the entry expression. A subtle but important distinction between "is the signal ON?" and "would the entry fire right now?".

### Learnings

- Silent failures are the worst kind of bug. The SIP data not loading produced no errors — it just meant the model behaved as if SIP data didn't exist (which, for pre-2016 data, is actually correct). The only symptom was "CORE never exits," which could have many causes.
- Always verify your proxy allow-lists when adding new data sources. A centralised allow-list is good security practice but creates a maintenance burden.
- UI components that display model logic should evaluate the logic themselves, not just reflect stored state. The distinction matters for debugging and transparency.

### Reflections

The Euphoria Exhaustion design was the product of a genuinely collaborative process — user brought the domain intuition ("when Supply in Profit is high and then drops..."), we brought the engineering framework (state machine with arming/confirmation phases). Neither could have designed it alone. The allow-list bug was humbling: hours spent designing a sophisticated exit strategy, and the real problem was a missing string in an array.

---

## Session 8 — Feb 3, 2026 (today)

### Work done

- **Simplified the CORE exit condition** from AND to OR:
  - Previous: `sipExhausted AND PRICE_REGIME_ON = 0` (both required).
  - New: `(PRICE_REGIME_ON = 0 AND VAL_SCORE <= 1) OR sipExhausted` (either sufficient).
- **Added the VAL_SCORE gate** (`<= 1`) to the PRICE_REGIME exit: This prevents CORE from exiting at bear-market bottoms where VAL = 2 or 3 (deep value). The exit only fires when valuation is fair-to-overheated (score 0 or 1), blocking the flip-flop cycle of enter-at-bottom → immediately-exit-because-below-40W-SMA.
- **Ran full historical SIP analysis**: Fetched the complete `profit_loss.json` dataset from BGeometrics and simulated the Euphoria Exhaustion state machine across the entire history. Found 5 exhaustion events (with proper CORE resets between cycles): 2018-03-09, 2021-07-09, 2024-08-12, 2025-04-06, 2025-12-09.
- **Identified mid-cycle false positives**: Events 2 (May 2021 crash) and 3 (Aug 2024 correction) triggered SIP exhaustion during mid-cycle pullbacks, not true cycle tops. The 60-day reclaim window isn't always sufficient for sharp corrections that subsequently recover.

### Challenges

- **The exit condition evolution**: AND was too strict (never triggered because SIP data wasn't loading, and even when fixed, both conditions rarely aligned simultaneously). Pure OR with just PRICE_REGIME was too loose (triggered at bear bottoms, causing flip-flops). Adding the VAL_SCORE gate was the key insight: exit when the trend breaks AND valuation confirms we're not in deep value territory.
- **Condition B mid-cycle false positives**: The May 2021 crash and Aug 2024 correction both saw SIP drop below 90% and fail to reclaim 95% within 60 days — but BTC subsequently made new all-time highs. This is an inherent limitation of any fixed-window approach to cycle identification.

### Learnings

- Exit conditions need to be asymmetric with entry conditions. Entry says "it's cheap enough AND the trend is up" — the exit should say "the trend is broken AND it's NOT cheap" (blocking exits during capitulation when we actually want to accumulate).
- The VAL_SCORE acts as a "regime awareness" layer for exits: it knows the difference between "price is below 40W SMA because we're in a bear market bottom" (VAL = 2–3, stay on) and "price is below 40W SMA because the bull market just ended" (VAL = 0–1, exit).
- Historical simulation is invaluable but must account for state resets. Running the SIP state machine without CORE resets gives 7 events; with proper resets it gives 5 — a materially different picture.

### Reflections

The exit logic has gone through four iterations: (1) simple threshold, (2) Euphoria Exhaustion AND trend break, (3) Euphoria Exhaustion OR trend break, (4) Euphoria Exhaustion OR (trend break AND not-deep-value). Each iteration was motivated by a concrete failure observed in backtesting. This is how quantitative models should evolve — not from theory alone, but from theory confronted with data. The VAL_SCORE gate is elegant in hindsight: it reuses an existing signal to solve a new problem, keeping the model's complexity low while adding discriminative power.

---

## Cumulative Progress

| Area | Status |
|------|--------|
| Python prototype (`signals.py`, `dashboard_2026.py`) | Complete, unchanged |
| React/TypeScript web app | Complete, deployed on Netlify |
| Client-side signal engine (`engine.ts`) | Complete, all scoring + signals |
| Data sources | FRED (macro), Blockchain.info (MVRV), BGeometrics (SOPR, NUPL, SIP), Hybrid local+Binance (BTC price) |
| Backtesting engine | Complete with 4 strategies, multiple timeframes |
| CORE exit logic | Iterating — current: OR(trend break + valuation gate, euphoria exhaustion) |
| Netlify deployment | Complete with FRED + BGeometrics proxy functions |
| Business strategy | Documented in STRATEGY.md |
| On-chain execution (Power Wallet) | Future work |
| Signal API | Future work |

### Key metrics

- **Files created**: ~25 TypeScript/config files
- **Lines of engine logic**: ~540 (engine.ts) + ~380 (backtest.ts)
- **Data sources integrated**: 6 (FRED, Blockchain.info, BGeometrics ×3, Binance)
- **BTC price source iterations**: 4 (CoinGecko → Blockchain.info → Stooq → Hybrid)
- **CORE exit logic iterations**: 4
- **Bugs found in production**: 3 major (CoinGecko limit, Netlify redirect ordering, BGeometrics allow-list)
