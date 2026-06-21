# CoinStrat Quantile Model (CQM)

Reverse-engineered approximation of [BTCAnalytica](https://btcanalytica.com)'s **Empirical Quantile Model (EQM)**. Production code lives in:

- **TypeScript:** `web/src/utils/cqm.ts` (charts, bot, signal cache)
- **Python:** `EQM-model/eqm_model.py`, `EQM-model/run_eqm.py` (reference charts)

Defaults in both must stay in sync (`DEFAULT_CONFIG` ↔ `CQM_DEFAULTS`).

---

## What CQM outputs

For each day with a BTC price, the model produces:

| Output | Chart label | Role |
|--------|-------------|------|
| **Floor** | CQM 0.1% (solid green) | Deep-value envelope |
| **Fair price** | CQM 50% (solid gold) | Smoothed fair-value band for display |
| **Ceiling** | CQM 99.9% (solid red) | Blow-off / euphoria envelope |
| **QR 50% dashed** | Dotted gold line | **Fair value for risk** (not the solid gold SMA) |
| **Risk %** | CQM Risk | 0–100% valuation oscillator for DCA sizing |

```
  Price ($, log scale)
       │
  red  ┤························  99.9% ceiling (tail-scaled QR)
       │              ╱
  BTC  ┤────────────●───────────  spot price
       │           ╱
  gold ┤·········╱··············  50% fair (20w SMA of price⊕QR blend)
       │        ╱
       │       ╱  dotted QR 50%  ← risk fair value
  green┤·····╱··················  0.1% floor (tail-scaled QR)
       └──────────────────────────► time
```

---

## Pipeline overview

```
  Daily BTC prices (from 2014-01-01 for risk/bands; full history for QR parabola)
        │
        ▼
  ┌─────────────────────────────────────┐
  │ 1. Asymmetric QR fan (Cowen 2026)   │  log₁₀(price) = c + a·x + b·x²
  │    x = ln(days since 2009) − μ      │  separate b for lower / median / upper
  └─────────────────────────────────────┘
        │  raw QR 0.1%, 50%, 99.9% at each date
        ▼
  ┌─────────────────────────────────────┐
  │ 2. Tail scale (uniform, causal)     │  × tailScale(t) on all three quantiles
  │    auto-cal: re-centre on trailing  │  zeroes trailing-3y median residual,
  │    3y median, 4y ramp               │  ramped in over 4y (no look-ahead)
  └─────────────────────────────────────┘
        │
        ├──────────────────────┬────────────────────────┐
        ▼                      ▼                        ▼
   solid floor            QR 50% fair              solid ceiling
   (scaled 0.1%)         (for risk)               (scaled 99.9%)
        │                      │
        │                      ▼
        │              residual = ln(price) − ln(QR50%)
        │                      │
        │                      ▼
        │              empirical percentile → Risk %
        │
        ▼
   solid gold = 20-week SMA( geometric_mean(price, QR50%, w=0.5) )
```

In the current production model the **tail scale** adjusts the QR fan in the recent cycle, derived **causally** (auto-calibration — see Step 2).

---

## Step 1 — Asymmetric quantile regression (QR fan)

BTC daily closes are transformed to:

```
  xᵢ = ln(days since 2009-01-01) − μ        (μ = mean of x over sample)
  yᵢ = log₁₀(priceᵢ)
```

Three **quadratic quantile curves** are fit (Cowen 2026 asymmetric fan):

```
  log₁₀(price) = cτ + aτ·x + bτ·x²
```

| Quantile τ | Tail | Typical curvature b |
|------------|------|-------------------|
| 0.1% | Lower (floor) | small, near-linear |
| 50% | Median (fair) | ~flat |
| 99.9% | Upper (ceiling) | negative (compresses blow-off tops) |

The lower, median, and upper tails use **different** `bτ` values so blow-off phases flatten while bear-market floors stay steeper—closer to how BTC's upper tail has compressed across cycles.

At any calendar date `t`, evaluate the three parabolas → **raw** floor / median / ceiling prices.

**Example (illustrative shape, not exact fitted values):**

```
  log₁₀(price)
       │
       │     upper 99.9%  ╲
       │                    ╲___
       │         median 50%  ─────────
       │    lower 0.1%  ╱
       │               ╱
       └────────────────────────► x (log-days since 2009)
```

---

## Step 2 — Tail scale (causal auto-calibration)

Recent-cycle calibration applies a **single positive multiplier** `tailScale(t)` to **all three** QR quantiles equally:

```
  scaled_QRτ(t) = raw_QRτ(t) × tailScale(t)
```

**Production uses causal auto-calibration** (`qrAutoCalibrate = true`), not a hand-picked
anchor. Two windows, both anchored to the **evaluation date** `t` (so walk-forward / causal
fits never peek at the future):

- **How much** — `endScale(t)` re-centres the median so the **median log-residual over the
  trailing 3 years** (`qrAutoCalTrailingDays = 365×3`) is zero. Equivalently
  `endScale(t) = exp(−median_{τ ∈ [t−3y, t]} [ ln(price) − ln(raw_QR50%) ])`.
- **How gradually** — the scale ramps in over **4 years** (`qrAutoCalRampYears = 4`),
  blending from `1.0×` (4 years before `t`, raw regression untouched) to full
  `endScale(t)` at the latest date. Deep history keeps its original fit.

```
  tailScale(τ)            (for a fit evaluated at date t)
       1.0 ┤████████████████
           │               ╲
           │                 ╲
  endScale ┤···················●   (full strength at t)
           └────────────────────► time τ
                t − 4y            t
```

So at each evaluation date the QR 50% line is gently re-centred on the trailing-3-year price
action, and the 0.1% / 99.9% tails scale by the same factor (absolute dollar spread widens).

> **Legacy manual anchor (not used in production).** When `qrAutoCalibrate = false`, the model
> instead pins **raw QR 50%** on a fixed date to a fixed target via
> `endScale = qrCalibrationMedianUsd / raw_QR50%(qrCalibrationDate)` (e.g. `$100,800` on
> `2026-05-28`), ramping from `qrScaleRampStartDate` (`2022-01-01`). These three knobs are
> **ignored** whenever auto-calibration is on, which is the production default; they remain only
> for legacy/diagnostic fits.

---

## Step 3 — Solid chart bands

### Floor (green) — `solidLower`

```
  floor(t) = scaled_QR₀.₁%(t)
```

The 0.1% asymmetric quantile after tail scaling. Interpretation: “BTC has been cheaper vs fair only 0.1% of historical days at this residual level.”

### Ceiling (red) — `solidUpper`

```
  ceiling(t) = scaled_QR₉₉.₉%(t)
```

The 99.9% tail—blow-off / maximum-stretch envelope.

### Fair price (gold) — `solidMedian`

The **solid gold line on the chart is not raw QR 50%**. It is a **display smoother**:

```
  blend(t)   = exp( 0.5 · ln(priceₜ) + 0.5 · ln(QR50%(t)) )    ← geometric mean
  fair_gold(t) = SMA₂₀𝘸ₑₑₖₛ( blend )
```

So gold tracks a 20-week moving average of half price / half QR-50%, which hugs spot in bull runs while staying anchored to the structural fair-value curve.

```
  price ────╱╲────╱╲───  (volatile)
  QR50%  ───────────────  (smooth structural)
  gold   ───╱─────╱────   (SMA of geometric blend)
```

### Dotted QR lines

`qrDashedLow / Median / High` are the **same numbers** as the scaled QR fan—plotted dashed for comparison with solids.

---

## Step 4 — CQM Risk %

Risk answers: **“How expensive is today's BTC vs fair value, relative to all of BTC history?”**

### Fair value for risk

```
  fair(t) = QR 50% dashed(t)     (tail-scaled median; NOT solid gold SMA)
```

### Residual

```
  residual(t) = ln(priceₜ) − ln(fair(t))
```

Positive residual → price above fair; negative → below fair.

### Empirical percentile (the “empirical CDF”)

Sort **all** daily `residual(t)` values from 2014 onward (full sample). For today's residual `r`:

```
  pct(t) = (# historical residuals ≤ r) / N
```

`pct` ∈ [0, 1]. This is a **step function**: each time you cross another historical residual, `pct` jumps by ~1/N.

```
  pct
  1.0 ┤                              ████████
      │                         █████
      │                    █████
  0.5 ┤               █████
      │          █████
  0.0 ┤█████████
      └──────────────────────────────► residual
           low (cheap)        high (expensive)
```

### Soft risk mapping

Raw percentile is mapped to **Risk ∈ [0, 1]** with a single **static linear** line
between two knots in percentile space — no calendar dependence and no curvature:

```
  Risk(t) = clamp( (pct − pBuy) / (pSell − pBuy),  0, 1 )

  pBuy = 0.06     pSell = 0.72
```

- **pBuy = 6%** — at/below this percentile risk pins to 0 (maximum accumulate)
- **pSell = 72%** — at/above this percentile risk pins to 1 (maximum de-risk)
- linear in between; `pBuy = 0, pSell = 1` recovers the identity (raw percentile)

```
  Risk %
  100 ┤                         ●────────  (pct ≥ pSell)
      │                       ╱
   50 ┤                  ╱            ← straight line, no γ
      │             ╱
    0 ┤────────●
      └──────────────────────────────► pct (empirical percentile)
           6%              72%
```

> **History note.** Earlier versions used a *cycle-aware* mapping: the upper
> anchor and a curvature exponent γ were interpolated by calendar date
> (2014→0.999, 2018→0.990, 2022→0.950, today→0.68; γ 1.35→1.20→1.08→fitted),
> originally to reproduce BTCAnalytica's published curve. A walk-forward
> calibration study found γ was effectively inert forward (it resolved to 1.0 at
> the fit endpoint) and the cycle anchors only ever shaped *historical backtest*
> values, never the live/forward decision. They were removed in favour of the
> two static knots above. The reparameterization was behaviour-preserving at
> first — the old endpoint already evaluated to `clamp((pct − 0.06) / 0.62, 0, 1)`
> (i.e. `pSell = 0.68`).
>
> **Calibration note (2026-06-21).** `pBuy`/`pSell` are now the only risk-mapping
> dials. A walk-forward sweep plus forward scenario stress (compressed/base/larger
> next-cycle tops) showed the historical objective is ill-conditioned — the
> in-sample optimum flips between a passive "just hold" map (high `pSell`, best on
> the violent 2017 cycle) and an aggressive de-risking map (low `pSell`, best in
> compressed forward scenarios), and cross-cycle out-of-sample is unstable. Rather
> than point-fit, `pBuy` is left at `0.06` (low-impact) and `pSell` is treated as a
> policy dial for next-cycle amplitude. Tuned for a **compressed / diminishing-returns**
> prior (prioritise drawdown protection), `pSell` was set to **0.72** — slightly
> softer than the old `0.68` endpoint to reduce 2017-style premature-sell tail risk
> while keeping most of the drawdown protection (forward stress: ~30% max drawdown
> vs ~48% for a passive map, while still beating DCA in compressed/base tops).

**Production default:** `riskMode = 'global'` — full-sample percentile only. Legacy gated/rolling modes exist for diagnostics but are **not** used in charts or the DCA bot.

### Score (internal)

```
  score(t) = Risk(t)^1.5
```

Computed and cached but **not shown** on the charts page. Powers > 1 make peaks pointier.

---

## Risk as a function of price (snapshot curve)

At a fixed date, hold `fair` and the residual history fixed, sweep hypothetical prices `p`:

```
  Risk(p) = soft_map( empirical_pct( ln(p) − ln(fair) ) )
```

The chart plots this curve with a dot at `(price_today, Risk_today)`. The curve is **monotonic** but slightly **jagged** because the empirical CDF has discrete steps.

**Example knot prices on 2026-05-28** (production model, `qrAutoCalibrate` default, via `priceForRiskFair`):

| Risk | Implied price |
|------|---------------|
| 0% | ~$53K |
| 25% | ~$70K |
| 50% | ~$88K |
| 75% | ~$121K |
| 100% | ~$155K |

At spot ~$73.5K → **Risk ≈ 32%**. (QR 50% fair ≈ $110K under causal auto-calibration.)

---

## DCA bot formula

The bot and backtester share one sizing function (`web/src/utils/cqmSizing.ts`).
Given the period's base amount, the current Risk `r`, and the live cash / BTC
balances, it computes a buy or a sell:

```
# Buy zone  (r < 0.50)
taper    = (0.50 − r) / 0.50                 # 1 at r=0 → 0 at fair value
cashFrac = maxCashFraction × taper           # maxCashFraction = 6%
buy      = max( base × (1 − 2·r),  cashFrac × cash )
buy      = min( buy, cash )                  # never overspend

# Hold zone (0.50 ≤ r ≤ sellThreshold)        # sellThreshold = 0.75
→ do nothing

# Sell zone (r > sellThreshold)
sellScale = (r − sellThreshold) / (1 − sellThreshold)   # 0 at 0.75 → 1 at 1.0
size      = max( base, btcSellFraction × btc_value )    # btcSellFraction = 1%
sell      = min( size × sellScale, btc_value )
```

The key term over a plain linear rule is `cashFrac × cash`: at low risk it
deploys a fraction of the **accumulated idle cash**, not just a multiple of the
base — which fixes the "cash drag" where a purely linear rule leaves large
undeployed balances during deep-value windows. The linear `base × (1 − 2·r)`
term stays as a floor.

| Risk | Daily action (base = $100, before the cash-pile term) |
|------|-------------------------------------------------------|
| 0% | Buy ≥ $100 (2× base; more if idle cash is sizeable) |
| 25% | Buy ≥ $50 |
| 50% | $0 (flat) |
| 51–75% | $0 (hold / dead zone) |
| 75% | $0 (sell zone starts) |
| 100% | Sell `max(base, 1% × BTC value)` |

**Defaults** — `maxCashFraction = 6%`, `sellThreshold = 75%`,
`btcSellFraction = 1%` — were tuned on a walk-forward grid across five historical
windows (Jun 2026); both are adjustable in the Lab and the bot's Strategy Settings.

---

## Worked examples

### Example A — 2026-05-28 (recent snapshot, illustrative)

| Field | Value |
|-------|-------|
| BTC price | ~$73,500 |
| QR 50% fair (risk) | ~$110,300 (causal auto-calibration; the old manual anchor was $100,800) |
| Gold SMA (display) | ~$84,700 |
| **Risk** | **~32%** |
| DCA (base $100) | buy ≥ ~$37/day (linear floor; more if idle cash has built up) |

Price is **below** QR fair → negative residual → moderate risk, not euphoric.

### Example B — 2026-06-06 (recent drawdown)

| Field | Value |
|-------|-------|
| BTC price | ~$60,900 |
| QR 50% fair | ~$111,100 (causal auto-calibration) |
| **Risk** | **~11%** |
| DCA (base $100) | buy ≥ ~$79/day (linear floor; the 6%-of-cash term deploys more at this low risk) |

Cheaper vs fair → lower percentile → lower risk → **larger buys**.

### Example C — 2017-06 bull (historical, no boost model)

| Field | With tail-scaled QR only |
|-------|--------------------------|
| BTC price | ~$2,400 |
| QR 50% fair | ~$1,900 |
| **Risk** | **~51%** |

Price well above fair → mid-high risk → reduced accumulation.

### Example D — Why floor ≠ “cycle low price”

On **2015-01-15** (~$210 BTC):

- Floor (0.1% QR) might read ~$280–600 depending on era  
- **Risk ~16%** — cheap vs fair, but not 0% because the **full residual history** still contains deeper relative values from other eras  

Risk is **global ranking**, not “distance to floor line.”

---

## Default parameters (production)

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `startDate` | 2014-01-01 | Earliest BTC day in risk/band sample |
| `qrAutoCalibrate` | `true` | Causal tail calibration (manual anchors below ignored) |
| `qrAutoCalTrailingDays` | 1095 (3y) | Window whose median residual is zeroed |
| `qrAutoCalRampYears` | 4 | Years over which the tail scale ramps in |
| `qrScaleRampStartDate` | 2022-01-01 | *(legacy, manual mode only)* tail ramp begins |
| `qrCalibrationDate` | 2026-05-28 | *(legacy, manual mode only)* tail ramp ends |
| `qrCalibrationMedianUsd` | 100,800 | *(legacy, manual mode only)* QR 50% target |
| `fairBlendPriceWeight` | 0.5 | Gold SMA: 50% price / 50% QR |
| `fairGoldSmaWeeks` | 20 | Gold SMA window |
| `pBuy` | 0.06 | Risk floor percentile knot (risk pins to 0 at/below) |
| `pSell` | 0.72 | Risk ceiling percentile knot (risk pins to 1 at/above; tuned 2026-06 for a compressed-cycle / drawdown-protection prior) |
| `scorePower` | 1.5 | Score = risk^1.5 |
| `riskMode` | `global` | Full-sample empirical risk |
| `maxCashFraction` | 0.06 | Sizing: max % of idle cash deployed/period at risk 0 |
| `sellThreshold` | 0.75 | Sizing: risk above which the bot sells (dead zone 0.50–0.75) |
| `btcSellFraction` | 0.01 | Sizing: sell size = max(base, 1% × BTC value) scaled by risk |

---

## Regenerating reference charts (Python)

```bash
python EQM-model/run_eqm.py \
  --start-history 2014-01-01 \
  --fetch-binance-tail \
  --snapshot-date 2026-05-28
```

Output: `EQM-model/output/eqm_replica.png` (five panels: bands, gold, risk, risk-vs-price).

---

## Mental model (one paragraph)

CQM fits a **long-run BTC valuation fan** (asymmetric quantiles in log-price vs log-time), **causally re-centres** it in the recent cycle (zeroing the trailing-3-year median residual, ramped in over 4 years), and reads off **floor / fair / ceiling** from the 0.1% / blended-SMA / 99.9% lines. **Risk** is not “distance to a line”—it is your **percentile rank** in the history of `(price ÷ fair)` residuals, passed through a **static linear map** between two percentile knots (`pBuy` → 0% risk, `pSell` → 100% risk). Cheap vs fair → low risk → buy more; expensive vs fair → high risk → trim or sell.
