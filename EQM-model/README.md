# Bitcoin EQM Reverse-Engineering Prototype

This folder contains a reproducible prototype for reverse engineering
BTCAnalytica's Bitcoin Empirical Quantile Model (EQM) from the published chart.

It is not an official implementation. The goal is to create a close, testable
replica from the observable mechanics:

- price-only input
- square-root time Bitcoin trend
- empirical quantile bands around that trend
- true quantile-regression bands for the dashed QR lines
- bounded EQM score in `[0, 1]`
- bounded EQM risk in `[0, 1]`
- risk-weighted DCA rule: `daily_usd = base * (1 - 2 * risk)`

## Model Hypothesis

The prototype uses:

```text
log(price) = intercept + slope * days_since_start ** time_power + residual
```

Then:

```text
EQM risk  = soft_map(empirical percentile of residual; cycle-aware γ)
EQM score = risk ** score_power
```

Gated risk (default, mirrors `web/src/utils/cqm.ts`):

```text
global_risk  = soft_map(percentile(residual, full sample))
rolling_risk = soft_map(percentile(residual, last 730 days))
weight       = 0 when price ≥ 1.15 × trailing 120d low; ramps to 1 at the low
risk         = global − weight × (global − min(global, rolling))
```

The defaults are calibrated against the May 22, 2026 screenshot:

| Parameter | Default | Source |
| --- | --- | --- |
| `time_power` | `0.60` | `CQM_DEFAULTS` / `web/src/utils/cqm.ts` |
| `low_quantile` | `0.06` | same |
| `high_quantile` | `0.68` | same |
| `score_power` | `1.5` | same (`score = risk^1.5`) |
| `risk_roll_days` | `730` | gated 2y rolling window |
| `risk_gate_near_days` | `120` | near-low lookback |
| `risk_gate_near_buffer` | `1.15` | smooth gate ramp |

These reproduce the visible screenshot anchors:

```text
0% risk  ~= $49K   (reference $45K)
50% risk ~= $96K   (reference $101K)
100% risk ~= $156K (reference $160K)
EQM risk  = 28.6%  (reference 28.5%)
EQM score = 0.143  (reference 0.145)
```

Override any of these with `--time-power`, `--low-quantile`, `--high-quantile`,
`--score-power`, or the `--risk-*` gate flags. Python defaults live in
`eqm_model.CQM_DEFAULTS` and must stay in sync with `web/src/utils/cqm.ts`.
To re-run grid search against alternate risk-price knots, see the calibration
section below.

## Price Band Hypothesis

The first BTCAnalytica panel plots two related but distinct band families. We
reverse engineered them by anchoring on the May 22, 2026 snapshot values
visible in the screenshot.

### Solid red/gold/green EQM lines

Looking at the snapshot:

| Reference | Solid (EQM) | Dashed (QR) |
| --- | --- | --- |
| `0.1%` line | `$45.4K` | `$50.0K` |
| `50%` line | `$109.6K` | `$109.4K` |
| `99.9%` line | `$159.9K` | `$269.4K` |

The `50%` lines coincide. The lower lines are close. The upper solid line is
much tighter than the QR `99.9%` extrapolation. This rules out "solid = QR at
each quantile". The asymmetry is the key clue: the lower band looks like a
fixed log-distance below the QR median, while the upper band tracks something
much more "recent-cycle-aware" than a long-history quantile.

The replicated mechanism — both gold and green are *shelved* (running-max)
and then clipped from above by a multiple of the recent rolling-min price.
The clip pulls each band down during deep bear bottoms so the chart stays
visually faithful to BTCAnalytica:

```text
QR_median(t)     = QuantReg(log(price) ~ days_since_start**time_power, q=0.5)
r(s)             = price(s) / rolling_ATH(s)       for s ≤ t

# GOLD: shelved rolling-window median, then clipped at K_gold × rolling-min(price)
gold_raw(t)      = ATH(t) * Q_0.5( r over last gold_window days )
gold_shelved(t)  = running_max( gold_raw[0..t] )
gold_ceiling(t)  = rolling_min(price, gold_floor_window) * gold_floor_buffer
solid_50%(t)     = min( gold_shelved(t), gold_ceiling(t) )

# GREEN: shelved time-decayed weighted quantile, clipped at K_green × rolling-min
weight(s,t)      = exp(- ln(2)/half_life_years * (t - s) / 365.25)
green_raw(t)     = ATH(t) * weighted_Q_q( r, weight(s,t) )
green_shelved(t) = running_max( green_raw[0..t] )
green_floor(t)   = rolling_min(price, green_floor_window) * green_floor_buffer
solid_0.1%(t)    = min( green_shelved(t), green_floor(t) )

# RED: rolling all-time-high × constant factor, floored by gold
solid_99.9%(t)   = max( rolling_ATH(t) * upper_ath_factor, solid_50%(t) )
```

What this means in plain English:

- **Gold (50% / fair value)**: a rolling-2-year median of the `price/ATH`
  ratio, multiplied by the current ATH and shelved (running-max), then
  clipped from above by `2.0 × rolling-min(price, 30 days)`. The shelved
  component captures the cycle-stepping shape; the price-relative ceiling
  pulls gold down during deep bear bottoms (2015, 2018, 2022) so it stays
  *approximately between red and green* on the chart instead of
  plateauing at the previous-cycle's bull-peak level. The ceiling does
  NOT bind during bull markets / corrections from peak so the snapshot
  match is preserved.
- **Green (0.1% / deep value floor)**: a time-decayed weighted Q0.05 of
  `price/ATH` (default 1-year half-life), multiplied by the current ATH and
  shelved (running-max), then clipped from above by `0.95 × rolling-min(price,
  30 days)` so the band is *always* below BTC at every cycle bottom (2015,
  2018, 2020 covid, 2022). The exponential decay weighting captures the fact
  that BTC's drawdowns have grown shallower over time so the implied
  `green/ATH` multiplier drifts upward (~0.27 in 2018 → ~0.37 in 2026); the
  price-floor constraint then ensures the line visually acts as a true deep
  value floor instead of intercepting the actual cycle lows. Crucially, at
  higher prices the floor doesn't bind so the snapshot match is preserved.
- **Red (99.9% / top)**: rolling all-time-high price multiplied by a fixed
  factor (`1.28x` by default), floored at the gold band. Reproduces the
  "step up at each cycle top, plateau, repeat" shape visible in the
  reference, and explains why the upper solid line is much tighter than the
  QR `99.9%` extrapolation.

Using these defaults the replica reproduces the May 22, 2026 BTCAnalytica
snapshot to within a few percent on every solid band:

```text
EQM 0.1% solid:   replica $47.8K   reference $45.4K   +5.2%
EQM 50% solid:    replica $111.9K  reference $109.6K  +2.1%
EQM 99.9% solid:  replica $159.6K  reference $159.9K  −0.2%
```

Verified historical band positions (gold sits between red and green;
green sits below BTC at every cycle bottom):

```text
date        BTC      green   gold    red     gold-pos*  verdict
2015-01-15  $   210  $  169  $  356  $1,220  0.18       gold near green, green below price
2017-12-17  $19,141  $4,915  $15,201 $24,957 0.51       gold mid-band, end-of-bull-market
2018-12-15  $ 3,237  $3,075  $ 6,474 $24,957 0.16       gold pulled near green, green below
2021-11-10  $64,995  $18,687 $39,707 $86,486 0.31       gold lower-mid, end-of-bull-market
2022-11-21  $15,787  $14,998 $31,575 $86,486 0.23       gold pulled near green, green below
2026-05-22  $75,467  $47,777 $111,867 $159,563 0.57     snapshot — all bands match chart

* gold-pos = (gold − green) / (red − green); 0 = at green, 1 = at red.
```

The defaults (`--solid-gold-window 730`, `--solid-gold-floor-window 30`,
`--solid-gold-floor-buffer 2.0`, `--solid-green-half-life 1.0`,
`--solid-green-quantile 0.05`, `--solid-green-floor-window 30`,
`--solid-green-floor-buffer 0.95`) were chosen by sweeping each parameter
against the May 22, 2026 BTCAnalytica snapshot and picking the closest fit
that also produced a sensible chart-shape. The gold uses uniform weighting
(not time-decay) because Q0.5 of `price/ATH` is naturally close to 1 during
bull peaks and the running-max already captures the cycle structure; only
the low quantile (green) needs the non-stationary decay treatment.

### Dashed QR lines

True separate quantile regressions, one fit per quantile, on the same
`time^p` design:

```text
QuantReg(log(price) ~ days_since_start**time_power) for q in {0.001, 0.5, 0.999}
```

The default dashed QR quantiles are `0.1%`, `50%`, and `99.9%`, matching the
labels visible in the screenshot legend. Because each quantile has its own
slope, the upper QR line extrapolates aggressively over time (slope at
`q=0.999` is steeper than at `q=0.5`), which is why the dashed `99.9%` line
sits at `$269K` while the solid `99.9%` is at `$160K`.

### Toggling the model used for the solid lines

Solid bands use the QR-median model by default. Pass `--no-solid-bands` to
fall back to the older "invert the EQM Risk envelope at risks `0%`, `50%`,
`100%`" rendering for comparison.

## Setup

From the repository root:

```bash
python3 -m venv .venv-eqm
source .venv-eqm/bin/activate
pip install -r EQM-model/requirements.txt
```

## Run The Chart Replica

The default command uses the bundled local BTC daily data at
`web/public/data/btc_daily.json`:

```bash
python3 EQM-model/run_eqm.py
```

It prints a current EQM snapshot and saves:

```text
EQM-model/output/eqm_replica.png
```

Use a specific date:

```bash
python3 EQM-model/run_eqm.py --snapshot-date 2025-10-19
```

Replicate the visible May 22, 2026 screenshot date if the local data includes
that date:

```bash
python3 EQM-model/run_eqm.py --start-history 2014-01-01 --snapshot-date 2026-05-22
```

Customize the plotted solid and dashed bands:

```bash
python3 EQM-model/run_eqm.py \
  --snapshot-date 2026-05-22 \
  --price-band-risks 0,0.5,1 \
  --qr-quantiles 0.001,0.5,0.999
```

Use a CSV:

```bash
python3 EQM-model/run_eqm.py \
  --csv path/to/btc_daily.csv \
  --date-col date \
  --price-col close
```

Fetch fresh BTCUSD daily data from Stooq:

```bash
python3 EQM-model/run_eqm.py --fetch-stooq
```

## Compare The Replica To The Reference

Once a replica is generated, run the comparison tool to produce a side-by-side
image and a numerical diff against BTCAnalytica's May 22, 2026 chart values:

```bash
python3 EQM-model/compare_to_reference.py
```

Outputs:

```text
EQM-model/output/eqm_compare_side_by_side.png
EQM-model/output/eqm_compare_diff.csv
```

## Calibrate Anchors

`calibrate.py` runs a grid search over `time_power`, `low_quantile`, and
`high_quantile`. It reports the candidate that minimises the combined error of
the visible price-risk knots and the headline EQM risk:

```bash
python3 EQM-model/calibrate.py --top-n 10
```

The score now has independent anchors, so use the printed risk-band parameters
with the default pointy score settings, or pass score settings directly to
`run_eqm.py`:

```bash
python3 EQM-model/run_eqm.py \
  --time-power 0.60 \
  --low-quantile 0.06 \
  --high-quantile 0.68 \
  --score-lower-quantile 0.06 \
  --score-upper-quantile 0.995 \
  --score-power 1.0
```

The best parameters are also saved to `EQM-model/output/eqm_calibration.json`.

## Project The Model Forward In Time

The OLS trend, the QR median, both solid bands and all dashed QR bands are
explicit functions of date. They extrapolate naturally because the only
time-varying input is `days_since_start ** time_power`; the historical
residual distribution and the calibration anchors stay frozen.

Default projection (year-end 2026 through 2029):

```bash
python3 EQM-model/project_eqm.py
```

This prints a table of model anchors at each target date and saves a fan
chart at `EQM-model/output/eqm_projection.png`.

Scenario analysis. Because the solid `99.9%` band is anchored to the rolling
all-time-high, the baseline projection assumes no new ATH is printed (the
band stays at `current_ATH * upper_ath_factor` until the QR median catches
up to it). Override that with a hypothetical future ATH:

```bash
python3 EQM-model/project_eqm.py --assume-future-ath 250000 \
  --plot EQM-model/output/eqm_projection_bull_250k.png
```

Caveats:

- This is extrapolation under "history rhymes" assumptions, not a forecast.
- The baseline projection is silent about cycle timing — it does not know
  that 2024 was a halving year, that bear markets historically follow tops,
  or that volatility tends to compress over time. It only tells you what
  range the model considers normal at each future date.
- `time_power=0.60` makes both the OLS trend and the QR median project
  somewhat aggressively. Lowering to `0.5` produces flatter long-run growth;
  the ranges below are sensitive to that choice.

## Run The DCA Backtest

Full-sample signals are useful for matching the published chart, but they are
lookahead-biased. For a more honest backtest, use expanding-history signals:

```bash
python3 EQM-model/run_eqm.py \
  --signals-mode expanding \
  --backtest \
  --backtest-start 2021-11-10 \
  --backtest-end 2025-10-19 \
  --base-amount 500
```

This saves:

```text
EQM-model/output/eqm_dca_backtest.csv
```

## Current Limitations

- The public chart may use a different BTC price vendor, start date, or close
  convention.
- The dashed QR bands now use true quantile regression, but exact matching still
  depends on BTCAnalytica's price vendor, start date, close convention, and time
  transform.
- The trend-risk composite panel is a visual proxy, not a confirmed formula.
- Exact BTCAnalytica results require calibrating against more published EQM
  snapshots.

## Next Calibration Steps

1. Add more BTCAnalytica screenshots with visible price, score, risk, and band
   values, then extend `calibrate.py` to take a list of reference snapshots
   instead of a single one.
2. Fit the QR start date and time transform against the visible dashed QR table
   from the published chart legend.
3. Replace the `90d trend-risk proxy` with a calibrated formula once a few more
   reference values for `EQM Trend-Risk` are visible across history.
4. Compare full-sample versus expanding-history DCA results to quantify
   lookahead bias.
