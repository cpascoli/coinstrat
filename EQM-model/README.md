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
EQM risk  = clip((empirical percentile of residual - low_q) / (high_q - low_q), 0, 1)
EQM score = clip((residual - residual_score_low) / (residual_score_high - residual_score_low), 0, 1) ** score_power
```

This two-layer design explains why the screenshot can show an `EQM score` near
`0.145` and an `EQM risk` near `28.5%` at the same time. The risk is the
historical percentile of the residual mapped through the calibration window;
the score uses a much wider upper-tail residual anchor so it behaves like a
pointier cycle oscillator instead of flattening at `1.0` through most of a bull
market.

The defaults are calibrated against the May 22, 2026 screenshot:

| Parameter | Default | Source |
| --- | --- | --- |
| `time_power` | `0.60` | grid search |
| `low_quantile` | `0.06` | grid search |
| `high_quantile` | `0.68` | grid search |
| `score_lower_quantile` | `0.06` | lower score anchor |
| `score_upper_quantile` | `0.995` | upper-tail score anchor |
| `score_power` | `1.0` | near-linear pointy score |

These reproduce the visible screenshot anchors:

```text
0% risk  ~= $49K   (reference $45K)
50% risk ~= $96K   (reference $101K)
100% risk ~= $156K (reference $160K)
EQM risk  = 28.6%  (reference 28.5%)
EQM score = 0.143  (reference 0.145)
```

Override any of these with `--time-power`, `--low-quantile`, `--high-quantile`,
`--score-lower-quantile`, `--score-upper-quantile`, or `--score-power`. To
re-run the grid search and find new defaults against a target snapshot, see the
calibration section below.

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

The replicated mechanism:

```text
QR_median(t)   = QuantReg(log(price) ~ days_since_start**time_power, q=0.5)
residual(i)    = log(price_i) - log(QR_median(date_i))

solid_50%(t)   = QR_median(t)
solid_0.1%(t)  = QR_median(t) * exp(empirical_quantile(0.001, residuals))
solid_99.9%(t) = max(rolling_ATH(t) * upper_ath_factor, QR_median(t))
```

What this means in plain English:

- **Gold (50% / fair value)**: the median quantile-regression trend on the
  square-root-of-time growth curve. Same line as the dashed QR `50%`.
- **Green (0.1% / bottom)**: a fixed multiple below that fair-value trend,
  calibrated to the worst residual ever observed (≈ `0.36 * QR_median`). Below
  this is "deeper than any historical drawdown vs the trend" territory.
- **Red (99.9% / top)**: NOT a residual quantile. It tracks the rolling
  all-time-high price multiplied by a fixed factor (`1.28x` by default). This
  reproduces the characteristic "step up at each cycle top, then plateau"
  shape visible in the reference, and explains why the upper solid line is
  much tighter than the QR `99.9%` extrapolation: BTC's cycle tops have grown
  more contained over time, and the upper band reflects recent realized
  highs rather than a slope estimated from 2013 spikes.

Using these defaults the replica reproduces:

```text
EQM 0.1% solid:   replica $45.7K  reference $45.4K   +0.6%
EQM 50% solid:    replica $125K   reference $109.6K  +14.3% (time_power dependent)
EQM 99.9% solid:  replica $159.6K reference $159.9K  -0.2%
```

The remaining `EQM 50%` discrepancy comes from `time_power` not yet being
calibrated against the visible centering caption (`51.77%`). Lowering
`time_power` toward `0.5` brings the median band down toward `$109K`.

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
