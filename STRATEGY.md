# CoinStrat — Business Strategy

## Vision

Build the **intelligence layer for Bitcoin accumulation** — a vertically integrated stack where CoinStrat provides the macro-driven signals, Power Wallet executes on-chain, and AI agents bridge the two. Revenue flows from signal subscriptions, API access, and protocol fees.

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

## The Solution: A Three-Layer Stack

```
┌─────────────────────────────────────────────────────────┐
│                  DISTRIBUTION LAYER                      │
│                                                          │
│  CoinStrat Pro     Telegram Bot     AI Agents            │
│  (web dashboard)   (StackPilot)     (OpenClaw + others)  │
│                                                          │
│  How people access the signals. Multiple interfaces,     │
│  one API. Each channel reaches a different audience.     │
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
│  ├── Future: "Macro" strategy (fed by CoinStrat Oracle)  │
│  └── Self-custodial, auditable, automated                │
│                                                          │
│  On-chain execution with verifiable track record.        │
│  Protocol fees scale with TVL.                           │
└─────────────────────────────────────────────────────────┘
```

---

## Competitive Advantages

1. **Unique signal set.** CoinStrat combines macro economics (Fed net liquidity, DXY, yield curve, Sahm Rule) with on-chain valuation (MVRV, LTH SOPR) into a stateful, hysteresis-protected signal engine. No competitor offers this specific combination for accumulation timing.

2. **Full vertical integration.** Intelligence (CoinStrat) + Execution (Power Wallet) + Distribution (bot + agents). Most competitors are point solutions — a dashboard here, a bot there, a DCA tool somewhere else.

3. **On-chain verifiability.** Power Wallet's track record is immutable and auditable. This is the ultimate trust signal — no screenshots, no "trust me bro," just on-chain proof.

4. **Multiple revenue streams.** Not dependent on a single monetisation path. Subscriptions, API fees, and protocol fees each address a different customer segment.

5. **AI agent compatibility.** The Signal API is designed for programmatic consumption. As the AI agent ecosystem grows, CoinStrat becomes infrastructure that agents pay for — a B2B2C revenue stream.

---

## Target Customers

| Segment | Profile | Channel | Monetisation |
|---------|---------|---------|-------------|
| **Retail accumulators** | DCA into Bitcoin regularly, want better timing, not traders | CoinStrat Pro (web) + Telegram bot | Pro subscription ($14.99/month) |
| **Power users** | Want custom strategies, backtest their own ideas, deeper data | CoinStrat Pro+ | Higher tier ($29.99/month) |
| **Developers / builders** | Building crypto tools, bots, dashboards, AI agents | Signal API | API usage tiers ($29–299/month) |
| **DeFi-native users** | Want self-custodial, automated, on-chain execution | Power Wallet | Protocol fees (0.1–0.3% per swap) |
| **AI agent operators** | Running autonomous investment agents on OpenClaw or similar | Signal API + Power Wallet | API fees + protocol fees |

---

## Revenue Model

### Stream 1: CoinStrat Pro Subscriptions (Phase 1)

| Tier | Price | Includes |
|------|-------|---------|
| **Free** | $0 | Current signal status, weekly email digest, 1-year backtest |
| **Pro** | $14.99/month | Real-time alerts (email, Telegram, push), full signal history, unlimited backtesting, API access (1K calls/day) |
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

### Revenue Projections (Conservative)

| Milestone | Subscribers | API Customers | Monthly Revenue |
|-----------|------------|--------------|----------------|
| Month 3 | 100 Pro | 10 Builder | ~$1,800 |
| Month 6 | 500 Pro | 30 Builder, 5 Pro | ~$8,500 |
| Month 12 | 2,000 Pro | 50 Builder, 20 Pro, 5 Enterprise | ~$35,000 |
| Month 18+ | + Power Wallet protocol fees | + AI agent API volume | $50,000+ |

---

## The Flywheel

```
Free signals (weekly email, public dashboard)
    → Build community and credibility
        → Community drives Pro subscriptions
            → Pro users discover Power Wallet
                → Power Wallet earns protocol fees
                    → Signal API enables AI agents
                        → AI agents drive more Power Wallet volume
                            → On-chain track record is the ultimate marketing
                                → More users → more community → repeat
```

Each layer reinforces the others. Free content drives awareness. Subscriptions fund development. On-chain execution creates verifiable proof. AI agents scale distribution beyond what manual marketing can achieve.

---

## Go-to-Market Strategy

### Content Marketing (Ongoing)
- Weekly signal recap thread on Twitter/X (free — drives awareness)
- Monthly backtest case studies ("CoinStrat DCA vs. Blind DCA: 2022–2025")
- Educational content explaining macro indicators in plain language
- Power Wallet on-chain performance reports

### Community (Phase 1–2)
- Telegram group as the community hub
- CoinStrat bot as the group's resident analyst
- Engage with Bitcoin DCA communities (r/Bitcoin, Bitcoin Twitter, Stacker News)

### AI Agent Narrative (Phase 3)
- Launch CoinStrat AI agent with its own wallet and public track record
- Developer docs: "How to build an AI agent with CoinStrat signals"
- Agent's daily updates on Twitter serve as organic marketing

### Partnerships (Phase 3–4)
- Integrate with other DCA platforms via API
- Partner with crypto wallets for signal integration
- OpenClaw / AI agent marketplace listings

---

## Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Signal underperformance in live markets | Credibility damage, churn | Transparent backtest methodology, position as "risk management" not "alpha generation" |
| Regulatory (investment advice) | Legal liability | Clear disclaimers, no personal recommendations, educational framing, signals are informational |
| Data source reliability (FRED, BGeometrics) | Service disruption | Multi-source fallback, caching, carry-forward logic (already implemented) |
| Competition from established analytics platforms | Market share | Focus on accumulation niche (not trading), simplicity, and the execution layer (Power Wallet) |
| Smart contract risk (Power Wallet) | Loss of user funds | Audits, battle-tested patterns, upgradeable architecture, testnet-first |

---

## Success Metrics

| Metric | 6-month Target | 12-month Target |
|--------|---------------|----------------|
| Pro subscribers | 500 | 2,000 |
| API paying customers | 35 | 75 |
| Monthly recurring revenue | $8,500 | $35,000 |
| Telegram community size | 2,000 | 10,000 |
| Power Wallet TVL | — | $500K |
| Weekly email list | 5,000 | 20,000 |
