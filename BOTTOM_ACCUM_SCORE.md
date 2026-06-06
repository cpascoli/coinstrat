# Bottom Accumulation Score

## Purpose

`BOTTOM_ACCUM_SCORE` is a 0-100 staged-deployment gauge for Bitcoin accumulation.

It answers a different question from `CORE_ON`:

- `CORE_ON` is the simple risk-on / risk-off regime signal.
- `BOTTOM_ACCUM_SCORE` estimates how attractive the current zone is for deploying sidelined capital over the next weeks or months.

The score should not override `CORE_ON`. It is a sizing and context layer for investors who want to stage capital into weakness instead of relying only on a binary signal.

## Model Design

The score is built from four 0-20 components and two 0-10 price components.

```text
BOTTOM_ACCUM_SCORE =
  ONCHAIN_VALUE_SCORE
+ CAPITULATION_SCORE
+ LIQUIDITY_TURN_SCORE
+ MACRO_RISK_SCORE
+ BOTTOM_PRICE_SETUP_SCORE    (0-10)
+ BOTTOM_PRICE_REPAIR_SCORE   (0-10)
```

### 1. On-Chain Value

Purpose: determine whether Bitcoin is cheap relative to holder cost bases and long-term valuation.

Current inputs:

- `VAL_SCORE`
- `MVRV`
- `NUPL`
- `STH_REALIZED_PRICE`
- `LTH_REALIZED_PRICE`
- `LTH_SOPR`

Current scoring intent:

- Reward deep value from `VAL_SCORE`.
- Add points when BTC trades below or near short-term holder realized price.
- Add points when BTC trades below or near long-term holder realized price.

Interpretation:

- High score means BTC is near historically attractive on-chain valuation zones.
- Low score means BTC is not cheap enough to justify aggressive bottom deployment.

### 2. Capitulation / Stress

Purpose: detect whether enough forced selling or holder stress has occurred.

Current inputs:

- `LTH_SOPR`
- `SIP` / Supply in Profit
- `BTC_DRAWDOWN_FROM_365D_HIGH`
- `BTC_FUNDING_7D_AVG`
- `BTC_OI_DRAWDOWN_90D`

Current scoring intent:

- Reward long-term holder SOPR below or near 1.
- Reward low Supply in Profit.
- Reward large drawdowns from the 365-day high.
- Reward neutral or negative funding after drawdowns.
- Reward open-interest flushes from the 90-day high.

Future inputs:

- Realized loss / net realized profit-loss.
- Liquidation spikes.
- Aggregate multi-exchange funding rates.
- Aggregate multi-exchange open interest flushes.

Implementation note:

- Binance open-interest history from the public endpoint is short, so the app caches `BTC_OPEN_INTEREST_USD` in a Netlify Blob store via a daily scheduled function. The cached series is merged with the latest Binance response and will become more useful historically over time.

Interpretation:

- High score means the market has already absorbed meaningful pain.
- Low score means downside stress may not yet be fully washed out.

### 3. Liquidity Turn

Purpose: detect whether liquidity conditions are stabilizing or improving.

Current inputs:

- `LIQ_SCORE`
- `US_LIQ_13W_DELTA`
- `G3_YOY`
- `DXY_SCORE`

Current scoring intent:

- Reward positive U.S. liquidity impulse.
- Reward positive 13-week U.S. liquidity change.
- Reward stabilizing or expanding G3 liquidity.
- Reward neutral or weakening dollar conditions.

Future inputs:

- Global M2.
- Stablecoin supply growth.
- Real yields.
- Cross-border liquidity indicators.

Interpretation:

- High score means the liquidity backdrop is becoming supportive.
- Low score means macro liquidity is still a headwind.

### 4. Macro Support

Purpose: avoid deploying too aggressively into an unresolved macro shock.

Current inputs:

- `BIZ_CYCLE_SCORE`
- `SAHM`
- `YC_M`
- `ISM_PMI`

Current scoring intent:

- Reward a non-recessionary business cycle.
- Reward Sahm Rule below the recession trigger.
- Reward a non-inverted or improving yield curve.
- Reward ISM PMI stabilization or expansion.

Future inputs:

- Credit spreads.
- Oil / energy shock indicators.
- Real-yield stress.
- Equity-market breadth and concentration risk.

Interpretation:

- High score means macro conditions are not blocking deployment.
- Low score means recession, credit, or inflation-shock risk may still dominate.

### 5. Price Setup / Damage

Purpose: detect whether the price chart itself is damaged enough to support a bottom thesis.

Current inputs:

- BTC drawdown from the 365-day high.
- BTC vs 40-week moving average.
- BTC vs short-term holder realized price.
- 30-day and 90-day BTC momentum.

Current scoring intent:

- Reward large drawdowns.
- Reward BTC trading materially below the 40-week moving average.
- Reward BTC trading materially below short-term holder realized price.
- Add a small point when both 30-day and 90-day momentum are negative.

Interpretation:

- High score means price damage is visible, not just on-chain cheapness.
- Low score means price has not been impaired enough to count as a strong bottom setup.

### 6. Price Repair / Confirmation

Purpose: avoid treating every falling knife as a bottom by checking whether price has started to repair.

Current inputs:

- BTC vs 40-week moving average.
- BTC vs short-term holder realized price.
- 30-day BTC momentum.
- 90-day BTC momentum.
- Local-low stabilization.

Current scoring intent:

- Reward proximity to or reclaim of the 40-week moving average.
- Reward reclaim of short-term holder realized price.
- Reward positive 30-day and 90-day momentum.
- Reward base stabilization when recent lows stop breaking or price holds above the 60-day low for at least 30 days.

Compatibility note:

- `BOTTOM_PRICE_SETUP_SCORE` is 0-10 points for price damage / bottom setup.
- `BOTTOM_PRICE_REPAIR_SCORE` is 0-10 points for price repair / confirmation.
- `BOTTOM_STRUCTURE_SCORE` remains available as a backward-compatible API field equal to setup + repair, but the UI generally shows setup and repair separately.

Important design note:

`PRICE_REGIME_ON` is intentionally not used inside these price components. It already drives `CORE_ON`, and reusing it would double-count the 40-week trend regime. The Bottom Score should notice both early price damage and early stabilization before the full `PRICE_REGIME_ON` persistence filter confirms.

## Score Bands

| Score | Label | Interpretation |
|---:|---|---|
| 0-24 | Avoid | Not enough bottom evidence yet. |
| 25-49 | Watch | Conditions are improving, but incomplete. |
| 50-69 | Accumulate Slowly | Begin staged deployment if it fits the risk plan. |
| 70-84 | Strong Accumulation | Multiple bottom conditions are aligned. |
| 85-100 | Capitulation Opportunity | High-conviction bottom zone. |

## Deployment Guide

The model exposes a broad suggested deployment range:

| Score | Deployment Range |
|---:|---:|
| 0-24 | 0% |
| 25-49 | 0-10% |
| 50-69 | 25-40% |
| 70-84 | 50-75% |
| 85-100 | 75-100% |

These ranges are deliberately conservative. They are intended for staged deployment, not all-or-nothing trading.

Example for a $500k allocation:

- `Watch`: deploy little or none; prepare orders and monitor confirmation.
- `Accumulate Slowly`: start with a partial tranche.
- `Strong Accumulation`: deploy a larger tranche.
- `Capitulation Opportunity`: deploy most remaining capital if portfolio risk allows.

## UI Exposure

### Dashboard

Expose:

- Current `BOTTOM_ACCUM_SCORE`.
- Score band.
- Suggested deployment range.
- Six sub-score cards:
  - On-chain value
  - Capitulation
  - Liquidity turn
  - Macro support
  - Price setup / damage
  - Price repair / confirmation

### Charts

Expose a historical chart with:

- `BOTTOM_ACCUM_SCORE`
- BTC price overlay
- Shaded score bands
- Component lines for sub-scores
- Price setup / repair lines inside the bottom chart

Primary use:

- Inspect whether the score lights up around prior cycle bottoms.
- Compare current conditions to prior bottom zones.

### Docs

Document:

- Score purpose.
- Component logic.
- Score bands.
- Deployment ranges.
- Difference between `CORE_ON` and `BOTTOM_ACCUM_SCORE`.

## Backtest Plan

Add a staged-deployment backtest strategy after the score has been visually inspected.

Compare:

- Baseline DCA.
- `CORE` DCA.
- `CORE` sell-all / risk-off mode.
- Bottom Score staged deployment.

Example staged deployment logic:

```text
If score < 50: deploy 0-10% of planned capital.
If score 50-69: deploy 25-40%.
If score 70-84: deploy 50-75%.
If score >= 85: deploy 75-100%.
```

The backtest should measure:

- Final portfolio value.
- BTC accumulated.
- Maximum drawdown.
- Cash drag.
- Missed upside after early bottom signals.
- Sensitivity to score thresholds.

## Derivatives And Future Data Feeds

### Funding Rates

MVP source:

- Binance Futures API.

Future source:

- CoinGlass, Velo, Amberdata, Kaiko, or another licensed derivatives aggregator.

Use in model:

- Negative or neutral funding after a drawdown is bottom-like.
- Very positive funding is a crowded-long warning.

### Open Interest Flushes

MVP source:

- Binance Futures open interest history.

Future source:

- CoinGlass aggregate exchange open interest.

Use in model:

- Large open interest drawdown from 30D / 90D highs indicates leverage has been flushed.
- OI flush plus neutral or negative funding is stronger than either signal alone.

### ETF Flows

Potential sources:

- CoinGlass Bitcoin ETF data/API.
- The Block or other professional ETF datasets.
- Static/manual CSV for MVP research.

Use in model:

- Sustained ETF outflows indicate pressure.
- Outflows decelerating can indicate stabilization.
- Net positive 5D / 20D flows after a drawdown can confirm institutional demand returning.

## Current Implementation Notes

The first version started with existing CoinStrat data only. The current MVP also includes Binance BTCUSDT perpetual funding and open-interest data as optional derivatives inputs. These feeds are useful for recent market-structure context, but Binance open-interest history may be limited by exchange retention policy unless cached continuously.

Implemented fields include:

- `BOTTOM_ACCUM_SCORE`
- `BOTTOM_ACCUM_BAND`
- `BOTTOM_DEPLOYMENT_RANGE`
- `BOTTOM_ONCHAIN_SCORE`
- `BOTTOM_CAPITULATION_SCORE`
- `BOTTOM_LIQUIDITY_SCORE`
- `BOTTOM_MACRO_SCORE`
- `BOTTOM_PRICE_SETUP_SCORE`
- `BOTTOM_PRICE_REPAIR_SCORE`
- `BOTTOM_STRUCTURE_SCORE` (compatibility field: setup + repair)
- `BTC_FUNDING_RATE`
- `BTC_FUNDING_7D_AVG`
- `BTC_OPEN_INTEREST_USD`
- `BTC_OI_DRAWDOWN_90D`

The next iteration should focus on historical validation, staged-deployment backtesting, and deciding whether to upgrade derivatives data to a licensed multi-exchange aggregate source.
