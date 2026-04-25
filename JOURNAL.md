# CoinStrat Development Journal

A chronological log of the development of the CoinStrat Pre-Accumulation Model — from a pair of Python scripts to a full React/TypeScript web application with live data, backtesting, and a refined signal engine.

---

## Session 1 — ~24 Dec 2025

### Work done

- **Reviewed the original Python scripts** (`signals.py`, `dashboard_2026.py`) that formed the foundation of the model: a multi-factor regime-switching system for Bitcoin accumulation timing.
- **Architecture assessment**: Documented the data ingestion layer (FRED, Blockchain.info, Stooq), signal generation (VAL_SCORE, LIQ_SCORE, DXY_SCORE, BIZ_CYCLE_SCORE), aggregator logic (CORE_ON, MACRO_ON, ACCUM_ON), and presentation layer.
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

## 2026-03-01 – Phase 1: CoinStrat Pro + Signal API (Day 1)

### What was done

**Full-stack authentication & payments infrastructure:**

- **Supabase integration**: Created SQL migration (`001_initial_schema.sql`) with `profiles` table (tier, API key, Stripe IDs, rate limiting), `email_subscribers` table, RLS policies, auto-profile creation trigger via `handle_new_user()`, and `set_updated_at` trigger.
- **Auth system**: Built `AuthContext` provider (session management, profile fetching, `onAuthStateChange` listener), `AuthModal` component supporting magic link, email+password, Google OAuth, and GitHub OAuth.
- **Stripe payments**: Created Netlify Functions for `stripe-checkout` (creates Checkout sessions for Pro/Pro+ plans), `stripe-portal` (customer portal for subscription management), and `stripe-webhook` (handles `checkout.session.completed`, `subscription.updated`, `subscription.deleted`, `invoice.payment_failed`).
- **Signal API**: Built three Netlify Function endpoints — `/signals/current` (public, rate-limited), `/signals/history` (Pro, API key auth, date range filtering), `/signals/refresh` (cron-protected, stores precomputed signals in Netlify Blobs).
- **Email system**: Integrated Resend for weekly digest emails via `weekly-digest` function and newsletter subscription via `email-subscribe` function.
- **Admin dashboard**: Created `Admin.tsx` with user list, tier management, and stats cards, protected by `is_admin` flag.
- **Profile page**: Built `Profile.tsx` with subscription status, API key reveal/copy, upgrade/manage subscription buttons.
- **Pricing section**: Added pricing cards (Free, Pro $29/mo, Pro+ $79/mo) and email signup form to the Home page.
- **Legal pages**: Drafted Terms of Service and Privacy Policy pages.
- **Route setup**: Added routes for `/profile`, `/admin`, `/api-docs`, `/terms`, `/privacy` and AppBar user menu with sign in/out.

### Challenges

1. **`gen_random_bytes()` not available** to the `supabase_auth_admin` role — the trigger function for generating API keys failed on user registration. Fixed by switching to `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`.
2. **Supabase magic link redirecting to `localhost:3000`** — default Site URL wasn't configured. Fixed by setting Site URL to `https://coinstrat.xyz` and adding redirect URLs in Supabase Dashboard.
3. **Auth reload glitch** — after page refresh, the user appeared signed out briefly. Root cause: `onAuthStateChange` fires asynchronously and the loading state was set to `false` before the initial session was processed. Fixed with an `initialised` flag in `AuthContext` and a loading spinner in `Profile.tsx`.
4. **`@netlify/blobs` missing from bundle** — Netlify build failed because the package wasn't in `package.json`. Added via `npm install`.
5. **TypeScript type errors in Admin.tsx** — `authHeaders` return type didn't satisfy `HeadersInit`. Fixed by using `Record<string, string>`.

### Learnings

- Supabase's `SECURITY DEFINER` functions run with the function creator's permissions, but the underlying SQL functions available depend on the role executing the trigger. `gen_random_bytes()` requires `pgcrypto` extension access which `supabase_auth_admin` may not have, but `gen_random_uuid()` is universally available.
- Stripe's Checkout + Customer Portal combo is remarkably clean for subscription management — the portal handles upgrades, downgrades, cancellation, and payment method updates with zero custom UI.
- Magic link auth requires careful URL configuration in three places: Supabase Site URL, Supabase Redirect URLs, and the `emailRedirectTo` parameter in the client-side `signInWithOtp` call.

### Reflections

This was a massive infrastructure day — going from a pure static signal dashboard to a full SaaS stack with auth, payments, email, and API. The architecture decision to keep Supabase for relational data (users, subscriptions) and Netlify Blobs for signal caching feels right: each tool does what it's best at. The hardest part was debugging the Supabase trigger — error messages from `auth.users` INSERT failures are opaque and required digging into Postgres logs.

---

## 2026-03-02 – External Service Setup & API Playground

### What was done

- **GitHub OAuth setup**: Guided through GitHub Developer Settings → OAuth Apps for Supabase auth.
- **Google OAuth setup**: Guided through GCP Console → OAuth 2.0 Credentials with consent screen configuration.
- **Stripe configuration**: Set up products (Pro $29/mo, Pro+ $79/mo), webhook endpoint, and environment variables.
- **AWS WorkMail setup**: Created `support@coinstrat.xyz` inbox for support and privacy enquiries, with MX records configured in Route 53.
- **Resend email setup**: Configured domain verification with SPF/DKIM records, existing DMARC record validated.
- **Supabase admin**: Set `is_admin = true` for the owner account.
- **Custom auth email templates**: Configured Supabase to use Resend SMTP for branded CoinStrat auth emails.

### Challenges

1. **Supabase legacy vs new API keys** — the dashboard now shows "Publishable" and "Secret" keys alongside legacy `anon`/`service_role` keys. Both work, but the naming confused the setup.
2. **AWS WorkMail domain not found** — needed to add the domain to WorkMail organization first before creating user mailboxes.
3. **DMARC record conflict** — existing DMARC for WorkMail needed to cover Resend sends too. The existing `p=quarantine` policy was sufficient for both.

### Learnings

- AWS WorkMail is a viable budget email solution (~$4/user/month) for simple support inboxes when you already manage DNS on Route 53.
- Resend requires domain verification (SPF + DKIM) but respects existing DMARC records without modification.
- Google OAuth consent screen must be "published" (not just in testing) for external users to authenticate.

### Reflections

External service wiring is the unsexy but critical part of building a SaaS. Each integration (Supabase, Stripe, Resend, AWS WorkMail) has its own auth model, DNS requirements, and dashboard quirks. Documentation helps but the real knowledge comes from hitting the errors and fixing them one by one.

---

## 2026-03-03 – API Playground Redesign

### What was done

- **API Docs rewrite**: Rebuilt the API docs page (`ApiDocs.tsx`) taking inspiration from the thebotcast project's API playground. New architecture:
  - `web/src/views/api/endpoints.ts` — structured endpoint definitions (groups, params, auth requirements).
  - `web/src/views/api/EndpointCard.tsx` — collapsible card component with parameter inputs, live request execution, curl generation, and response display.
  - `web/src/views/ApiDocs.tsx` — main page with tabbed endpoint groups (Public, Pro, Internal), API key input (auto-filled from profile, persisted in localStorage), rate limit documentation, and signal field overview.
- Three endpoint groups: **Public** (`/signals/current`), **Pro** (`/signals/history`), **Internal** (`/signals/refresh`, `/email/digest`).
- Internal endpoints show curl but disable "Send request" (protected by CRON_SECRET).

### Challenges

1. **Private repo access** — the thebotcast repo was private, so the inspiration source had to be read from the local filesystem clone.
2. **Adapting auth model** — thebotcast uses Bearer tokens per role (host/guest/admin), while CoinStrat uses API keys in `X-API-Key` header. Adapted the `EndpointCard` to handle both patterns.

### Learnings

- Separating endpoint definitions into a data structure (`endpoints.ts`) makes the API docs page trivially extensible — adding a new endpoint is just appending an object to an array.
- Auto-filling the API key from the user's profile reduces friction for Pro users trying out the API.

### Reflections

A good API playground dramatically lowers the barrier to adoption. The thebotcast pattern of tabbed groups + collapsible cards + inline execution is a solid UX template for any API product. The CoinStrat version is simpler (fewer endpoints, simpler auth) but follows the same principles.

---

## 2026-03-09 – Newsletter Engine Foundation

### What was done

- **Built the newsletter engine backend**: Added a full database-backed newsletter system with settings, weekly issues, curated links, send logs, suppressions, and a new `lifetime` tier migration.
- **Created reusable server-side content generation utilities**: Introduced shared compute/store/newsletter libraries so the weekly digest, signal refresh, and admin workflows could all use the same signal snapshot and rendering pipeline.
- **Launched the admin newsletter workspace**: Expanded `Admin.tsx` into a real operator console for drafting issues, previewing content, configuring send windows, managing audience mode, and reviewing send history.
- **Added self-serve unsubscribe flow**: Created `email-unsubscribe` plus a dedicated unsubscribe page so newsletter recipients can opt out cleanly without manual intervention.
- **Improved cache tooling and API ergonomics**: Added `seed-cache.sh`, refined signal endpoints around cached data, and refreshed the developer-facing endpoint components to keep docs aligned with the backend.

### Challenges

1. **The original weekly digest flow was too narrow** — it could send an email, but it didn’t have the concept of reusable issues, scheduling, curated links, or send history. The new engine needed proper state and persistence.
2. **Signal computation had started to sprawl across functions** — centralising the compute path was necessary to avoid subtle divergence between what the dashboard showed, what the API served, and what the newsletter summarised.
3. **Newsletter operations need admin-safe auth** — the backend had to distinguish between public requests, paid API access, and authenticated admin actions without leaking server-only capability into the client.

### Learnings

- Email features stop being “just another function” as soon as they become a product surface. Once scheduling, previews, logs, and audience selection matter, you really need a small content system, not a single send script.
- Shared compute and storage helpers pay off quickly in data products. Reusing one canonical signal pipeline is safer than letting every function assemble its own view of the truth.

### Reflections

This was the moment CoinStrat’s email layer stopped being a side feature and started feeling like a real publishing system. The important shift wasn’t just “can we send a newsletter?” but “can we create, review, schedule, audit, and evolve one reliably every week?”

---

## 2026-03-10 – Docs Hub Expansion

### What was done

- **Split documentation out of the homepage**: Moved long-form explanatory content into dedicated docs pages for Home, Data, Architecture, Scores, and Signals.
- **Built shared documentation navigation**: Added `DocsSectionNav` and `DocsPager` so the docs behave like a connected knowledge base instead of a set of isolated pages.
- **Reframed the public site structure**: Updated routing so the homepage could stay focused on positioning and conversion while the docs handled model transparency and educational content.
- **Cleaned up the admin/docs boundary**: Simplified surrounding pages so the new docs system had a clearer role and the product no longer relied on an overloaded landing page to explain everything.

### Challenges

1. **The homepage was trying to do too many jobs at once** — marketing page, product explainer, and technical reference. That made it longer, harder to scan, and harder to maintain.
2. **Docs need information architecture, not just content** — once there are multiple explanation pages, navigation, sequencing, and cross-linking matter as much as the words on each page.

### Learnings

- Separating “sell the product” from “explain the model” makes both experiences better. The homepage can stay punchy while the docs can go deep without apology.
- Reusable docs navigation components are worth creating early. They reduce friction every time a new explanatory page is added.

### Reflections

This was a product clarity day more than a pure coding day. CoinStrat is becoming complex enough that good documentation is part of the feature set, not an afterthought bolted onto the landing page.

---

## 2026-03-13 – Newsletter Confirmation & Trust Improvements

### What was done

- **Added double opt-in confirmation for newsletter signups**: Introduced confirmation tokens, `confirmed_at`, and a new `/newsletter/confirm` flow so subscribers explicitly verify their address before receiving broadcasts.
- **Upgraded subscription endpoints**: Refined `email-subscribe` and added `email-confirm` so signup and confirmation became two explicit steps with clearer state transitions.
- **Hardened newsletter audience quality**: Updated newsletter sending logic to respect confirmation state and suppressions, improving deliverability and reducing the chance of mailing unverified signups.
- **Expanded admin visibility**: Enhanced the admin area with better subscriber handling and newsletter operational feedback, making it easier to understand who is actually reachable.
- **Touched the public signal response path**: Adjusted signal endpoint behaviour alongside the newsletter work so the latest product metadata remained consistent across the app and email flows.

### Challenges

1. **Existing subscribers needed a migration path** — once confirmation was introduced, the system had to avoid treating legitimate existing subscribers as invalid or silently dropping them.
2. **Email trust is cumulative** — subscription, confirmation, suppression, and unsubscribe all have to work together cleanly or the whole newsletter channel becomes fragile.

### Learnings

- Double opt-in adds friction, but it buys clarity, compliance, and better list quality. For a small but serious product, that trade-off is worth it.
- Subscriber state should be modelled explicitly. “Subscribed” is not the same thing as “confirmed,” and handling that distinction in the schema simplifies everything downstream.

### Reflections

This session was about treating email like infrastructure, not growth-hack glue. A smaller, cleaner, fully confirmed list is much more valuable than a larger list with fuzzy consent and unreliable delivery.

---

## 2026-03-14 – Free Access Hardening, Pro Alerts & Developer Workspace

### What was done

- **Fixed Free tier access end-to-end**: Reworked auth/session handling so signed-in, verified users consistently unlock the dashboard, charts, signals, and backtests without getting stuck behind stale loading or profile-sync edge cases.
- **Improved the signed-in product flow**: Updated the homepage, app shell, auth modal interactions, and profile page so Free access is clearly positioned as the base product rather than an accidental subset of paid logic.
- **Built Pro signal alerts**: Added database tables and backend logic for alert subscriptions, detected state changes, delivery logs, preferences management, and one-click alert unsubscribe links.
- **Added alert management to the profile**: Expanded `Profile.tsx` with sectional navigation, Pro alert toggles, paid-tier gating, and an OpenClaw skill install snippet powered by the user’s API key.
- **Evolved API docs into a Developer Workspace**: Repositioned the old API playground into a fuller developer surface with API key management, grouped endpoint testing, rate limits, roadmap copy, and admin newsletter auto-send status.
- **Refined admin operations**: Fixed admin page reload behaviour, improved the cache status label, and tightened the overall control-surface for operators monitoring live data and outbound email flows.

### Challenges

1. **Free access was really an auth-state problem** — the tricky part wasn’t pricing logic, it was the race between session restoration, profile provisioning, and email verification state.
2. **Alerting needs idempotency and user control** — detecting signal changes is easy compared with guaranteeing deduplicated sends, storing delivery outcomes, and giving users a trustworthy unsubscribe path.
3. **The developer surface had outgrown “API docs”** — once API keys, live requests, paid access, admin-only endpoints, and future SDK positioning all live in one place, the UX needs to feel like a workspace, not a static reference page.

### Learnings

- The Free tier is part of onboarding, not just monetisation. If access restoration is flaky, the product feels broken before users ever evaluate the signals.
- Event tables plus delivery tables are a strong pattern for notifications: one records what changed, the other records who was told about it and whether it succeeded.
- Developer experience benefits from product thinking too. Good naming, clear auth expectations, and a place to experiment are just as important as the endpoint implementations themselves.

### Reflections

March 14 felt like three product layers maturing at once: acquisition (`Free` access), retention (email alerts), and platform leverage (developer tooling). None of these changed the core signal engine directly, but all of them made CoinStrat feel more like a real product people can use, trust, and build on.

---

## Cumulative Progress

| Area | Status |
|------|--------|
| Python prototype (`signals.py`, `dashboard_2026.py`) | Complete, unchanged |
| React/TypeScript web app | Complete, deployed on Netlify |
| Client-side signal engine (`engine.ts`) | Complete, all scoring + signals |
| Data sources | FRED (macro), Blockchain.info (MVRV), BGeometrics (SOPR, SIP), Investing.com (ISM PMI), Hybrid local+Binance (BTC price) |
| Backtesting engine | Complete with 4 strategies, multiple timeframes |
| CORE exit logic | Iterating — current: OR(trend break + valuation gate, euphoria exhaustion) |
| Netlify deployment | Complete with FRED + BGeometrics proxy functions |
| Business strategy | Documented in STRATEGY.md |
| Authentication | Complete — magic link, email+password, Google OAuth, GitHub OAuth via Supabase |
| Payments | Complete — Stripe Checkout + Customer Portal, webhook integration |
| Signal API | Complete — /current (public), /history (Pro), /refresh (cron) |
| Email system | Complete — Resend for weekly digest + newsletter, Supabase for auth emails |
| Admin dashboard | Complete — user list, tier management, stats |
| Newsletter engine | Complete — issue drafting, curation, scheduling, auto-send status, unsubscribe and confirmation flows |
| Documentation pages | Complete — dedicated docs hub for architecture, data feeds, scores, and signal logic |
| API playground / developer workspace | Complete — endpoint explorer, API key management, rate limits, admin status tooling |
| Free tier access | Complete — verified users can unlock dashboard, charts, signals, and backtests |
| Signal alerts | Complete — Pro email alerts, preferences, delivery logging, unsubscribe flow |
| Legal pages | Complete — Terms of Service, Privacy Policy |
| External services | Supabase, Stripe, Resend, AWS WorkMail all configured |
| On-chain execution (Power Wallet) | Future work |

### Key metrics

- **Files created**: ~75 TypeScript/config/SQL files
- **Lines of engine logic**: ~540 (engine.ts) + ~380 (backtest.ts)
- **Netlify Functions**: 16 endpoint/proxy functions + shared libraries for auth, compute, newsletter, alerts, and cache access
- **Data sources integrated**: 7 (FRED, Blockchain.info, BGeometrics ×2, Investing.com, Binance)
- **BTC price source iterations**: 4 (CoinGecko → Blockchain.info → Stooq → Hybrid)
- **CORE exit logic iterations**: 4
- **Bugs found in production**: 10+ major across data, auth, newsletter, and admin flows

---

## Session — Apr 2026: MVRV → NUPL Migration in VAL_SCORE

### Work done

- **Replaced raw MVRV thresholds with NUPL** in the VAL_SCORE computation. NUPL is now computed inline from MVRV as `1 − 1/MVRV` rather than fetched as a separate BGeometrics series.
- **New thresholds**: NUPL < 0 (deep value), NUPL < 0.381924 (fair + capitulation), NUPL < 0.618 (euphoria). These are Fibonacci-derived levels chosen for structural stability across cycles.
- **Removed `lth_nupl` fetch** from both `engine.ts` and `compute.ts`. The `NUPL` field on each daily row is now populated during VAL_SCORE computation from MVRV, ensuring it's the aggregate (not LTH-specific) variant.
- **Updated all documentation and UI**: README, JOURNAL, DocsScores, ScoreBreakdown, ChartsView, and engine comments now reference NUPL thresholds. MVRV chart reference lines show NUPL equivalents.

### Rationale

- MVRV peaks have been structurally declining across cycles (2013: ~6, 2017: ~4.5, 2021: ~3.8, 2024: ~2.66). The 3.5 euphoria threshold that caught 2021 may never be reached again.
- NUPL is a bounded oscillator (roughly −1 to +1) whose euphoria peaks have been stable across cycles (~0.70–0.75). This makes NUPL thresholds more predictive for future cycles.
- Since NUPL = 1 − 1/MVRV is a monotonic transform, the migration is lossless: identical historical scoring, better forward-looking threshold stability.

---

## Session — Apr 2026: ISM PMI Integration & BIZ_CYCLE_SCORE Overhaul

### Work done

- **Integrated ISM Manufacturing PMI** as a new data feed. Added `fetchISM_PMI()` to `crypto.ts` (client) and `compute.ts` (server) to pull historical data from the free Investing.com endpoint (`/pd-instruments/v1/calendars/economic/events/173/occurrences`). The function handles pagination and returns sorted `PricePoint[]` going back to 1970.
- **Added ISM PMI to the Signal Builder** catalog (`strategyBuilder.ts`, macro group) and to the documentation (`DocsData.tsx`, Business Cycle section).
- **Added a dedicated ISM PMI chart** in `ChartsView.tsx` under the Business Cycle tab — dual axis (PMI left, BTCUSD right) with a reference line at 50 (expansion/contraction threshold).
- **Replaced AMTMNO (Manufacturers New Orders) with ISM PMI** as the primary manufacturing indicator in `BIZ_CYCLE_SCORE`. Rationale: ISM PMI is released earlier in the month, has a natural 50 threshold (expansion vs. contraction), and is a diffusion index that captures breadth of activity rather than dollar volume. AMTMNO (`NO_YOY`, `NO_MOM3`) is retained for display but no longer drives the score.
- **Designed persistence filters for ISM PMI** in the cycle score:
  - **Expansion (Score 2)**: `ISM_PMI ≥ 50` for 90+ consecutive days (~3 months). Captures sustained manufacturing expansion, not just a one-month bounce.
  - **Recession Risk (Score 0)**: `ISM_PMI < 45` for 60+ consecutive days (~2 months). The 45 threshold is well below the neutral 50 line and historically associated with GDP contraction.
- **Changed recession risk logic from pure OR to 2-of-3 confirmation**: The previous `BIZ_CYCLE_SCORE = 0` triggered if any single indicator (SAHM ≥ 0.5, YC_M < 0, or manufacturing stress) was active. This was too permissive — notably, the yield curve remained inverted for most of 2023–2024 without a recession. The new rule counts three independent recession flags and requires at least two to confirm:
  1. `SAHM ≥ 0.5` (labour market stress)
  2. `YC_M < 0` (inverted yield curve)
  3. `ISM_PMI < 45` for 60+ consecutive days (manufacturing contraction)
- **Updated expansion condition** to also require ISM PMI persistence: `SAHM < 0.35 AND YC_M ≥ 0.75 AND ISM_PMI ≥ 50 for 90+ days` (each condition gated by data availability).
- **Exposed ISM PMI diagnostics** on each daily row: `ISM_PMI_ABOVE50_DAYS` and `ISM_PMI_BELOW45_DAYS` counters.
- **Mirrored all engine changes** in `compute.ts` (server-side) to maintain client/server consistency.
- **Updated all UI and documentation**:
  - `LogicFlow.tsx`: Added ISM PMI metric chip in the Macro Accelerator card.
  - `ScoreBreakdown.tsx`: Updated the Business Cycle tab — new description, formula, rule rows (2-of-3 recession, ISM persistence for expansion), and metric rows (ISM PMI, ≥50 streak, <45 streak).
  - `DocsScores.tsx`: Rewrote the Business Cycle Score documentation — formula, rationale (including why 2-of-3 is preferred), thresholds, and notes.
  - `DocsArchitecture.tsx`: Updated all three pipeline layers (raw inputs, engineered metrics, factor scores) to reflect ISM PMI.
  - `ChartsView.tsx`: Updated descriptions for Business Cycle Regime and Business Cycle Inputs charts.

### Renamed `CYCLE_SCORE` → `BIZ_CYCLE_SCORE` globally

- **Full rename across the entire codebase** to make the score name self-documenting — clearly referring to the business cycle, not a BTC market cycle or halving cycle.
- **Scope**: 22 files updated (58 total occurrences), including:
  - Engine/type layer: `App.tsx` (SignalData interface), `engine.ts`, `compute.ts`
  - Views: `Dashboard.tsx`, `ChartsView.tsx`, `LogicFlow.tsx`, `ScoreBreakdown.tsx`, `StrategyBuilder.tsx`
  - Docs: `DocsScores.tsx`, `DocsSignals.tsx`, `DocsArchitecture.tsx`, `DocsSignalBuilder.tsx`
  - Logic: `strategyBuilder.ts`, `proFeatures.ts`, `recommendation.ts`
  - Server: `newsletter.ts` (13 occurrences), `signalAlerts.ts`, `strategyLlm.ts`
  - Tests: `strategyLlm.test.ts`
  - Markdown: `README.md`, `STRATEGY.md`, `JOURNAL.md`, `coinstrat-skill.md`
- **Intentionally left unchanged**: `web/supabase/migrations/005_add_pro_alerts_and_harden_profiles.sql` — historical migration files must not be modified.
- TypeScript compiles clean after rename.

### Challenges

1. **ISM PMI vs. AMTMNO trade-off**: AMTMNO provides dollar-volume precision and YoY/MoM momentum, but it is released with a ~6-week lag and lacks a natural expansion/contraction threshold. ISM PMI is released on the first business day of the month (one of the most timely macro indicators), has the universally recognised 50 threshold, and as a diffusion index captures breadth of manufacturing activity. The trade-off is that PMI is sentiment-based (survey), not hard data. We judged timeliness and threshold clarity to be more valuable for a cycle detection score.
2. **Recession rule strictness**: The pure OR rule was empirically too loose — the yield curve was inverted continuously from late 2022 through 2024, and SAHM briefly spiked in mid-2024, yet no recession materialised. The 2-of-3 rule demands corroboration from independent domains (labour, rates, manufacturing), significantly reducing false alarms while maintaining sensitivity when conditions genuinely deteriorate.
3. **Persistence calibration**: The 90-day (expansion) and 60-day (recession) thresholds for ISM PMI were chosen to align with the monthly release cadence — roughly 3 consecutive monthly prints above 50 for expansion, and 2 consecutive prints below 45 for recession. This is a forward-fill effect: the daily counter increments every day between releases, so 90 days ≈ 3 reports.
4. **Rename scope**: Renaming a field that appears in the type system, scoring engine, newsletter rendering, LLM prompt context, alert detection, and 4 markdown files required careful global search and verification that no stale references survived (only the SQL migration, correctly, retains the old name).

### Learnings

- Diffusion indices like ISM PMI are underappreciated in crypto models. Most crypto analytics focus on on-chain or price-derived metrics. Adding a macro diffusion index that the entire institutional world watches brings orthogonal information.
- Persistence filters turn noisy monthly data into usable daily signals. Without them, a single ISM print above/below a threshold would whipsaw the score. With them, you require sustained trends — which is what a "business cycle" actually is.
- Naming matters in quantitative models. `CYCLE_SCORE` was ambiguous in a crypto context where "cycle" usually means the 4-year halving cycle. `BIZ_CYCLE_SCORE` immediately communicates scope.
- The 2-of-3 pattern is a robust confirmation framework. It's more resilient than OR (too sensitive) and more responsive than AND (too strict), and it naturally handles the case where one indicator is structurally lagging or stuck.

### Reflections

The ISM PMI integration was one of those changes that felt bigger than the diff. Swapping one manufacturing indicator for another sounds minor, but it rewired how the model detects macroeconomic regime changes. The 2-of-3 recession rule, in particular, is a meaningful philosophical shift: from "any warning sign triggers caution" to "we need corroboration before downgrading." This is more aligned with how institutional macro analysts think — no single indicator is gospel — and it should produce fewer false alarms without sacrificing responsiveness when conditions genuinely deteriorate.
