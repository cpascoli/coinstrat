# CoinStrat API Skill

Use this skill when you need CoinStrat's Bitcoin accumulation model state from the CoinStrat API.

## Authentication

- Base URL: `https://coinstrat.xyz`
- Header for paid endpoints: `X-API-Key: <COINSTRAT_API_KEY>`

## Available endpoints

### Latest public snapshot

`GET /api/v1/signals/current`

Use this when you need the latest published signal state without authentication.

Key fields:
- `Date`
- `BTCUSD`
- `CORE_ON`
- `MACRO_ON`
- `PRICE_REGIME_ON`
- `VAL_SCORE`
- `LIQ_SCORE`
- `DXY_SCORE`
- `CYCLE_SCORE`

### Paid history endpoint

`GET /api/v1/signals/history`

Optional query params:
- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`

This returns the full daily signal history and is the preferred endpoint for comparisons and trend analysis.

## Recommended workflows

### 1. Summarize current model state

1. Call `GET /api/v1/signals/current`
2. Explain the current values for:
   - Core Accumulation
   - Macro Accelerator
   - Price Regime
   - Valuation Score
   - Liquidity Score
   - Dollar Regime Score
   - Business Cycle Score
3. Keep the explanation plain English and action-oriented.

### 2. Compare the latest state to the prior week

1. Call `GET /api/v1/signals/history?from=<14_days_ago>`
2. Use the latest row and the row from 7 days earlier
3. Highlight changes in:
   - `CORE_ON`
   - `MACRO_ON`
   - `PRICE_REGIME_ON`
   - `VAL_SCORE`
   - `LIQ_SCORE`
   - `DXY_SCORE`
   - `CYCLE_SCORE`

### 3. Detect recent signal changes

1. Call `GET /api/v1/signals/history?from=<30_days_ago>`
2. Compare adjacent daily rows
3. Report any changes to tracked signals and scores
4. Include the date and the previous/new value

## Guardrails

- Do not invent values if the API omits a field.
- Prefer dates exactly as returned by the API.
- When discussing the model, use user-friendly names:
  - `CORE_ON` -> `Core Accumulation`
  - `MACRO_ON` -> `Macro Accelerator`
  - `PRICE_REGIME_ON` -> `Price Regime`
  - `VAL_SCORE` -> `Valuation Score`
  - `LIQ_SCORE` -> `Liquidity Score`
  - `DXY_SCORE` -> `Dollar Regime Score`
  - `CYCLE_SCORE` -> `Business Cycle Score`
- Treat `1` as `ON` and `0` as `OFF` for binary signals.

## Example curl commands

```bash
curl https://coinstrat.xyz/api/v1/signals/current
```

```bash
curl "https://coinstrat.xyz/api/v1/signals/history?from=2026-01-01" \
  -H "X-API-Key: $COINSTRAT_API_KEY"
```
