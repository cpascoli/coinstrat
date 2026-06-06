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
  │ 2. Tail scale (uniform)             │  × tailScale(t) on all three quantiles
  │    ramp 2022 → 2026-05-28           │  pins QR 50% ≈ $100.8K at calibration
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

In the current production model the **tail scale** adjusts the QR fan in the recent cycle.

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

## Step 2 — Tail scale

Recent-cycle calibration applies a **single positive multiplier** `tailScale(t)` to **all three** QR quantiles equally:

```
  scaled_QRτ(t) = raw_QRτ(t) × tailScale(t)
```

**Tail ramp** (defaults):

| Date | `tailScale` |
|------|-------------|
| before 2022-01-01 | `1.0` |
| 2022-01-01 → 2026-05-28 | linear ramp in time (power = 1) |
| from 2026-05-28 onward | `endScale` |

`endScale` is chosen so that **raw QR 50%** on the calibration date matches the target:

```
  endScale = $100,800 / raw_QR50%(2026-05-28)
```

```
  tailScale(t)
       1.0 ┤████████████████
           │               ╱
           │             ╱
  endScale ┤···········●······  (~0.84 on 2026-05-28)
           └────────────────────► time
                2022          2026-05-28
```

After scaling, on **2026-05-28**:

- **QR 50% (dashed)** ≈ **$100,800** — risk fair value  
- **QR 0.1%** and **99.9%** are scaled by the same factor (absolute spread widens in dollars)

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

Raw percentile is mapped to **Risk ∈ [0, 1]** with cycle-aware anchors:

```
  riskHighQ(t) = interpolated knot: 2014→0.999, 2018→0.990, 2022→0.950, today→0.68
  γ(t)         = interpolated knot: 2014→1.35, 2018→1.20, 2022→1.08, today→fitted

  z = clamp( (pct − lowQ) / (riskHighQ(t) − lowQ),  0, 1 )     lowQ = 0.06
  Risk(t) = z^γ(t)
```

- **lowQ = 6%** — bottom of the risk scale (max accumulation zone)  
- **highQ = 68%** — today's upper percentile anchor (not everything clips at 100%)  
- **γ > 1** — compresses mid-range, sharpens euphoric peaks (older cycles use higher γ)

```
  Risk %
  100 ┤                              ●  (z→1, pct at blow-off)
      │                            ╱
   50 ┤                      ╱
      │                 ╱           ← γ power bends the middle
    0 ┤────────●────────
      └──────────────────────────────► pct (empirical percentile)
           6%              68%+
```

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

**Example knot prices on 2026-05-28** (from `run_eqm.py`):

| Risk | Implied price |
|------|---------------|
| 0% | ~$54K |
| 25% | ~$69K |
| 50% | ~$84K |
| 75% | ~$112K |
| 100% | ~$146K |

At spot ~$73.6K → **Risk ≈ 34%**.

---

## DCA bot formula

The CQM bot sizes daily trades from Risk:

```
  daily_usd = base × (1 − 2 × Risk)
```

| Risk | Daily action (base = $100) |
|------|----------------------------|
| 0% | Buy $100 (2× base) |
| 25% | Buy $50 |
| 50% | $0 (flat) |
| 75% | Sell $50 |
| 100% | Sell $100 |

---

## Worked examples

### Example A — 2026-05-28 (calibration snapshot)

| Field | Value |
|-------|-------|
| BTC price | ~$73,600 |
| QR 50% fair (risk) | ~$100,800 |
| Gold SMA (display) | ~$84,700 |
| **Risk** | **~34%** |
| DCA (base $100) | buy ~$32/day |

Price is **below** QR fair → negative residual → moderate risk, not euphoric.

### Example B — 2026-06-06 (recent drawdown)

| Field | Value |
|-------|-------|
| BTC price | ~$60,600 |
| QR 50% fair | ~$101,600 |
| **Risk** | **~8–12%** (closer to BTCAnalytica ~9.5%) |
| DCA (base $100) | buy ~$84/day |

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
| `qrScaleRampStartDate` | 2022-01-01 | Tail ramp begins |
| `qrCalibrationDate` | 2026-05-28 | Tail ramp ends |
| `qrCalibrationMedianUsd` | 100,800 | QR 50% target at calibration |
| `fairBlendPriceWeight` | 0.5 | Gold SMA: 50% price / 50% QR |
| `fairGoldSmaWeeks` | 20 | Gold SMA window |
| `lowQ` | 0.06 | Risk floor percentile anchor |
| `highQ` | 0.68 | Risk ceiling percentile anchor (today) |
| `scorePower` | 1.5 | Score = risk^1.5 |
| `riskMode` | `global` | Full-sample empirical risk |

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

CQM fits a **long-run BTC valuation fan** (asymmetric quantiles in log-price vs log-time), **scales** it in the recent cycle so QR 50% matches a calibration target, and reads off **floor / fair / ceiling** from the 0.1% / blended-SMA / 99.9% lines. **Risk** is not “distance to a line”—it is your **percentile rank** in the history of `(price ÷ fair)` residuals, passed through a **soft power map** that remembers how extreme each cycle could get. Cheap vs fair → low risk → buy more; expensive vs fair → high risk → trim or sell.
