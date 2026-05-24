# Bitcoin Empirical Quantile Model Prototype

This folder contains a reverse-engineering workspace for BTCAnalytica's Bitcoin
Empirical Quantile Model (EQM), based on the published chart in
`btcanalytica_model.jpeg`.

The goal is not to claim an exact clone. The goal is to make the visible model
mechanics reproducible enough to test:

- dynamic BTC fair-value bands
- a price-to-risk mapping from 0% to 100%
- a risk-weighted DCA rule

## Screenshot Snapshot

The chart is dated May 22, 2026 close and shows:

| Metric | Value |
| --- | ---: |
| BTC price | 75.5K |
| EQM 0.1% | 45.4K |
| EQM 50% | 109.6K |
| EQM 99.9% | 159.9K |
| EQM QR 0.1% | 50.8K |
| EQM QR 50% | 100.4K |
| EQM QR 99.9% | 269.4K |
| EQM score | 0.145 |
| EQM risk | 28.5% |
| EQM trend-risk | 72.3K |

The clearest reverse-engineering clue is the "EQM Risk as a Function of Price"
panel:

| Risk | Price |
| ---: | ---: |
| 0% | 45K |
| 10% | 59K |
| 25% | 72K |
| 50% | 101K |
| 75% | 125K |
| 90% | 138K |
| 100% | 160K |

Linear interpolation through these knots gives about 28% risk at 75.5K, very
close to the chart's 28.5%.

## Working Hypothesis

EQM appears to have two related layers:

1. **Band layer**: fit long-run log-price quantiles over Bitcoin history.
   Dashed "QR" trendlines likely come from quantile regression on `log(price)`
   against time.
2. **Empirical layer**: convert today's band values into a monotone price-risk
   curve. The visible chart suggests the current lower and upper risk anchors
   align with the empirical 0.1% and 99.9% bands, while the 50% risk anchor is
   close to the QR median trendline.

The included prototype starts with that price-risk curve because it is the
part most directly recoverable from the screenshot.

## DCA Rule

BTCAnalytica's published rule:

```text
daily_dollars = base_amount * (1 - 2 * risk)
```

Where:

- `risk = 0.0` means max buy
- `risk = 0.5` means neutral
- `risk = 1.0` means max sell

For the screenshot:

```text
500 * (1 - 2 * 0.285) = 215
```

So the model would buy roughly $215/day with a $500 base amount.

## Run The Prototype

Demo using the screenshot anchors:

```bash
python3 EQM/eqm_prototype.py --demo
```

Run against a CSV of daily BTC prices:

```bash
python3 EQM/eqm_prototype.py --csv path/to/btc_daily.csv --date-col Date --price-col BTCUSD
```

The CSV mode uses a standard-library log-linear residual quantile envelope:

1. fit an OLS trend to `log(price)` over time
2. compute residual quantiles
3. convert the quantile residuals back into price bands
4. map the latest price to risk with the same knot/interpolation machinery

That is a practical stand-in for true quantile regression. For a closer clone,
the next step is to add `statsmodels` and fit `QuantReg(log_price ~ time)` at
tau values such as 0.001, 0.10, 0.25, 0.50, 0.75, 0.90, and 0.999.
