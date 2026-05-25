/**
 * CoinStrat Quantile Model (CQM) — TypeScript port of the Python EQM replica
 * developed in EQM-model/. The model is a reverse-engineered approximation of
 * BTCAnalytica's "Empirical Quantile Model" (EQM) chart.
 *
 * Two trends are computed:
 *   - OLS trend on log(price) ~ days_since_start ** time_power (used for the
 *     EQM Risk and EQM Score signals)
 *   - QR median trend, fit by IRLS for the LAD problem (used as a warm-up
 *     fallback for the very first days before the rolling/decayed quantile
 *     bands have enough history)
 *
 * Solid bands at any date t:
 *   r(s)               = price(s) / rolling_ATH(s)         for s ≤ t
 *
 *   gold_shelved(t)    = running_max( ATH(t) × Q_0.5( r over last 730 days ) )
 *   gold_ceiling(t)    = rolling_min(price, 30 days) × 2.0
 *   solid_50%(t)       = min( gold_shelved(t), gold_ceiling(t) )
 *
 *   green_shelved(t)   = running_max( ATH(t) × weighted_Q_0.05( r,
 *                          weights = exp(-λ × age_in_years), λ = ln 2 / 1y ) )
 *   green_floor(t)     = rolling_min(price, 30 days) × 0.95
 *   solid_0.1%(t)      = min( green_shelved(t), green_floor(t) )
 *
 *   solid_99.9%(t)     = max( rolling_ATH(t) × upper_ath_factor, solid_50%(t) )
 *
 * Both GOLD and GREEN are shelved (running-max) and then clipped from above
 * by a multiple of the recent rolling-min price. The clip:
 *   - Pulls GOLD down during deep bear bottoms (2015, 2018, 2022) so it
 *     stays *between red and green* on the chart instead of plateauing at
 *     the previous-cycle's bull peak level. Buffer 2.0× rolling-min keeps
 *     gold visually in the middle band area.
 *   - Pushes GREEN below BTC at every cycle bottom so it visually acts as
 *     a true "deep value floor". Buffer 0.95× rolling-min leaves a 5%
 *     safety margin between the floor and the actual cycle low.
 * In both cases the constraint doesn't bind during bull markets / corrections
 * from peak, so the BTCAnalytica snapshot match is preserved.
 *
 * The time-decay weighting (1-year half-life) biases the low quantile
 * toward recent observations so as BTC has matured the implied green/ATH
 * multiplier drifts upward (≈0.27 in 2018, ≈0.37 in 2026).
 *
 * Verified against the BTCAnalytica May 22, 2026 snapshot:
 *   EQM 0.1%   $45.4K  → predicted $47.8K  (+5.2%)
 *   EQM 50%    $108.4K → predicted $111.9K (+3.2%)
 *   EQM 99.9%  $159.4K → predicted $159.6K (+0.1%)
 *
 * Dashed bands:
 *   dashed_q(t)    = OLS_trend(t) × exp( empirical_quantile(q, residuals_ols) )
 *
 * The dashed bands are a pragmatic substitute for true statsmodels QR fits at
 * the extreme quantiles; they capture the right shape but the slope at the
 * extreme tau will be slightly different from a full QR fit.
 */

export interface CQMPoint {
  date: string;             // YYYY-MM-DD
  ts: number;               // epoch ms
  price: number;
  trendOls: number;         // OLS trend (risk-model fair value)
  qrMedian: number;         // QR median trend
  solidLower: number;
  solidMedian: number;
  solidUpper: number;
  dashedLow: number;        // approximation of QR(0.001)
  dashedHigh: number;       // approximation of QR(0.999)
  score: number;            // 0..1
  risk: number;             // 0..1
  // 60-day rolling quantile envelope on raw price (placeholder proxy
  // for the BTCAnalytica "Trend-Risk Composite"). null until enough
  // points accumulate (min_periods = max(window/4, 10)).
  trendRiskLower: number | null;   // 10th percentile
  trendRiskMedian: number | null;  // 50th percentile
  trendRiskUpper: number | null;   // 90th percentile
}

export interface CQMSnapshot {
  date: string;
  ts: number;
  price: number;
  qrMedian: number;
  solidLower: number;
  solidMedian: number;
  solidUpper: number;
  dashedLow: number;
  dashedHigh: number;
  score: number;
  risk: number;
  trendRiskLower: number | null;
  trendRiskMedian: number | null;
  trendRiskUpper: number | null;
}

export interface CQMFit {
  startDate: Date;
  timePower: number;
  // OLS trend params for log(price) = a + b * days^p
  olsIntercept: number;
  olsSlope: number;
  // QR median params (same form, fit by IRLS LAD)
  qrIntercept: number;
  qrSlope: number;
  // Calibration anchors used by the risk model
  lowQ: number;
  highQ: number;
  scorePower: number;
  // Sorted residual arrays for empirical quantile lookups
  sortedOlsResiduals: Float64Array;
  sortedQrResiduals: Float64Array;
  // Solid-band parameters
  solidGoldWindow: number;            // GOLD: rolling-window for ATH-relative Q0.5 fit
  solidGoldFloorWindow: number;       // GOLD: rolling-min price window (days)
  solidGoldFloorBuffer: number;       // GOLD: rolling-min × this caps gold from above
  solidGreenHalfLifeYears: number;    // GREEN: half-life of time-decay weighting
  solidGreenQuantile: number;         // GREEN: quantile q in weighted Q_q(price/ATH)
  solidGreenFloorWindow: number;      // GREEN: rolling-min price window (days)
  solidGreenFloorBuffer: number;      // GREEN: rolling-min × this gives the price floor
  upperAthFactor: number;             // RED: multiplier on rolling ATH
  // Fallback for the warm-up window where the green band has too little
  // history; used to avoid plotting NaNs at the start of the chart.
  solidGreenWarmupOffset: number;     // log offset = empirical_quantile(0.001, qrResiduals)
  rollingAth: Float64Array;     // aligned with the input price series
  pricesTimestamps: number[];   // aligned with rollingAth
  // Cached signal series (full sample)
  signals: CQMPoint[];
}

export interface CQMConfig {
  /**
   * Earliest BTC history to include in the fit (YYYY-MM-DD). Earlier prices
   * are dropped before the OLS / QR regressions run. Defaults to
   * '2014-01-01' to match the Python replica's `--start-history` default;
   * including the 2011-2013 era ($0.30 → $1,200) materially distorts both
   * the trend slope and the residual distribution that drives Risk / Score.
   */
  startDate?: string;
  timePower?: number;
  lowQ?: number;
  highQ?: number;
  scorePower?: number;
  /**
   * Multiplier applied to the rolling all-time-high to produce the solid
   * upper (red) band. Verified at 1.28 against the BTCAnalytica snapshot.
   */
  upperAthFactor?: number;
  /**
   * Window (in calendar days) used by the ATH-relative solid GOLD band.
   * The band at time t is `running_max(ATH(t) × Q_0.5(price/ATH over last
   * solidGoldWindow days))`. 730 was the closest fit to the May 22, 2026
   * BTCAnalytica snapshot value of $108.4K (predicted $111.9K, +3.2%).
   */
  solidGoldWindow?: number;
  /**
   * Rolling-window length (days) for the gold-band price-relative ceiling.
   * The ceiling clips gold to be ≤ rolling_min(price, this window) ×
   * solidGoldFloorBuffer. 30d matches the typical duration of a cycle-low
   * basing pattern so gold gets pulled down during the deepest bear
   * bottoms toward the realistic fair-value range.
   */
  solidGoldFloorWindow?: number;
  /**
   * Multiplier on rolling-min price for the gold-band price-relative
   * ceiling. 2.0 means gold is clipped at 2× the recent rolling-min during
   * deep bears (so it stays approximately between red and green), but the
   * constraint does NOT bind in bull markets or corrections from peak (so
   * the BTCAnalytica snapshot match is preserved).
   */
  solidGoldFloorBuffer?: number;
  /**
   * Half-life in YEARS for the time-decayed weighted quantile that drives
   * the shelved-green band. 1.0 was the closest fit to the BTCAnalytica
   * May 22, 2026 snapshot ($45.4K → predicted $47.8K, +5.2%).
   */
  solidGreenHalfLifeYears?: number;
  /**
   * Quantile q for the time-decayed weighted Q_q(price/ATH) used by the
   * shelved-green band. Default 0.05 mirrors the empirical lower envelope
   * of recent BTC drawdown ratios.
   */
  solidGreenQuantile?: number;
  /**
   * Maximum lookback (in days) for the green band's weighted quantile.
   * With a 1-year half-life, weights beyond 5 years are <3% so this
   * truncation is a speed optimization with negligible effect on values.
   */
  solidGreenMaxLookbackDays?: number;
  /**
   * Rolling-window length (days) for the green-band price-floor constraint.
   * The constraint clips green to be ≤ rolling_min(price, this window) ×
   * solidGreenFloorBuffer. 30d matches the typical duration of a
   * cycle-low basing pattern.
   */
  solidGreenFloorWindow?: number;
  /**
   * Multiplier on rolling-min price for the green-band price-floor
   * constraint. 0.95 leaves a 5% safety margin between the floor and the
   * actual cycle low while preserving the snapshot match.
   */
  solidGreenFloorBuffer?: number;
  trendRiskWindow?: number;     // calendar days (default 60)
  trendRiskLowQ?: number;       // default 0.10
  trendRiskHighQ?: number;      // default 0.90
}

const DEFAULT_CONFIG: Required<CQMConfig> = {
  startDate: '2014-01-01',
  timePower: 0.6,
  lowQ: 0.06,
  highQ: 0.68,
  scorePower: 1.5,
  upperAthFactor: 1.28,
  solidGoldWindow: 730,
  solidGoldFloorWindow: 30,
  solidGoldFloorBuffer: 2.0,
  solidGreenHalfLifeYears: 1.0,
  solidGreenQuantile: 0.05,
  solidGreenMaxLookbackDays: 1825,
  solidGreenFloorWindow: 30,
  solidGreenFloorBuffer: 0.95,
  trendRiskWindow: 60,
  trendRiskLowQ: 0.10,
  trendRiskHighQ: 0.90,
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface PricePoint {
  date: string;
  ts: number;
  price: number;
}

// --- numeric utilities -----------------------------------------------------

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function timeIndex(ts: number[], startTs: number, timePower: number): Float64Array {
  const out = new Float64Array(ts.length);
  for (let i = 0; i < ts.length; i++) {
    const days = Math.max(1, (ts[i] - startTs) / DAY_MS + 1);
    out[i] = Math.pow(days, timePower);
  }
  return out;
}

function fitOLS(x: Float64Array, y: Float64Array): { intercept: number; slope: number } {
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { intercept: sy / n, slope: 0 };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope };
}

function fitWLS(
  x: Float64Array,
  y: Float64Array,
  w: Float64Array
): { intercept: number; slope: number } {
  const n = x.length;
  let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    sw += wi;
    swx += wi * x[i];
    swy += wi * y[i];
    swxx += wi * x[i] * x[i];
    swxy += wi * x[i] * y[i];
  }
  const denom = sw * swxx - swx * swx;
  if (denom === 0) return { intercept: swy / sw, slope: 0 };
  const slope = (sw * swxy - swx * swy) / denom;
  const intercept = (swy - slope * swx) / sw;
  return { intercept, slope };
}

/**
 * Iteratively reweighted least squares for the LAD (median quantile)
 * regression problem. Equivalent to QuantReg(q=0.5) for a univariate linear
 * design.
 */
function fitQRMedian(
  x: Float64Array,
  y: Float64Array,
  maxIter = 60,
  tol = 1e-8
): { intercept: number; slope: number } {
  let { intercept, slope } = fitOLS(x, y);
  const n = x.length;
  const w = new Float64Array(n);
  const eps = 1e-6;

  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      const r = Math.abs(y[i] - intercept - slope * x[i]);
      w[i] = 1 / Math.max(r, eps);
    }
    const next = fitWLS(x, y, w);
    const delta = Math.abs(next.intercept - intercept) + Math.abs(next.slope - slope);
    intercept = next.intercept;
    slope = next.slope;
    if (delta < tol) break;
  }
  return { intercept, slope };
}

function sortedCopy(arr: ArrayLike<number>): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  out.sort();
  return out;
}

function empiricalQuantile(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const clamped = clamp(q, 0, 1);
  const pos = clamped * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function empiricalPercentile(sorted: Float64Array, value: number): number {
  // Returns fraction of sample <= value, using bisection (right side).
  const n = sorted.length;
  if (n === 0) return NaN;
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / n;
}

/**
 * Rolling-window quantile on a raw series. At each index `i` we look back
 * up to `window` samples (inclusive) and return the requested quantile.
 * Uses a small per-step sort, which is O(N * window log window) — fine for
 * the BTC daily history (~5,600 points × 60-day window).
 *
 * Mirrors pandas' `series.rolling(window, min_periods).quantile(q)` with
 * `min_periods = max(floor(window/4), 10)`.
 */
function rollingQuantile(
  values: Float64Array,
  window: number,
  q: number,
  minPeriods: number
): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n);
  const buf = new Float64Array(window);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    const len = i - start + 1;
    if (len < minPeriods) {
      out[i] = null;
      continue;
    }
    for (let k = 0; k < len; k++) buf[k] = values[start + k];
    const slice = buf.subarray(0, len);
    // Float64Array.subarray shares memory; sort sorts the live view.
    slice.sort();
    const pos = q * (len - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) {
      out[i] = slice[lo];
    } else {
      const frac = pos - lo;
      out[i] = slice[lo] * (1 - frac) + slice[hi] * frac;
    }
  }
  return out;
}

/**
 * Time-decayed weighted quantile of a series. At each index `i` we look at
 * the most recent `maxLookbackDays` samples (inclusive) and compute the
 * `q`-th quantile of those samples weighted by `exp(-λ × age_in_years)`,
 * where `λ = ln(2) / halfLifeYears`.
 *
 * Returns null for indices before `minHistoryDays`.
 *
 * Cost: O(N × W log W) where W = min(maxLookbackDays, i+1). For 4500 daily
 * prices with W=1825, this is ~50ms in V8.
 */
function timeDecayedWeightedQuantile(
  values: Float64Array,
  halfLifeYears: number,
  q: number,
  minHistoryDays: number,
  maxLookbackDays: number
): Array<number | null> {
  const n = values.length;
  const out: Array<number | null> = new Array(n);
  const lambda = Math.log(2) / halfLifeYears;

  type WeightedSample = { v: number; w: number };
  const buf: WeightedSample[] = new Array(maxLookbackDays);
  for (let k = 0; k < maxLookbackDays; k++) buf[k] = { v: 0, w: 0 };

  for (let i = 0; i < n; i++) {
    if (i < minHistoryDays) {
      out[i] = null;
      continue;
    }
    const start = Math.max(0, i - maxLookbackDays + 1);
    const len = i - start + 1;
    let total = 0;
    for (let k = 0; k < len; k++) {
      const ageYears = (i - (start + k)) / 365.25;
      const w = Math.exp(-lambda * ageYears);
      buf[k].v = values[start + k];
      buf[k].w = w;
      total += w;
    }
    if (total <= 0) {
      out[i] = null;
      continue;
    }
    const slice = buf.slice(0, len).sort((a, b) => a.v - b.v);
    const target = q * total;
    let cum = 0;
    let value = slice[slice.length - 1].v;
    for (let k = 0; k < slice.length; k++) {
      cum += slice[k].w;
      if (cum >= target) {
        value = slice[k].v;
        break;
      }
    }
    out[i] = value;
  }
  return out;
}

// --- model fit -------------------------------------------------------------

export function fitCQM(prices: PricePoint[], config: CQMConfig = {}): CQMFit {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const minTs = new Date(cfg.startDate).getTime();
  if (!Number.isFinite(minTs)) {
    throw new Error(`Invalid CQM startDate: ${cfg.startDate}`);
  }
  const cleaned: PricePoint[] = [];
  for (const p of prices) {
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    if (p.ts < minTs) continue;
    cleaned.push(p);
  }
  cleaned.sort((a, b) => a.ts - b.ts);
  const n = cleaned.length;
  if (n < 365) {
    throw new Error(
      `CQM fit needs at least 365 daily prices since ${cfg.startDate}, got ${n}.`,
    );
  }

  const startTs = cleaned[0].ts;
  const startDate = new Date(startTs);
  const ts = cleaned.map((p) => p.ts);
  const x = timeIndex(ts, startTs, cfg.timePower);
  const logPrice = new Float64Array(n);
  for (let i = 0; i < n; i++) logPrice[i] = Math.log(cleaned[i].price);

  const ols = fitOLS(x, logPrice);
  const qr = fitQRMedian(x, logPrice);

  const olsResiduals = new Float64Array(n);
  const qrResiduals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    olsResiduals[i] = logPrice[i] - (ols.intercept + ols.slope * x[i]);
    qrResiduals[i] = logPrice[i] - (qr.intercept + qr.slope * x[i]);
  }

  const sortedOls = sortedCopy(olsResiduals);
  const sortedQr = sortedCopy(qrResiduals);

  // Rolling all-time-high (expanding maximum)
  const rollingAth = new Float64Array(n);
  let runningMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (cleaned[i].price > runningMax) runningMax = cleaned[i].price;
    rollingAth[i] = runningMax;
  }

  // 60-day rolling quantile envelope on raw price (Trend-Risk Composite).
  const priceArr = new Float64Array(n);
  for (let i = 0; i < n; i++) priceArr[i] = cleaned[i].price;
  const minPeriods = Math.max(Math.floor(cfg.trendRiskWindow / 4), 10);
  const trLower = rollingQuantile(priceArr, cfg.trendRiskWindow, cfg.trendRiskLowQ, minPeriods);
  const trMedian = rollingQuantile(priceArr, cfg.trendRiskWindow, 0.5, minPeriods);
  const trUpper = rollingQuantile(priceArr, cfg.trendRiskWindow, cfg.trendRiskHighQ, minPeriods);

  // GOLD band: rolling Q0.5 of (price/ATH) over a multi-year window,
  // multiplied by the current ATH, then running-max so the band shelves.
  const ratios = new Float64Array(n);
  for (let i = 0; i < n; i++) ratios[i] = cleaned[i].price / rollingAth[i];

  const goldMinPeriods = Math.max(Math.floor(cfg.solidGoldWindow / 4), 30);
  const goldRatioMedian = rollingQuantile(
    ratios,
    cfg.solidGoldWindow,
    0.5,
    goldMinPeriods,
  );
  const goldShelved = new Float64Array(n);
  let goldRunMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const q = goldRatioMedian[i];
    const raw = q === null ? NaN : rollingAth[i] * q;
    if (Number.isFinite(raw)) {
      if (raw > goldRunMax) goldRunMax = raw;
      goldShelved[i] = goldRunMax;
    } else {
      goldShelved[i] = NaN;
    }
  }

  // GREEN band: time-decayed weighted Q0.05 of (price/ATH), multiplied by
  // the current ATH, then running-max so the band shelves. The weighting
  // gives recent observations more influence so the implied ATH multiplier
  // drifts upward as BTC's drawdowns have grown shallower over time —
  // matching the chart's non-stationary green/ATH ratio.
  const greenRatioQ = timeDecayedWeightedQuantile(
    ratios,
    cfg.solidGreenHalfLifeYears,
    cfg.solidGreenQuantile,
    /* minHistoryDays */ 365,
    cfg.solidGreenMaxLookbackDays,
  );
  const greenShelved = new Float64Array(n);
  let greenRunMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const q = greenRatioQ[i];
    const raw = q === null ? NaN : rollingAth[i] * q;
    if (Number.isFinite(raw)) {
      if (raw > greenRunMax) greenRunMax = raw;
      greenShelved[i] = greenRunMax;
    } else {
      greenShelved[i] = NaN;
    }
  }

  // Price-relative ceilings for gold and green: clip each shelved series to
  // be at most `floor_buffer × rolling_min(price, floor_window)`. The
  // green ceiling (~0.95×) forces the band below BTC at cycle bottoms so it
  // visually acts as a deep-value floor. The gold ceiling (~2.0×) pulls
  // gold down during bear bottoms toward the realistic fair-value range so
  // it stays "approximately between red and green" instead of plateauing
  // at the previous-cycle's bull peak. Neither constraint binds during
  // bull markets / corrections from peak, so the snapshot match is
  // preserved.
  const computeRollingMin = (window: number): Float64Array => {
    const W = Math.max(1, window);
    const out = new Float64Array(n);
    const deque: number[] = []; // indices; values monotonically increasing
    for (let i = 0; i < n; i++) {
      while (deque.length > 0 && deque[0] <= i - W) deque.shift();
      while (
        deque.length > 0 &&
        cleaned[deque[deque.length - 1]].price >= cleaned[i].price
      ) {
        deque.pop();
      }
      deque.push(i);
      out[i] = cleaned[deque[0]].price;
    }
    return out;
  };
  const greenRollingPriceMin = computeRollingMin(cfg.solidGreenFloorWindow);
  const goldRollingPriceMin =
    cfg.solidGoldFloorWindow === cfg.solidGreenFloorWindow
      ? greenRollingPriceMin
      : computeRollingMin(cfg.solidGoldFloorWindow);

  // Warm-up fallback for the first ~365 days where the time-decayed quantile
  // is not yet defined: use QR_median × exp(0.001 quantile of residuals).
  const solidGreenWarmupOffset = empiricalQuantile(sortedQr, 0.001);

  // Build the daily signal series
  const signals: CQMPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const trendOls = Math.exp(ols.intercept + ols.slope * x[i]);
    const qrMedian = Math.exp(qr.intercept + qr.slope * x[i]);
    // GOLD: shelved rolling Q0.5 of (price/ATH) × ATH(t), then clipped from
    // above by `solidGoldFloorBuffer × rolling_min(price)` so during deep
    // bear bottoms gold gets pulled down from the previous-cycle's shelved
    // level toward the realistic fair-value range. Falls back to QR median
    // during the first ~goldMinPeriods days.
    const goldShelvedI = Number.isFinite(goldShelved[i])
      ? goldShelved[i]
      : qrMedian;
    const goldCeiling = goldRollingPriceMin[i] * cfg.solidGoldFloorBuffer;
    const solidMedian = Math.min(goldShelvedI, goldCeiling);
    // GREEN: shelved time-decayed weighted Q0.05 of (price/ATH) × ATH(t),
    // clipped from above by `solidGreenFloorBuffer × rolling_min(price)` so
    // the band is always a true floor below BTC at cycle bottoms.
    // Falls back to QR_median × exp(low residual quantile) during warm-up.
    const greenShelvedI = Number.isFinite(greenShelved[i])
      ? greenShelved[i]
      : qrMedian * Math.exp(solidGreenWarmupOffset);
    const greenPriceFloor = greenRollingPriceMin[i] * cfg.solidGreenFloorBuffer;
    const solidLower = Math.min(greenShelvedI, greenPriceFloor);
    // RED: rolling ATH × factor, floored by the GOLD line.
    const solidUpper = Math.max(
      rollingAth[i] * cfg.upperAthFactor,
      solidMedian,
    );

    // Approximate dashed QR bands using OLS trend + empirical residual quantile
    const dashedLow = trendOls * Math.exp(empiricalQuantile(sortedOls, 0.001));
    const dashedHigh = trendOls * Math.exp(empiricalQuantile(sortedOls, 0.999));

    // Risk: percentile of residual stretched through [low_q, high_q]
    const pct = empiricalPercentile(sortedOls, olsResiduals[i]);
    const risk = clamp((pct - cfg.lowQ) / (cfg.highQ - cfg.lowQ), 0, 1);
    // Score: same percentile raised to score_power (matches the Python replica)
    const score = Math.pow(risk, cfg.scorePower);

    signals[i] = {
      date: cleaned[i].date,
      ts: cleaned[i].ts,
      price: cleaned[i].price,
      trendOls,
      qrMedian,
      solidLower,
      solidMedian,
      solidUpper,
      dashedLow,
      dashedHigh,
      score,
      risk,
      trendRiskLower: trLower[i],
      trendRiskMedian: trMedian[i],
      trendRiskUpper: trUpper[i],
    };
  }

  return {
    startDate,
    timePower: cfg.timePower,
    olsIntercept: ols.intercept,
    olsSlope: ols.slope,
    qrIntercept: qr.intercept,
    qrSlope: qr.slope,
    lowQ: cfg.lowQ,
    highQ: cfg.highQ,
    scorePower: cfg.scorePower,
    sortedOlsResiduals: sortedOls,
    sortedQrResiduals: sortedQr,
    solidGoldWindow: cfg.solidGoldWindow,
    solidGoldFloorWindow: cfg.solidGoldFloorWindow,
    solidGoldFloorBuffer: cfg.solidGoldFloorBuffer,
    solidGreenHalfLifeYears: cfg.solidGreenHalfLifeYears,
    solidGreenQuantile: cfg.solidGreenQuantile,
    solidGreenFloorWindow: cfg.solidGreenFloorWindow,
    solidGreenFloorBuffer: cfg.solidGreenFloorBuffer,
    solidGreenWarmupOffset,
    upperAthFactor: cfg.upperAthFactor,
    rollingAth,
    pricesTimestamps: ts,
    signals,
  };
}

export function snapshotAt(fit: CQMFit, ts?: number): CQMSnapshot | null {
  const series = fit.signals;
  if (series.length === 0) return null;
  let target: CQMPoint;
  if (ts === undefined) {
    target = series[series.length - 1];
  } else {
    let idx = series.length - 1;
    for (let i = 0; i < series.length; i++) {
      if (series[i].ts > ts) {
        idx = Math.max(0, i - 1);
        break;
      }
      idx = i;
    }
    target = series[idx];
  }
  return {
    date: target.date,
    ts: target.ts,
    price: target.price,
    qrMedian: target.qrMedian,
    solidLower: target.solidLower,
    solidMedian: target.solidMedian,
    solidUpper: target.solidUpper,
    dashedLow: target.dashedLow,
    dashedHigh: target.dashedHigh,
    score: target.score,
    risk: target.risk,
    trendRiskLower: target.trendRiskLower,
    trendRiskMedian: target.trendRiskMedian,
    trendRiskUpper: target.trendRiskUpper,
  };
}
