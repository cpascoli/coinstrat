# CoinStrat — Product Delivery Roadmap

## Overview

Four phases, each building on the last. Each phase delivers a shippable product that generates revenue independently, while also feeding into the larger vision.

```
Phase 1          Phase 2          Phase 3              Phase 4
CoinStrat Pro    Telegram Bot     AI Agent              On-Chain Oracle
+ Signal API     (StackPilot)     Integration           + Power Wallet
                                  (OpenClaw)            "Macro" Strategy
Weeks 1–4        Weeks 4–8        Weeks 8–14            Months 4–7
─────────────────────────────────────────────────────────────────────►
                     Revenue starts here ───►
```

---

## Phase 1: CoinStrat Pro + Signal API

**Timeline:** Weeks 1–4
**Goal:** First revenue. Ship the freemium web product and the API that powers everything downstream.

### 1.1 Signal API (the foundation)

Everything — the web dashboard, the Telegram bot, the AI agents — consumes the same API. Build this first.

#### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/signals/current` | Free (rate-limited) | Latest signal snapshot: CORE_ON, MACRO_ON, ACCUM_ON, all scores, BTC price, timestamp |
| `GET` | `/api/v1/signals/history` | API key (paid) | Full daily signal history, filterable by date range |
| `GET` | `/api/v1/signals/scores` | API key (paid) | Individual score time series (VAL, LIQ, DXY, CYCLE) |
| `WS` | `/api/v1/signals/stream` | API key (paid) | WebSocket stream, pushes updates when signals change |
| `POST` | `/api/v1/webhooks` | API key (paid) | Register a webhook URL to receive signal-flip events |
| `GET` | `/api/v1/backtest` | API key (Pro+) | Run a backtest with custom parameters, return results as JSON |

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
- **User model:** email, subscription tier, API key, created_at
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
| Real-time alerts | — | Email + push | Email + push + webhook |
| API access | 100 calls/day | 1K calls/day | 10K calls/day |
| Custom strategy builder | — | — | Yes |

#### Implementation Notes

- Gate features with a simple `tier` check from the user's session
- Use a context provider (`SubscriptionContext`) to make tier info available app-wide
- Unauthenticated users see the free tier; login unlocks Pro features based on subscription

### 1.5 Weekly Email Digest (Free Tier — Growth Engine)

- **Content:** Current signal status, key metrics snapshot, 1-paragraph market context, CTA to upgrade
- **Provider:** Resend, Postmark, or Loops (lightweight transactional + marketing email)
- **Frequency:** Every Monday morning
- **Sign-up:** Email capture on the landing page (no account required)
- **Purpose:** Top-of-funnel. Build the email list. Every subscriber is a future Pro customer.

### Deliverables Checklist — Phase 1

- [ ] Signal API: `/current`, `/history`, `/scores` endpoints
- [ ] API key generation and rate limiting
- [ ] Supabase Auth integration (email + Google sign-in)
- [ ] Stripe Checkout integration (Pro + Pro+ tiers)
- [ ] USDC payment flow (manual or semi-automated)
- [ ] Feature gating in web dashboard (free vs. Pro vs. Pro+)
- [ ] Weekly email digest system
- [ ] Landing page updates (pricing section, sign-up CTA)
- [ ] API documentation page (public)

---

## Phase 2: Telegram Bot (StackPilot / CoinStrat Bot)

**Timeline:** Weeks 4–8
**Goal:** Distribution + community hub. Meet users where they already are.

### 2.1 Bot Framework

- **Library:** grammY (TypeScript, Deno-compatible) or Telegraf (Node.js)
- **Hosting:** Deno Deploy, Cloudflare Workers, or Fly.io (webhook mode, not polling)
- **Data source:** Consumes the CoinStrat Signal API (same as web dashboard)

### 2.2 Bot Commands

| Command | Free | Pro | Description |
|---------|------|-----|-------------|
| `/signal` | Yes | Yes | Current signal: "CORE: ON, MACRO: OFF → BUY (base DCA)" with colour-coded emoji |
| `/scores` | Yes | Yes | Current scores: VAL 2, LIQ 1, DXY 2, CYCLE 1 |
| `/why` | — | Yes | Plain-language explanation of current signal state, powered by LLM (GPT-4o or Claude) interpreting the raw scores |
| `/alert on` | — | Yes | Enable real-time push when CORE or MACRO flips |
| `/alert off` | — | Yes | Disable alerts |
| `/backtest 3y` | — | Yes | Quick backtest summary (total return, max drawdown) for a given period |
| `/portfolio` | — | Yes | Track DCA buys, show performance vs. blind DCA (user logs buys manually or via exchange API) |
| `/subscribe` | Yes | — | Link to CoinStrat Pro checkout (Stripe or USDC) |
| `/help` | Yes | Yes | Command reference |

### 2.3 Daily Pulse (Scheduled Message)

- Runs daily at a configurable time (e.g. 08:00 UTC)
- Posts to a public Telegram channel (e.g. @coinstrat_signals)
- Format:

```
📊 CoinStrat Daily Pulse — 2026-02-15

Signal: 🟢 BUY (CORE ON)
Intensity: ⚡ ACCELERATED (MACRO ON, 3× DCA)

Scores: VAL 2 | LIQ 2 | DXY 1 | CYCLE 2
BTC: $98,420 | MVRV: 1.42 | DXY: ▼ falling

"Macro liquidity expanding, on-chain valuation fair.
Conditions favour continued accumulation."

🔔 Want real-time alerts? /subscribe
```

### 2.4 LLM Integration for `/why` Command

- Send current scores + recent changes to an LLM (Claude or GPT-4o)
- System prompt: "You are CoinStrat's macro analyst. Explain the current signal state in 2-3 sentences, using the score data provided. Be concise, data-driven, and avoid hype."
- Cache responses for 1 hour to control API costs

### 2.5 User Linking

- Telegram users link their CoinStrat Pro account via a one-time token
- Pro features unlocked in the bot based on subscription status
- Same Supabase user record, different interface

### Deliverables Checklist — Phase 2

- [ ] Bot scaffold with grammY/Telegraf, webhook mode
- [ ] Core commands: `/signal`, `/scores`, `/help`, `/subscribe`
- [ ] Pro commands: `/why`, `/alert`, `/backtest`, `/portfolio`
- [ ] Daily pulse scheduled post to public channel
- [ ] LLM integration for `/why` (with caching)
- [ ] User account linking (Telegram ↔ CoinStrat Pro)
- [ ] Telegram group set up as community hub
- [ ] Bot deployed to production

---

## Phase 3: AI Agent Integration

**Timeline:** Weeks 8–14
**Goal:** Connect CoinStrat intelligence to autonomous on-chain execution. Ride the AI agent narrative.

### 3.1 CoinStrat AI Agent (OpenClaw or similar framework)

Build an autonomous agent that:

1. **Reads** CoinStrat signals via the API (consumer of Phase 1)
2. **Decides** whether to buy, pause, or accelerate based on CORE/MACRO state
3. **Executes** on-chain via Power Wallet contracts on Base
4. **Reports** daily performance updates to Twitter and Telegram

#### Agent Architecture

```
┌─────────────────────────────────────────────┐
│              CoinStrat AI Agent              │
│                                              │
│  ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │ Signal    │   │ Decision │   │ Execute │ │
│  │ Reader    │──►│ Engine   │──►│ Module  │ │
│  │ (API)     │   │ (rules + │   │ (Power  │ │
│  │           │   │  LLM)    │   │ Wallet) │ │
│  └──────────┘   └──────────┘   └─────────┘ │
│                                     │        │
│                              ┌──────▼──────┐ │
│                              │  Reporter   │ │
│                              │ (Twitter +  │ │
│                              │  Telegram)  │ │
│                              └─────────────┘ │
└─────────────────────────────────────────────┘
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
  5. Post daily update to Twitter + Telegram with:
     - Signal state and reasoning
     - Today's action (bought / paused / accelerated)
     - Portfolio value, BTC held, performance vs. blind DCA
     - On-chain tx hash as proof
```

### 3.2 Developer Documentation

Publish docs enabling others to build agents with CoinStrat:

- "Getting Started with the CoinStrat API"
- "Building an AI Agent that Uses CoinStrat Signals"
- "Connecting CoinStrat to Power Wallet"
- Example agent code (TypeScript + Python)

### 3.3 Agent-as-Marketing

- The agent gets its own Twitter account (@CoinStratAgent)
- Daily posts with on-chain proof build credibility
- "Follow the agent, see its track record, then build your own with our API"
- The agent's verifiable performance is more convincing than any ad

### Deliverables Checklist — Phase 3

- [ ] Agent scaffold on OpenClaw (or chosen framework)
- [ ] Signal reader module (consumes CoinStrat API)
- [ ] Decision engine (CORE/MACRO rules)
- [ ] Execution module (interact with Power Wallet contracts on Base)
- [ ] Reporter module (Twitter + Telegram daily updates)
- [ ] Agent wallet funded on Base with USDC
- [ ] Developer docs for API + agent integration
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

### 4.3 Oracle as Public Good / Paid Service

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
- [ ] Update Power Wallet frontend with Macro strategy option
- [ ] Update Simulator with Macro strategy backtesting

---

## Tech Stack Summary

| Component | Technology | Notes |
|-----------|-----------|-------|
| **CoinStrat Pro (web)** | React 18, TypeScript, Vite, MUI, Recharts | Existing, add auth + payments |
| **Signal API** | Netlify Functions → Deno Deploy / Hono | Start simple, scale as needed |
| **Auth** | Supabase Auth (or Clerk) | Email, Google, GitHub SSO |
| **Database** | Supabase (Postgres) | Users, API keys, signal cache |
| **Payments (fiat)** | Stripe | Checkout, subscriptions, webhooks |
| **Payments (crypto)** | USDC on Base | Direct transfer or payment contract |
| **Telegram Bot** | grammY (TypeScript) | Webhook mode on Deno Deploy |
| **LLM** | Claude API or GPT-4o | For `/why` command and agent reasoning |
| **AI Agent** | OpenClaw / custom | TypeScript, consumes Signal API |
| **Oracle contract** | Solidity, Hardhat | Deployed on Base |
| **Macro strategy** | Solidity, Hardhat | Extends Power Wallet architecture |
| **Hosting** | Netlify (web), Deno Deploy (API + bot) | Low cost, global edge |

---

## Dependencies Between Phases

```
Phase 1 ──────► Phase 2 ──────► Phase 3 ──────► Phase 4
Signal API       Bot consumes    Agent consumes   Oracle pushes
is foundation    Signal API      Signal API +     signals on-chain,
for everything                   executes via     strategy reads
                                 Power Wallet     oracle
```

- Phase 2 depends on Phase 1 (bot consumes the API)
- Phase 3 depends on Phase 1 (agent consumes the API) + Power Wallet (execution)
- Phase 4 depends on Phase 1 (keeper runs the same engine) + Power Wallet (strategy contract)
- Phases 2 and 3 can overlap or run in parallel once the API is live
