# CoinStrat — Business Strategy

## Vision

Build the **intelligence layer for Bitcoin accumulation** — a vertically integrated stack where CoinStrat provides the macro-driven signals, Power Wallet executes on-chain, and AI agents bridge the two. Revenue flows from signal subscriptions, API access, and protocol fees — and a portion of that revenue is publicly reinvested via the CoinStrat AI agent, creating a verifiable, on-chain track record that proves the product works.

---

## The Problem

~50M Americans hold crypto. Most who dollar-cost average do it blindly — fixed schedule, fixed amount, regardless of macro conditions. The tools available today are:

| Tool | Limitation |
|------|-----------|
| Exchange auto-buy (Coinbase, Strike, Swan) | Dumb schedule-based DCA, no market awareness |
| Charting platforms (TradingView) | For active traders, requires expertise, no accumulation focus |
| On-chain analytics (Glassnode, CryptoQuant) | Expensive ($40–800/month), raw data, requires interpretation |
| Newsletters / alpha groups | Subjective, unverifiable, no execution |

**Nobody is offering a simple, data-backed answer to "Should I buy this week, and how much?" — combined with self-custodial automated execution.**

---

## The Solution: A Four-Layer Stack

```
┌─────────────────────────────────────────────────────────┐
│                  DISTRIBUTION LAYER                      │
│                                                          │
│  CoinStrat Pro       OpenClaw Skill      Standalone      │
│  (web dashboard)     (WhatsApp, Telegram, API consumers  │
│                       Discord, Signal,                   │
│                       iMessage — all                     │
│                       via one skill)                     │
│                                                          │
│  Multiple interfaces, one API. OpenClaw provides         │
│  instant multi-channel reach via a single skill.         │
├─────────────────────────────────────────────────────────┤
│                  INTELLIGENCE LAYER                      │
│                                                          │
│  CoinStrat Signal API                                    │
│  ├── CORE_ON / MACRO_ON / ACCUM_ON (composite signals)  │
│  ├── VAL_SCORE, LIQ_SCORE, DXY_SCORE, CYCLE_SCORE      │
│  ├── Real-time + historical time series                  │
│  └── Webhooks for signal-flip events                     │
│                                                          │
│  The core IP. Macro + on-chain data synthesised into     │
│  actionable accumulation signals. This is what we sell.  │
├─────────────────────────────────────────────────────────┤
│                  EXECUTION LAYER                         │
│                                                          │
│  Power Wallet (Base blockchain)                          │
│  ├── Existing strategies: Pure, Smart, Power, Trend      │
│  ├── CoinStrat agent wallet (funded by subscription      │
│  │   revenue — the dogfooding wallet)                    │
│  ├── User wallets (self-custodial)                       │
│  └── Future: "Macro" strategy (fed by CoinStrat Oracle)  │
│                                                          │
│  On-chain execution with verifiable track record.        │
│  Protocol fees scale with TVL.                           │
├─────────────────────────────────────────────────────────┤
│                  TRUST LAYER                             │
│                                                          │
│  Public Dogfooding Dashboard                             │
│  ├── Agent wallet address (verifiable on Basescan)       │
│  ├── Revenue → BTC pipeline (transparent)                │
│  ├── Every trade with signal state + reasoning           │
│  └── Performance vs. blind DCA (live, auditable)         │
│                                                          │
│  Skin in the game. We invest our own revenue using our   │
│  own signals. The on-chain record is our marketing.      │
└─────────────────────────────────────────────────────────┘
```

---

## Competitive Advantages

1. **Unique signal set.** CoinStrat combines macro economics (Fed net liquidity, DXY, yield curve, Sahm Rule) with on-chain valuation (MVRV, LTH SOPR) into a stateful, hysteresis-protected signal engine. No competitor offers this specific combination for accumulation timing.

2. **Full vertical integration.** Intelligence (CoinStrat) + Execution (Power Wallet) + Distribution (OpenClaw skill + web). Most competitors are point solutions — a dashboard here, a bot there, a DCA tool somewhere else.

3. **On-chain verifiability.** Power Wallet's track record is immutable and auditable. This is the ultimate trust signal — no screenshots, no "trust me bro," just on-chain proof.

4. **Dogfooding with skin in the game.** We publicly invest a portion of our own subscription revenue using our own signals, executed by our own AI agent, on our own smart contracts. Every transaction is verifiable on-chain. This level of transparency is unheard of in the signal/analytics space.

5. **Multiple revenue streams.** Not dependent on a single monetisation path. Subscriptions, API fees, and protocol fees each address a different customer segment.

6. **AI agent compatibility.** The Signal API is designed for programmatic consumption. As an OpenClaw skill, CoinStrat gets instant access to WhatsApp, Telegram, Discord, Signal, iMessage, and every other channel OpenClaw supports — through a single integration.

---

## Dogfooding: Revenue-Funded Agent Wallet

### The Concept

A fixed percentage of CoinStrat Pro subscription revenue is deposited into the CoinStrat AI agent's Power Wallet on Base. The agent executes the Core DCA strategy using CoinStrat's own signals. Every deposit, trade, and portfolio value is publicly visible on-chain.

### How It Works

```
Subscription revenue (Stripe + USDC)
    │
    ├── 50–70% → Operating costs (infra, APIs, development)
    │
    └── 30–50% → CoinStrat Agent Wallet (USDC on Base)
                    │
                    └── Agent reads CoinStrat API daily
                        ├── CORE ON → Buy cbBTC via Power Wallet
                        ├── CORE ON + MACRO ON → 3× DCA buy
                        └── CORE OFF → Hold USDC (dry powder)
```

### What Makes This Work

- **Public wallet address** — anyone can verify on Basescan at any time
- **Every trade linked to signal state** — the dashboard shows what the signal was when each trade executed
- **Performance vs. blind DCA** — continuously updated comparison, using the same methodology as the backtest simulator
- **Drawdowns are features** — when the agent pauses because CORE flipped OFF, or the portfolio draws down, that's the signal doing its job. Transparency through adversity builds more trust than uninterrupted gains.

### Important Framing (Legal)

CoinStrat invests a portion of **its own business revenue** using its own signal engine. This is corporate dogfooding — the company investing its own profits. It is NOT a pooled investment vehicle and subscribers' funds are NOT being invested on their behalf. Subscribers pay for a signal service; the company separately and independently chooses to invest its own revenue using those same signals.

---

## Target Customers

| Segment | Profile | Channel | Monetisation |
|---------|---------|---------|-------------|
| **Retail accumulators** | DCA into Bitcoin regularly, want better timing, not traders | CoinStrat Pro (web) + OpenClaw skill | Pro subscription ($14.99/month) |
| **Power users** | Want custom strategies, backtest their own ideas, deeper data | CoinStrat Pro+ | Higher tier ($29.99/month) |
| **Developers / builders** | Building crypto tools, bots, dashboards, AI agents | Signal API | API usage tiers ($29–299/month) |
| **DeFi-native users** | Want self-custodial, automated, on-chain execution | Power Wallet | Protocol fees (0.1–0.3% per swap) |
| **OpenClaw users** | Want their personal AI assistant to manage DCA intelligence | OpenClaw skill + Signal API | Pro subscription + API fees |

---

## Revenue Model

### Stream 1: CoinStrat Pro Subscriptions (Phase 1)

| Tier | Price | Includes |
|------|-------|---------|
| **Free** | $0 | Current signal status, weekly email digest, 1-year backtest |
| **Pro** | $14.99/month | Real-time alerts (all channels via OpenClaw), full signal history, unlimited backtesting, API access (1K calls/day) |
| **Pro+** | $29.99/month | Everything in Pro + custom strategy builder, priority webhooks, extended API limits (10K calls/day) |

**Payment methods:** Stripe (credit/debit card) + USDC on Base (crypto-native option).

### Stream 2: Signal API (Phase 1–2)

| Tier | Price | Rate Limit |
|------|-------|-----------|
| **Free** | $0 | 100 calls/day, current signals only |
| **Builder** | $29/month | 5K calls/day, full history |
| **Pro** | $99/month | 25K calls/day, WebSocket stream, webhooks |
| **Enterprise** | $299/month | Unlimited, SLA, dedicated support |

### Stream 3: Power Wallet Protocol Fees (Phase 3–4)

- 0.1–0.3% fee on each DCA swap executed through Power Wallet
- Scales with TVL — no additional cost to us per transaction
- Applies to all strategies, including the future "Macro" strategy

### Revenue Allocation

| Category | % of Revenue | Purpose |
|----------|-------------|---------|
| **Operating costs** | 50–70% | Infrastructure, API keys, LLM costs, development |
| **Agent wallet (dogfooding)** | 30–50% | Publicly invested via CoinStrat signals + Power Wallet |

The dogfooding percentage can start at 30% and increase as the business stabilizes. The exact split is published on the transparency dashboard.

### Revenue Projections (Conservative)

| Milestone | Subscribers | API Customers | Monthly Revenue | Agent Wallet Deposit |
|-----------|------------|--------------|----------------|---------------------|
| Month 3 | 100 Pro | 10 Builder | ~$1,800 | ~$540–900 |
| Month 6 | 500 Pro | 30 Builder, 5 Pro | ~$8,500 | ~$2,550–4,250 |
| Month 12 | 2,000 Pro | 50 Builder, 20 Pro, 5 Enterprise | ~$35,000 | ~$10,500–17,500 |
| Month 18+ | + Power Wallet protocol fees | + AI agent API volume | $50,000+ | $15,000+ |

---

## The Flywheel

```
Free signals (weekly email, public dashboard)
    → Build community and credibility
        → Community drives Pro subscriptions
            → Subscription revenue funds the agent wallet (dogfooding)
                → Agent executes via Power Wallet using CoinStrat signals
                    → On-chain track record is publicly verifiable
                        → Verifiable performance is the ultimate marketing
                            → More users → more subscriptions → more revenue
                                → More revenue → bigger agent wallet → stronger proof
                                    → AI agents + OpenClaw users discover the API
                                        → API fees + protocol fees compound
                                            → Repeat
```

Each layer reinforces the others. Free content drives awareness. Subscriptions fund the agent. The agent's on-chain performance proves the product. Proof drives more subscriptions. The flywheel accelerates as the agent wallet grows.

---

## Go-to-Market Strategy

### Content Marketing (Ongoing)
- Weekly signal recap thread on Twitter/X (free — drives awareness)
- Monthly backtest case studies ("CoinStrat DCA vs. Blind DCA: 2022–2025")
- Educational content explaining macro indicators in plain language
- Agent wallet performance reports (weekly, with on-chain links)

### OpenClaw Community (Phase 2)
- Publish CoinStrat skill to ClawHub (OpenClaw's skill marketplace)
- Tap into OpenClaw's 197K+ GitHub stars community
- OpenClaw users are technically sophisticated and crypto-friendly — ideal audience
- Skill installation = instant distribution across all messaging channels

### Dogfooding Narrative (Phase 2–3)
- "We invest our own revenue using our own signals" — tweet thread that writes itself
- Public agent wallet address becomes a living marketing asset
- Weekly agent performance updates with on-chain proof
- Drawdown transparency moments build credibility ("Agent paused buying — here's why")

### Community (Phase 1–2)
- Telegram group as the community hub (complementing OpenClaw distribution)
- Engage with Bitcoin DCA communities (r/Bitcoin, Bitcoin Twitter, Stacker News)
- Developer docs drive API adoption

### Partnerships (Phase 3–4)
- Integrate with other DCA platforms via API
- Partner with crypto wallets for signal integration
- OpenClaw ecosystem partnerships

---

## Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Signal underperformance in live markets | Credibility damage, churn | Transparent methodology, agent wallet as live proof, position as "risk management" not "alpha generation" |
| Regulatory (investment advice) | Legal liability | Clear disclaimers, no personal recommendations, educational framing, agent wallet is company dogfooding (not a fund) |
| Dogfooding wallet loses value during drawdowns | Perception risk | Proactive transparency — document drawdowns as the signal working, compare vs. blind DCA which would have lost more |
| Data source reliability (FRED, BGeometrics) | Service disruption | Multi-source fallback, caching, carry-forward logic (already implemented) |
| Competition from established analytics platforms | Market share | Focus on accumulation niche (not trading), simplicity, dogfooding proof, and the execution layer (Power Wallet) |
| Smart contract risk (Power Wallet) | Loss of user funds / agent funds | Audits, battle-tested patterns, upgradeable architecture, testnet-first |
| OpenClaw platform risk (breaking changes) | Skill disruption | Maintain standalone API as primary product; OpenClaw skill is a distribution channel, not a dependency |

---

## Success Metrics

| Metric | 6-month Target | 12-month Target |
|--------|---------------|----------------|
| Pro subscribers | 500 | 2,000 |
| API paying customers | 35 | 75 |
| Monthly recurring revenue | $8,500 | $35,000 |
| Agent wallet total deposited | $10,000 | $80,000 |
| Agent wallet BTC accumulated | Track vs. blind DCA | Track vs. blind DCA |
| OpenClaw skill installs | 500 | 3,000 |
| Community size (Telegram + Discord) | 2,000 | 10,000 |
| Power Wallet TVL | — | $500K |
| Weekly email list | 5,000 | 20,000 |
