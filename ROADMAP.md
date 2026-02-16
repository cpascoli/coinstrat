# CoinStrat — Product Delivery Roadmap

## Overview

Four phases, each building on the last. Each phase delivers a shippable product that generates revenue independently, while also feeding into the larger vision.

```
Phase 1             Phase 2            Phase 3                Phase 4
CoinStrat Pro       OpenClaw Skill     AI Agent + Dogfooding  On-Chain Oracle
+ Signal API        (multi-channel     Wallet                 + Power Wallet
                     distribution)                            "Macro" Strategy
Weeks 1–4           Weeks 4–8          Weeks 8–14             Months 4–7
──────────────────────────────────────────────────────────────────────────►
                        Revenue starts here ───►
```

---

## Phase 1: CoinStrat Pro + Signal API

**Timeline:** Weeks 1–4
**Goal:** First revenue. Ship the freemium web product and the API that powers everything downstream.

### 1.1 Signal API (the foundation)

Everything — the web dashboard, the OpenClaw skill, the AI agents — consumes the same API. Build this first.

#### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/signals/current` | Free (rate-limited) | Latest signal snapshot: CORE_ON, MACRO_ON, ACCUM_ON, all scores, BTC price, timestamp |
| `GET` | `/api/v1/signals/history` | API key (paid) | Full daily signal history, filterable by date range |
| `GET` | `/api/v1/signals/scores` | API key (paid) | Individual score time series (VAL, LIQ, DXY, CYCLE) |
| `WS` | `/api/v1/signals/stream` | API key (paid) | WebSocket stream, pushes updates when signals change |
| `POST` | `/api/v1/webhooks` | API key (paid) | Register a webhook URL to receive signal-flip events |
| `GET` | `/api/v1/backtest` | API key (Pro+) | Run a backtest with custom parameters, return results as JSON |
| `GET` | `/api/v1/agent/status` | Public | Agent wallet status: BTC held, USDC balance, total deposited, performance vs. blind DCA |

#### Architecture Options

- **Option A (Simple):** Netlify Functions + Supabase (or KV store) for API keys and caching. Signals recomputed on request or cached with 1-hour TTL.
- **Option B (Scalable):** Dedicated backend (Deno Deploy / Cloudflare Workers / Hono on Fly.io). Cron job recomputes signals every hour, stores in Postgres/KV. API serves from cache.

**Recommendation:** Start with Option A (Netlify Functions + Supabase) to ship fast. Migrate to Option B when API traffic justifies it.

#### API Key Management

- Generate API keys on sign-up (UUID v4, hashed in DB)
- Rate limiting per key tier (free: 100/day, paid: 1K–10K/day)
- Usage tracking for billing and analytics

### 1.2 Authentication & User Accounts

- **Provider:** Supabase Auth (or Clerk) — supports email/password, Google, GitHub
- **User model:** email, subscription tier, API key, created_at, openclaw_linked (boolean)
- **Session management:** JWT tokens, stored in httpOnly cookies for the web app

### 1.3 Payment Integration

#### Stripe (Credit/Debit Card)

- Stripe Checkout for subscription sign-up
- Stripe Customer Portal for self-service plan management
- Webhook handler for subscription lifecycle events (created, updated, cancelled, payment_failed)
- Products: CoinStrat Pro ($14.99/month), CoinStrat Pro+ ($29.99/month), API tiers

#### USDC (Crypto Payment)

- Simple approach: User sends USDC to a known address on Base, includes their user ID in memo or we match by wallet address
- Verify payment on-chain (poll or listen for Transfer events)
- Credit subscription days proportionally
- Alternative: Use a service like Coinbase Commerce or build a simple payment contract

### 1.4 CoinStrat Pro Web Dashboard (Freemium)

Enhance the existing CoinStrat web app with gated features:

| Feature | Free | Pro | Pro+ |
|---------|------|-----|------|
| Current signal status | Yes | Yes | Yes |
| Dashboard with recommendation | Yes | Yes | Yes |
| Signal history (charts) | 30 days | Full | Full |
| Score breakdown | Summary | Detailed | Detailed |
| Logic flow visualisation | Yes | Yes | Yes |
| Backtest simulator | 1 year | Full range | Full range + custom strategies |
| Real-time alerts | — | All channels (via OpenClaw or email) | All channels + webhook |
| API access | 100 calls/day | 1K calls/day | 10K calls/day |
| Agent wallet dashboard | Summary | Detailed | Detailed + tx history |
| Custom strategy builder | — | — | Yes |

#### Implementation Notes

- Gate features with a simple `tier` check from the user's session
- Use a context provider (`SubscriptionContext`) to make tier info available app-wide
- Unauthenticated users see the free tier; login unlocks Pro features based on subscription

### 1.5 Weekly Email Digest (Free Tier — Growth Engine)

- **Content:** Current signal status, key metrics snapshot, agent wallet update, 1-paragraph market context, CTA to upgrade
- **Provider:** Resend, Postmark, or Loops (lightweight transactional + marketing email)
- **Frequency:** Every Monday morning
- **Sign-up:** Email capture on the landing page (no account required)
- **Purpose:** Top-of-funnel. Build the email list. Every subscriber is a future Pro customer.

### Deliverables Checklist — Phase 1

- [ ] Signal API: `/current`, `/history`, `/scores` endpoints
- [ ] Agent status endpoint: `/agent/status`
- [ ] API key generation and rate limiting
- [ ] Supabase Auth integration (email + Google sign-in)
- [ ] Stripe Checkout integration (Pro + Pro+ tiers)
- [ ] USDC payment flow (manual or semi-automated)
- [ ] Feature gating in web dashboard (free vs. Pro vs. Pro+)
- [ ] Weekly email digest system
- [ ] Landing page updates (pricing section, sign-up CTA, agent wallet teaser)
- [ ] API documentation page (public)

---

## Phase 2: OpenClaw Skill (Multi-Channel Distribution)

**Timeline:** Weeks 4–8
**Goal:** Distribution across every messaging channel OpenClaw supports, via a single skill. Tap into OpenClaw's 197K+ GitHub stars community.

### Why OpenClaw Instead of a Standalone Bot

Building a standalone Telegram bot limits distribution to one channel. OpenClaw provides:

- **Instant multi-channel reach** — WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Google Chat, Microsoft Teams — all through a single skill
- **ClawHub distribution** — publishing to OpenClaw's skill marketplace puts CoinStrat in front of 197K+ developers
- **Persistent memory** — OpenClaw remembers user preferences, DCA history, and portfolio context across sessions
- **No infrastructure to manage** — the skill runs inside the user's own OpenClaw instance; we only need to serve the API

### 2.1 CoinStrat OpenClaw Skill

The skill is a `SKILL.md` file (with optional supporting scripts) that teaches an OpenClaw instance how to interact with the CoinStrat API.

#### Skill Capabilities

| Capability | Free | Pro | Description |
|------------|------|-----|-------------|
| Check current signal | Yes | Yes | "What's the CoinStrat signal today?" → CORE ON/OFF, scores, recommendation |
| Score breakdown | Yes | Yes | "Break down the current scores" → VAL, LIQ, DXY, CYCLE with values and thresholds |
| Signal alerts | — | Yes | Proactive notification when CORE or MACRO flips (via OpenClaw's cron/heartbeat) |
| Explain reasoning | — | Yes | "Why is CORE off?" → LLM-powered plain-English explanation using signal data |
| Quick backtest | — | Yes | "How would CoinStrat have performed over 3 years?" → summary stats |
| Agent wallet status | Yes | Yes | "How is the CoinStrat agent wallet doing?" → live performance data |
| Portfolio tracking | — | Yes | "I bought $200 of BTC today" → track buys, compare vs. blind DCA |
| Power Wallet integration | — | Yes | "Set up my Power Wallet with CoinStrat signals" → guide through wallet creation |

#### Skill Architecture

```
User's OpenClaw instance
    │
    │  "What's the CoinStrat signal?"
    │
    ▼
┌──────────────────────────────────┐
│  CoinStrat OpenClaw Skill        │
│  (SKILL.md + helper scripts)     │
│                                   │
│  1. Reads user's API key from    │
│     OpenClaw memory/config       │
│  2. Calls CoinStrat Signal API   │
│  3. Formats response for user    │
│  4. Optionally uses LLM for      │
│     plain-English explanation    │
└──────────────┬───────────────────┘
               │
               ▼
    CoinStrat Signal API
    (Phase 1 infrastructure)
```

### 2.2 Daily Signal Check (via OpenClaw Cron)

OpenClaw supports cron jobs / heartbeats. The skill registers a daily check:

- Runs daily (e.g., 08:00 UTC)
- Fetches `/api/v1/signals/current`
- If signal state changed since yesterday → proactively message the user
- Format (delivered via whatever channel the user prefers):

```
📊 CoinStrat Daily — Feb 15, 2026

Signal: 🟢 BUY (CORE ON)
Intensity: ⚡ ACCELERATED (MACRO ON, 3× DCA)

Scores: VAL 2 | LIQ 2 | DXY 1 | CYCLE 2
BTC: $98,420 | MVRV: 1.42

Agent wallet: 0.847 BTC ($83,362) — +142% vs. blind DCA

"Macro liquidity expanding, on-chain valuation fair.
Conditions favour continued accumulation."
```

### 2.3 User Account Linking

- User provides their CoinStrat API key to their OpenClaw instance (stored in OpenClaw's local config/memory — never sent to us)
- OpenClaw authenticates against CoinStrat API with the key
- Pro features unlocked based on API key tier
- Alternatively: OAuth flow (OpenClaw supports browser actions) for seamless linking

### 2.4 ClawHub Publication

- Package the skill for ClawHub (OpenClaw's skill marketplace)
- Include clear README: what it does, API key setup, example conversations
- Maintain versioned releases aligned with API changes

### Deliverables Checklist — Phase 2

- [ ] CoinStrat OpenClaw skill (SKILL.md + helper scripts)
- [ ] Free capabilities: signal check, scores, agent wallet status
- [ ] Pro capabilities: alerts, reasoning, backtest, portfolio tracking
- [ ] Daily cron job for proactive signal updates
- [ ] User account linking (API key in OpenClaw config)
- [ ] Publish to ClawHub with documentation
- [ ] Telegram group set up as community hub (complementing OpenClaw distribution)
- [ ] Skill tested across WhatsApp, Telegram, Discord

---

## Phase 3: AI Agent + Dogfooding Wallet

**Timeline:** Weeks 8–14
**Goal:** Launch the CoinStrat AI agent with a revenue-funded wallet. Connect CoinStrat intelligence to autonomous on-chain execution. Prove the product with skin in the game.

### 3.1 CoinStrat AI Agent

An autonomous OpenClaw-based agent that reads CoinStrat signals and executes DCA via Power Wallet, funded by a portion of subscription revenue.

#### Agent Architecture

```
┌───────────────────────────────────────────────────────┐
│                 CoinStrat AI Agent                      │
│                 (OpenClaw instance)                     │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
│  │ Signal    │   │ Decision │   │ Execute           │   │
│  │ Reader    │──►│ Engine   │──►│ (Power Wallet     │   │
│  │ (API)     │   │ (rules)  │   │  on Base)         │   │
│  └──────────┘   └──────────┘   └──────────────────┘   │
│                                         │               │
│                          ┌──────────────▼────────────┐ │
│                          │  Reporter                  │ │
│                          │  ├── Twitter (@CoinStrat)  │ │
│                          │  ├── Telegram channel      │ │
│                          │  └── Transparency dashboard│ │
│                          └───────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

#### Decision Logic

```
Every day at 09:00 UTC:
  1. Fetch /api/v1/signals/current
  2. If CORE_ON changed since yesterday → log state transition
  3. If CORE_ON == true:
     a. If MACRO_ON == true → execute 3× DCA via Power Wallet
     b. Else → execute 1× DCA via Power Wallet
  4. If CORE_ON == false:
     a. Pause DCA (hold USDC in wallet)
  5. Post daily update with:
     - Signal state and reasoning
     - Today's action (bought / paused / accelerated)
     - Portfolio value, BTC held, performance vs. blind DCA
     - On-chain tx hash as proof
```

### 3.2 Revenue Funding Pipeline

```
Monthly subscription revenue
    │
    ├── 50–70% → Operating account (infra, APIs, development)
    │
    └── 30–50% → USDC transfer to agent wallet on Base
                    │
                    ├── Logged on transparency dashboard
                    │   (amount, date, source: "revenue deposit")
                    │
                    └── Agent deploys according to CoinStrat signals
```

#### Implementation

- At each revenue milestone (weekly or monthly), transfer the dogfooding allocation to the agent's Base wallet as USDC
- The agent's Power Wallet executes DCA according to signals
- All deposits and trades are logged both on-chain and on the transparency dashboard

### 3.3 Transparency Dashboard

A public page on the CoinStrat Pro website showing the agent's complete history.

#### Dashboard Components

| Component | Description |
|-----------|-------------|
| **Wallet address** | Clickable link to Basescan — anyone can independently verify |
| **Total deposited** | Cumulative USDC deposited from revenue (with dates) |
| **Current holdings** | BTC held + USDC balance + total portfolio value |
| **Performance** | Total return %, vs. blind DCA comparison, max drawdown |
| **Trade log** | Every trade: date, action (buy/pause/accelerate), amount, BTC price, signal state, tx hash |
| **Signal state history** | When CORE/MACRO flipped, what the agent did, and why |
| **Revenue allocation** | Current split percentage, total allocated to date |

#### Data Source

- On-chain data (wallet balance, transactions) read directly from Base via RPC
- Signal state at time of each trade pulled from the Signal API history
- LLM-generated reasoning cached and displayed alongside each trade

### 3.4 Agent-as-Marketing

- The agent gets its own Twitter presence (e.g., @CoinStrat or dedicated agent account)
- Daily posts with on-chain proof build credibility
- Weekly performance summaries posted to Telegram channel and Twitter
- "Follow the agent, see its track record, then try CoinStrat yourself"
- Drawdown moments are proactively narrated: "Agent paused buying on [date] because DXY headwinds triggered CORE exit. Portfolio held steady while BTC dropped 12%. Here's the tx proof."

### 3.5 Developer Documentation

Publish docs enabling others to build agents with CoinStrat:

- "Getting Started with the CoinStrat API"
- "Building an AI Agent that Uses CoinStrat Signals"
- "Building an OpenClaw Skill with CoinStrat"
- "Connecting CoinStrat to Power Wallet"
- Example agent code (TypeScript + Python)

### Deliverables Checklist — Phase 3

- [ ] Agent running as OpenClaw instance with CoinStrat skill
- [ ] Signal reader module (consumes CoinStrat API)
- [ ] Decision engine (CORE/MACRO rules)
- [ ] Execution module (interact with Power Wallet contracts on Base)
- [ ] Reporter module (Twitter + Telegram daily updates with tx proof)
- [ ] Agent wallet funded on Base with first revenue deposit
- [ ] Transparency dashboard (public page on CoinStrat Pro website)
- [ ] Revenue funding pipeline (manual initially, automated later)
- [ ] Developer docs for API + agent + OpenClaw skill integration
- [ ] Example agent code (TypeScript + Python)

---

## Phase 4: CoinStrat Oracle + Power Wallet "Macro" Strategy

**Timeline:** Months 4–7
**Goal:** Full on-chain integration. The endgame. CoinStrat intelligence becomes infrastructure for DeFi.

### 4.1 CoinStrat Oracle Contract (Base)

A Solidity contract that stores the latest CoinStrat signal state on-chain, updated by an authorised keeper.

#### Contract Interface

```solidity
interface ICoinStratOracle {
    // Latest signal state
    function coreOn() external view returns (bool);
    function macroOn() external view returns (bool);
    function valScore() external view returns (uint8);    // 0–3
    function liqScore() external view returns (uint8);    // 0–2
    function dxyScore() external view returns (uint8);    // 0–2
    function cycleScore() external view returns (uint8);  // 0–2

    // Metadata
    function lastUpdated() external view returns (uint256);  // block timestamp
    function updateCount() external view returns (uint256);

    // Events
    event SignalsUpdated(bool coreOn, bool macroOn, uint256 timestamp);
    event CoreFlipped(bool newState, uint256 timestamp);
}
```

#### Keeper System

- **Option A:** Chainlink Automation (time-based, e.g. daily at 09:00 UTC) triggers an off-chain function that computes signals and calls `updateSignals()` on the oracle contract.
- **Option B:** Custom keeper (cron job on Fly.io / Railway) that runs the CoinStrat engine, then submits an on-chain transaction.

**Recommendation:** Start with Option B (custom keeper) for flexibility and lower cost. Migrate to Chainlink Automation for decentralisation if the oracle is consumed by third parties.

### 4.2 Power Wallet "Macro" Strategy

A new strategy contract that reads the CoinStrat Oracle and executes DCA accordingly.

#### Strategy Logic

```
On each Chainlink Automation upkeep (or manual trigger):
  1. Read CoinStratOracle.coreOn() and CoinStratOracle.macroOn()
  2. If coreOn:
     a. If macroOn → swap (dcaAmount × accelMultiplier) USDC → cbBTC via Uniswap
     b. Else → swap dcaAmount USDC → cbBTC
  3. If !coreOn:
     a. Hold USDC (or sell, based on user config)
```

This becomes the **5th Power Wallet strategy** — and by far the most sophisticated, because it incorporates macro economics and on-chain valuation, not just price-based technical indicators.

#### Configuration (per user wallet)

- `dcaAmount`: USDC per period
- `accelMultiplier`: Multiplier when MACRO is ON (default 3)
- `offSignalMode`: pause | sell_matching | sell_all (same as backtest config)

### 4.3 Migrate Agent Wallet to Macro Strategy

Once the Macro strategy is live, the CoinStrat dogfooding agent migrates from the Phase 3 approach (agent calling Power Wallet externally) to the native Macro strategy contract. This simplifies execution and proves the on-chain strategy works end-to-end.

### 4.4 Oracle as Public Good / Paid Service

The oracle is valuable beyond Power Wallet:

- Other DeFi protocols can read it (composability)
- Charge for oracle access (per-read fee or monthly subscription via NFT gating)
- Or keep it free and earn from Power Wallet protocol fees driven by the oracle

### Deliverables Checklist — Phase 4

- [ ] CoinStratOracle Solidity contract (signals + scores storage)
- [ ] Keeper system (custom or Chainlink Automation)
- [ ] Oracle deployment on Base Sepolia (testnet)
- [ ] Power Wallet "Macro" strategy contract
- [ ] Integration tests (oracle → strategy → Uniswap swap)
- [ ] Oracle deployment on Base mainnet
- [ ] Macro strategy deployment on Base mainnet
- [ ] Migrate dogfooding agent wallet to Macro strategy
- [ ] Update Power Wallet frontend with Macro strategy option
- [ ] Update Simulator with Macro strategy backtesting
- [ ] Update transparency dashboard with on-chain strategy data

---

## Tech Stack Summary

| Component | Technology | Notes |
|-----------|-----------|-------|
| **CoinStrat Pro (web)** | React 18, TypeScript, Vite, MUI, Recharts | Existing, add auth + payments + transparency dashboard |
| **Signal API** | Netlify Functions → Deno Deploy / Hono | Start simple, scale as needed |
| **Auth** | Supabase Auth (or Clerk) | Email, Google, GitHub SSO |
| **Database** | Supabase (Postgres) | Users, API keys, signal cache, agent trade log |
| **Payments (fiat)** | Stripe | Checkout, subscriptions, webhooks |
| **Payments (crypto)** | USDC on Base | Direct transfer or payment contract |
| **OpenClaw Skill** | SKILL.md + TypeScript helpers | Published to ClawHub, multi-channel distribution |
| **AI Agent** | OpenClaw instance | Runs CoinStrat skill + Power Wallet execution |
| **LLM** | Claude API or GPT-4o | For signal reasoning and agent reporting |
| **Oracle contract** | Solidity, Hardhat | Deployed on Base |
| **Macro strategy** | Solidity, Hardhat | Extends Power Wallet architecture |
| **Hosting** | Netlify (web), Deno Deploy (API) | Low cost, global edge |

---

## Dependencies Between Phases

```
Phase 1 ──────► Phase 2 ──────► Phase 3 ──────────► Phase 4
Signal API       OpenClaw skill  Agent consumes       Oracle pushes
is foundation    consumes API,   API, executes via    signals on-chain,
for everything   multi-channel   Power Wallet,        strategy reads
                 distribution    funded by revenue    oracle
```

- Phase 2 depends on Phase 1 (skill consumes the API)
- Phase 3 depends on Phase 1 (agent consumes the API) + Phase 2 (agent uses OpenClaw framework) + Power Wallet (execution)
- Phase 4 depends on Phase 1 (keeper runs the same engine) + Power Wallet (strategy contract)
- Phases 2 and 3 can overlap once the API is live

---

## Key Milestones

| Week | Milestone | Revenue Impact |
|------|-----------|---------------|
| 2 | Signal API live (`/current`, `/history`) | Enables everything |
| 3 | Stripe + auth integrated | First paid subscribers |
| 4 | CoinStrat Pro freemium launch | Free users → email list |
| 6 | OpenClaw skill on ClawHub | Multi-channel distribution |
| 8 | OpenClaw skill tested + stable | Pro upgrade funnel from all channels |
| 10 | Agent wallet funded, first trade | Dogfooding begins |
| 12 | Transparency dashboard live | Trust layer visible |
| 14 | Agent posting daily updates | Organic marketing engine |
| 20 | Oracle contract on Base Sepolia | On-chain integration starts |
| 28 | Macro strategy on Base mainnet | Full stack operational |
