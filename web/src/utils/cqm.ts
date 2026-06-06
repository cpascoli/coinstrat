/**
 * CoinStrat Quantile Model (CQM) — TypeScript port of the Python EQM replica
 * in EQM-model/. Defaults in DEFAULT_CONFIG must stay in sync with
 * eqm_model.CQM_DEFAULTS. Reverse-engineered approximation of BTCAnalytica's
 * Empirical Quantile Model (EQM).
 *
 * Production v1b fair-value model
 * --------------------------------
 * Scaled asymmetric QR fan (Cowen 2026 parabola in log10 price vs log-days
 * since 2009), uniform tail scale from 2022 → qrCalibrationDate (~$100.8K
 * QR 50% on 2026-05-28). No early-era $220 anchor boost.
 *
 * Solid chart bands at date t:
 *   solid_0.1%(t)  = tail-scaled asymmetric QR 0.1%
 *   solid_50%(t)   = SMA( log-blend(price, QR 50%) ) over fairGoldSmaWeeks
 *   solid_99.9%(t) = tail-scaled asymmetric QR 99.9%
 *
 * Dotted QR lines use the same scaled fan. Risk fair value = QR 50% dashed.
 *
 * EQM Risk (default riskMode='global'):
 *   residual(t) = log(price) - log(QR_50%(t))
 *   risk(t)     = soft_map( empirical_percentile(residual, full_sample) )
 *
 * Score = risk^score_power (computed but not shown on the charts page).
 * OLS log-trend is fit for reference only; it does not drive risk or bands.
 *
 * riskMode='gated' | 'rolling' remain for diagnostics/backtests only.
 */

export interface CQMPoint {
  date: string;             // YYYY-MM-DD
  ts: number;               // epoch ms
  price: number;
  trendOls: number;         // legacy OLS log-trend (display/reference only)
  qrMedian: number;         // QR median trend
  solidLower: number;
  solidMedian: number;
  solidUpper: number;
  qrDashedLow: number;       // asymmetric QR 0.1%
  qrDashedMedian: number;    // asymmetric QR 50% (dotted gold trendline)
  qrDashedHigh: number;      // asymmetric QR 99.9%
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
  qrDashedLow: number;
  qrDashedMedian: number;
  qrDashedHigh: number;
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
  riskGammaStart: number;
  riskGamma2018: number;
  riskGamma2022: number;
  riskGammaCurrent: number;
  riskHighQuantileStart: number;
  riskHighQuantile2018: number;
  riskHighQuantile2022: number;
  // Sorted residual arrays for empirical quantile lookups
  sortedOlsResiduals: Float64Array;
  sortedQrResiduals: Float64Array;
  sortedFairResiduals: Float64Array;
  // Legacy ATH-shelved band params (retained on CQMFit; v1b solids use scaled QR)
  solidGoldWindow: number;
  solidGoldFloorWindow: number;
  solidGoldFloorBuffer: number;
  solidGreenHalfLifeYears: number;
  solidGreenQuantile: number;
  solidGreenFloorWindow: number;
  solidGreenFloorBuffer: number;
  upperAthFactor: number;
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
   * Cycle-aware risk mapping. Older cycles use a higher upper percentile
   * anchor so early BTC blow-off moves don't all hard-clip at 100% risk.
   * The latest endpoint decays back to `highQ`, preserving today's snapshot.
   */
  riskGammaStart?: number;
  riskGamma2018?: number;
  riskGamma2022?: number;
  riskHighQuantileStart?: number;
  riskHighQuantile2018?: number;
  riskHighQuantile2022?: number;
  /** Legacy ATH-shelved band params (retained for API compat; v1b solids use scaled QR). */
  upperAthFactor?: number;
  solidGoldWindow?: number;
  solidGoldFloorWindow?: number;
  solidGoldFloorBuffer?: number;
  solidGreenHalfLifeYears?: number;
  solidGreenQuantile?: number;
  solidGreenMaxLookbackDays?: number;
  solidGreenFloorWindow?: number;
  solidGreenFloorBuffer?: number;
  trendRiskWindow?: number;     // calendar days (default 60)
  trendRiskLowQ?: number;       // default 0.10
  trendRiskHighQ?: number;      // default 0.90
  /**
   * EQM risk mapping mode. Production default is 'global' (full-sample
   * empirical percentile). 'gated' and 'rolling' are legacy diagnostics only.
   */
  riskMode?: 'global' | 'rolling' | 'gated';
  /** Trailing window for legacy rolling/gated risk (730 = 2 years). */
  riskRollDays?: number;
  /** Near-local-low lookback for legacy gated risk (days). */
  riskGateNearDays?: number;
  /** Price at or above this × near-low min uses global risk only (weight = 0). */
  riskGateNearBuffer?: number;
  /**
   * Exponent applied to the gate blend weight before mixing toward rolling risk.
   * Values > 1 slow engagement (e.g. 2.0 → at linear weight 0.5 only 25% rolling pull).
   */
  riskGateWeightPower?: number;
  /** Legacy gated risk: floor as a fraction of global risk when gate is active. */
  riskGateGlobalFloor?: number;
  /** Tail-ramp endpoint: QR 50% is calibrated to this USD level on this date. */
  qrCalibrationDate?: string;
  qrCalibrationMedianUsd?: number;
  /** Tail scale is 1.0 before this date, then ramps to the calibration endpoint. */
  qrScaleRampStartDate?: string;
  qrScaleRampPower?: number;
  /** Log-blend weight on BTC price when building the gold SMA band. */
  fairBlendPriceWeight?: number;
  fairGoldSmaWeeks?: number;
  /** Fair-value driver for risk: 'qr50' (default) or 'gold'. */
  riskFairDriver?: 'qr50' | 'gold';
}

const DEFAULT_CONFIG: Required<CQMConfig> = {
  startDate: '2014-01-01',
  timePower: 0.6,
  lowQ: 0.06,
  highQ: 0.68,
  scorePower: 1.5,
  riskGammaStart: 1.35,
  riskGamma2018: 1.20,
  riskGamma2022: 1.08,
  riskHighQuantileStart: 0.999,
  riskHighQuantile2018: 0.990,
  riskHighQuantile2022: 0.950,
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
  riskMode: 'global',
  riskRollDays: 730,
  riskGateNearDays: 120,
  riskGateNearBuffer: 1.15,
  riskGateWeightPower: 2.0,
  riskGateGlobalFloor: 0.75,
  qrCalibrationDate: '2026-05-28',
  qrCalibrationMedianUsd: 100_800,
  qrScaleRampStartDate: '2022-01-01',
  qrScaleRampPower: 1.0,
  fairBlendPriceWeight: 0.5,
  fairGoldSmaWeeks: 20,
  riskFairDriver: 'qr50',
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
 * Causal trailing-window percentile rank of each value in [0, 1].
 * At index i uses only values in [i - window + 1, i].
 */
function rollingEmpiricalPercentile(
  values: Float64Array,
  window: number,
  minPeriods: number,
): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    const len = i - start + 1;
    if (len < minPeriods) continue;
    const value = values[i];
    let count = 0;
    for (let j = start; j <= i; j++) {
      if (values[j] <= value) count++;
    }
    out[i] = count / len;
  }
  return out;
}

function riskFromPercentile(
  pct: number,
  ts: number,
  endTs: number,
  cfg: Required<CQMConfig>,
  riskGammaCurrent: number,
): number {
  const riskHighQ = interpolateCycleKnot(
    ts,
    endTs,
    cfg.riskHighQuantileStart,
    cfg.riskHighQuantile2018,
    cfg.riskHighQuantile2022,
    cfg.highQ,
  );
  const riskGamma = interpolateCycleKnot(
    ts,
    endTs,
    cfg.riskGammaStart,
    cfg.riskGamma2018,
    cfg.riskGamma2022,
    riskGammaCurrent,
  );
  const riskZ = clamp((pct - cfg.lowQ) / (riskHighQ - cfg.lowQ), 0, 1);
  return Math.pow(riskZ, riskGamma);
}

/** Blend weight 0 = global only; 1 = full min(global, rolling) target. */
export function computeGateBlendWeight(
  price: number,
  nearLowMin: number,
  cfg: Pick<Required<CQMConfig>, 'riskGateNearBuffer'>,
): number {
  if (!Number.isFinite(price) || !Number.isFinite(nearLowMin) || nearLowMin <= 0) {
    return 0;
  }
  const enter = nearLowMin * cfg.riskGateNearBuffer;
  const full = nearLowMin;
  if (enter <= full) return price <= full ? 1 : 0;
  if (price >= enter) return 0;
  if (price <= full) return 1;
  return clamp((enter - price) / (enter - full), 0, 1);
}

export function blendGatedRisk(
  globalRisk: number,
  rollingRisk: number,
  weight: number,
): number {
  const w = clamp(weight, 0, 1);
  const target = Math.min(globalRisk, rollingRisk);
  return globalRisk - w * (globalRisk - target);
}

/** Slow the linear gate weight so rolling correction engages gradually. */
export function softenGateBlendWeight(weight: number, power: number): number {
  const w = clamp(weight, 0, 1);
  if (!Number.isFinite(power) || power <= 0) return 0;
  if (power === 1) return w;
  return Math.pow(w, power);
}

/**
 * Gated blend with softened weight and a global-risk floor (prototype soft gate).
 * When gateWeight is 0, returns globalRisk unchanged.
 */
export function applySoftGatedRisk(
  globalRisk: number,
  rollingRisk: number,
  gateWeight: number,
  cfg: Pick<Required<CQMConfig>, 'riskGateWeightPower' | 'riskGateGlobalFloor'>,
): number {
  if (gateWeight <= 0) return globalRisk;
  const w = softenGateBlendWeight(gateWeight, cfg.riskGateWeightPower);
  const blended = blendGatedRisk(globalRisk, rollingRisk, w);
  const floor = cfg.riskGateGlobalFloor * globalRisk;
  return Math.max(blended, floor);
}

// --- asymmetric quadratic QR fan (Cowen 2026) ------------------------------

const QR_GENESIS_MS = new Date('2009-01-01').getTime();
const QR_FAN_QUANTILES = [0.001, 0.5, 0.999] as const;
const QR_LOWER_TAUS = [0.001, 0.01, 0.10, 0.25] as const;
const QR_MEDIAN_TAUS = [0.5] as const;
const QR_UPPER_TAUS = [0.75, 0.95, 0.99, 0.999] as const;
const QR_SEED_CURVATURE: [number, number, number] = [-0.024, -0.113, -0.326];
const ASYM_NM_MAX_ITER = 120;

let asymFitCacheKey = '';
let asymFitCache: AsymmetricQuantileFit | null = null;

interface AsymmetricQuantileFit {
  anchorMs: number;
  mu: number;
  paramsByQuantile: Map<number, [number, number, number]>;
  bLow: number;
  bMed: number;
  bHigh: number;
}

function qrTimeX(ts: number, anchorMs: number, mu: number): number {
  const days = Math.max(1, (ts - anchorMs) / DAY_MS);
  return Math.log(days) - mu;
}

function fitQuantileReg(
  x: Float64Array,
  y: Float64Array,
  tau: number,
  maxIter = 60,
): { intercept: number; slope: number } {
  let { intercept, slope } = fitOLS(x, y);
  const n = x.length;
  const w = new Float64Array(n);
  const eps = 1e-6;
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      const r = y[i] - intercept - slope * x[i];
      const absr = Math.max(Math.abs(r), eps);
      w[i] = (r >= 0 ? tau : 1 - tau) / absr;
    }
    const next = fitWLS(x, y, w);
    const delta = Math.abs(next.intercept - intercept) + Math.abs(next.slope - slope);
    intercept = next.intercept;
    slope = next.slope;
    if (delta < 1e-8) break;
  }
  return { intercept, slope };
}

function checkLoss(residuals: Float64Array, tau: number): number {
  let total = 0;
  for (let i = 0; i < residuals.length; i++) {
    const r = residuals[i];
    total += r * (r >= 0 ? tau : tau - 1);
  }
  return total;
}

function fitAsymmetricQuantileBands(prices: PricePoint[]): AsymmetricQuantileFit {
  const cacheKey = `${prices.length}:${prices[0]?.ts}:${prices[prices.length - 1]?.ts}`;
  if (asymFitCache && asymFitCacheKey === cacheKey) return asymFitCache;

  const anchorMs = QR_GENESIS_MS;
  const n = prices.length;
  const xRaw = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xRaw[i] = qrTimeX(prices[i].ts, anchorMs, 0);
    y[i] = Math.log10(prices[i].price);
  }
  let mu = 0;
  for (let i = 0; i < n; i++) mu += xRaw[i];
  mu /= n;
  const x = new Float64Array(n);
  const x2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = xRaw[i] - mu;
    x2[i] = x[i] * x[i];
  }

  const fitGroup = (
    taus: readonly number[],
    b: number,
  ): { loss: number; params: Map<number, [number, number, number]> } => {
    const yb = new Float64Array(n);
    for (let i = 0; i < n; i++) yb[i] = y[i] - b * x2[i];
    let loss = 0;
    const params = new Map<number, [number, number, number]>();
    for (const tau of taus) {
      const { intercept: c, slope: a } = fitQuantileReg(x, yb, tau, 30);
      params.set(tau, [c, a, b]);
      const resid = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        resid[i] = y[i] - (c + a * x[i] + b * x2[i]);
      }
      loss += checkLoss(resid, tau);
    }
    return { loss, params };
  };

  const objective = (bvec: Float64Array): number =>
    fitGroup(QR_LOWER_TAUS, bvec[0]).loss
    + fitGroup(QR_MEDIAN_TAUS, bvec[1]).loss
    + fitGroup(QR_UPPER_TAUS, bvec[2]).loss;

  const bOpt = nelderMeadSimplex(
    objective,
    new Float64Array(QR_SEED_CURVATURE),
    { maxIter: ASYM_NM_MAX_ITER, xatol: 1e-3, fatol: 1e-4 },
  );

  const paramsByQuantile = new Map<number, [number, number, number]>();
  for (const [taus, b] of [
    [QR_LOWER_TAUS, bOpt[0]],
    [QR_MEDIAN_TAUS, bOpt[1]],
    [QR_UPPER_TAUS, bOpt[2]],
  ] as const) {
    fitGroup(taus, b).params.forEach((v, k) => paramsByQuantile.set(k, v));
  }

  const fit: AsymmetricQuantileFit = {
    anchorMs,
    mu,
    paramsByQuantile,
    bLow: bOpt[0],
    bMed: bOpt[1],
    bHigh: bOpt[2],
  };
  asymFitCacheKey = cacheKey;
  asymFitCache = fit;
  return fit;
}

function asymmetricPricesAt(
  fit: AsymmetricQuantileFit,
  ts: number,
  quantiles: readonly number[],
): Map<number, number> {
  const x = qrTimeX(ts, fit.anchorMs, fit.mu);
  const raw = quantiles.map((q) => {
    const params = fit.paramsByQuantile.get(q);
    if (!params) return NaN;
    const [c, a, b] = params;
    return 10 ** (c + a * x + b * x * x);
  });
  const sorted = [...raw].sort((a, b) => a - b);
  const out = new Map<number, number>();
  quantiles.forEach((q, i) => out.set(q, sorted[i]));
  return out;
}

function lerp(a: number, b: number, t: number): number {
  const w = clamp(t, 0, 1);
  return a + w * (b - a);
}

function qrTailRampFactor(
  ts: number,
  endScale: number,
  cfg: Required<CQMConfig>,
): number {
  const rampStart = new Date(cfg.qrScaleRampStartDate).getTime();
  const cal = new Date(cfg.qrCalibrationDate).getTime();
  if (ts < rampStart) return 1;
  if (ts >= cal) return endScale;
  const span = Math.max(cal - rampStart, DAY_MS);
  const progress = ((ts - rampStart) / span) ** cfg.qrScaleRampPower;
  return lerp(1, endScale, progress);
}

function rollingMean(values: Float64Array, window: number, minPeriods: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    const count = i - start + 1;
    if (count < minPeriods) {
      out[i] = NaN;
      continue;
    }
    let sum = 0;
    for (let j = start; j <= i; j++) sum += values[j];
    out[i] = sum / count;
  }
  return out;
}

/** Tail-scaled asymmetric QR 0.1% / 50% / 99.9% (uniform scale on all quantiles). */
function buildScaledQrBands(
  asymFit: AsymmetricQuantileFit,
  cleaned: PricePoint[],
  cfg: Required<CQMConfig>,
): { qrLow: Float64Array; qrMed: Float64Array; qrHigh: Float64Array } {
  const n = cleaned.length;
  const rawLow = new Float64Array(n);
  const rawMed = new Float64Array(n);
  const rawHigh = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const bands = asymmetricPricesAt(asymFit, cleaned[i].ts, QR_FAN_QUANTILES);
    rawLow[i] = bands.get(0.001) ?? NaN;
    rawMed[i] = bands.get(0.5) ?? NaN;
    rawHigh[i] = bands.get(0.999) ?? NaN;
  }

  const calTs = new Date(cfg.qrCalibrationDate).getTime();
  let calIdx = n - 1;
  for (let i = 0; i < n; i++) {
    if (cleaned[i].ts <= calTs) calIdx = i;
  }
  const endScale = cfg.qrCalibrationMedianUsd / rawMed[calIdx];

  const qrLow = new Float64Array(n);
  const qrMed = new Float64Array(n);
  const qrHigh = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ts = cleaned[i].ts;
    const tailScale = qrTailRampFactor(ts, endScale, cfg);
    qrLow[i] = rawLow[i] * tailScale;
    qrMed[i] = rawMed[i] * tailScale;
    qrHigh[i] = rawHigh[i] * tailScale;
  }
  return { qrLow, qrMed, qrHigh };
}

function buildFairValueGold(
  logPrice: Float64Array,
  qrMed: Float64Array,
  blendWeight: number,
  smaWeeks: number,
): Float64Array {
  const n = logPrice.length;
  const w = clamp(blendWeight, 0, 1);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(qrMed[i]) || qrMed[i] <= 0) {
      raw[i] = NaN;
      continue;
    }
    raw[i] = Math.exp(w * logPrice[i] + (1 - w) * Math.log(qrMed[i]));
  }
  const smaDays = Math.max(smaWeeks * 7, 1);
  const minPeriods = Math.max(Math.floor(smaDays / 4), 30);
  return rollingMean(raw, smaDays, minPeriods);
}

function nelderMeadSimplex(
  fn: (x: Float64Array) => number,
  x0: Float64Array,
  opts: { maxIter: number; xatol: number; fatol: number },
): Float64Array {
  const n = x0.length;
  const alpha = 1;
  const gamma = 2;
  const rho = 0.5;
  const sigma = 0.5;
  const simplex: Float64Array[] = [new Float64Array(x0)];
  for (let i = 0; i < n; i++) {
    const p = new Float64Array(x0);
    p[i] += Math.abs(p[i]) > 1e-6 ? 0.05 * p[i] : 0.05;
    simplex.push(p);
  }
  const f = simplex.map(fn);
  for (let iter = 0; iter < opts.maxIter; iter++) {
    const order = simplex.map((_, i) => i).sort((a, b) => f[a] - f[b]);
    const best = order[0];
    const worst = order[n];
    const secondWorst = order[n - 1];
    const xCent = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) xCent[k] += simplex[order[j]][k];
    }
    for (let k = 0; k < n; k++) xCent[k] /= n;
    const fr = f[worst];
    let maxDiff = 0;
    for (let k = 0; k < n; k++) {
      maxDiff = Math.max(maxDiff, Math.abs(simplex[worst][k] - simplex[best][k]));
    }
    if (maxDiff < opts.xatol && Math.abs(fr - f[best]) < opts.fatol) {
      break;
    }
    const xr = new Float64Array(n);
    for (let k = 0; k < n; k++) xr[k] = xCent[k] + alpha * (xCent[k] - simplex[worst][k]);
    const fxr = fn(xr);
    if (fxr < f[secondWorst] && fxr >= f[best]) {
      simplex[worst] = xr;
      f[worst] = fxr;
      continue;
    }
    if (fxr < f[best]) {
      const xe = new Float64Array(n);
      for (let k = 0; k < n; k++) xe[k] = xCent[k] + gamma * (xr[k] - xCent[k]);
      const fxe = fn(xe);
      if (fxe < fxr) {
        simplex[worst] = xe;
        f[worst] = fxe;
      } else {
        simplex[worst] = xr;
        f[worst] = fxr;
      }
      continue;
    }
    const xc = new Float64Array(n);
    const useXr = fxr < fr;
    for (let k = 0; k < n; k++) {
      xc[k] = useXr
        ? xCent[k] + rho * (xr[k] - xCent[k])
        : xCent[k] - rho * (xCent[k] - simplex[worst][k]);
    }
    const fxc = fn(xc);
    if (fxc < fr) {
      simplex[worst] = xc;
      f[worst] = fxc;
      continue;
    }
    for (let j = 1; j <= n; j++) {
      const p = simplex[j];
      for (let k = 0; k < n; k++) {
        p[k] = simplex[best][k] + sigma * (p[k] - simplex[best][k]);
      }
      f[j] = fn(p);
    }
  }
  let bestIdx = 0;
  for (let i = 1; i <= n; i++) {
    if (f[i] < f[bestIdx]) bestIdx = i;
  }
  return simplex[bestIdx];
}

function interpolateCycleKnot(
  ts: number,
  endTs: number,
  startValue: number,
  value2018: number,
  value2022: number,
  currentValue: number,
): number {
  const knots = [
    { ts: new Date('2014-01-01').getTime(), value: startValue },
    { ts: new Date('2018-01-01').getTime(), value: value2018 },
    { ts: new Date('2022-01-01').getTime(), value: value2022 },
    { ts: endTs, value: currentValue },
  ];
  if (ts <= knots[0].ts) return knots[0].value;

  for (let i = 1; i < knots.length; i++) {
    const previous = knots[i - 1];
    const next = knots[i];
    if (ts <= next.ts) {
      const span = Math.max(next.ts - previous.ts, DAY_MS);
      const progress = (ts - previous.ts) / span;
      return previous.value + progress * (next.value - previous.value);
    }
  }

  return knots[knots.length - 1].value;
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

  // Asymmetric QR fan: fit on full BTC history (pre-2014 included) so the
  // compressing-upper tail curvature is learned from the 2011–2013 phase.
  const asymInput: PricePoint[] = [];
  for (const p of prices) {
    if (!Number.isFinite(p.price) || p.price <= 0) continue;
    asymInput.push(p);
  }
  asymInput.sort((a, b) => a.ts - b.ts);
  let asymFit: AsymmetricQuantileFit | null = null;
  if (asymInput.length >= 365) {
    try {
      asymFit = fitAsymmetricQuantileBands(asymInput);
    } catch {
      asymFit = null;
    }
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

  const rollingAth = new Float64Array(n);
  let runningMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (cleaned[i].price > runningMax) runningMax = cleaned[i].price;
    rollingAth[i] = runningMax;
  }

  const priceArr = new Float64Array(n);
  for (let i = 0; i < n; i++) priceArr[i] = cleaned[i].price;
  const minPeriods = Math.max(Math.floor(cfg.trendRiskWindow / 4), 10);
  const trLower = rollingQuantile(priceArr, cfg.trendRiskWindow, cfg.trendRiskLowQ, minPeriods);
  const trMedian = rollingQuantile(priceArr, cfg.trendRiskWindow, 0.5, minPeriods);
  const trUpper = rollingQuantile(priceArr, cfg.trendRiskWindow, cfg.trendRiskHighQ, minPeriods);

  let scaledQrLow = new Float64Array(n);
  let scaledQrMed = new Float64Array(n);
  let scaledQrHigh = new Float64Array(n);
  if (asymFit) {
    const scaled = buildScaledQrBands(asymFit, cleaned, cfg);
    scaledQrLow.set(scaled.qrLow);
    scaledQrMed.set(scaled.qrMed);
    scaledQrHigh.set(scaled.qrHigh);
  } else {
    for (let i = 0; i < n; i++) {
      const med = Math.exp(qr.intercept + qr.slope * x[i]);
      scaledQrMed[i] = med;
      scaledQrLow[i] = med;
      scaledQrHigh[i] = med;
    }
  }

  const fairGold = buildFairValueGold(
    logPrice,
    scaledQrMed,
    cfg.fairBlendPriceWeight,
    cfg.fairGoldSmaWeeks,
  );

  const fairResiduals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const fairLevel = cfg.riskFairDriver === 'gold'
      ? fairGold[i]
      : scaledQrMed[i];
    if (!Number.isFinite(fairLevel) || fairLevel <= 0) {
      fairResiduals[i] = NaN;
      continue;
    }
    fairResiduals[i] = logPrice[i] - Math.log(fairLevel);
  }
  const fairValid: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(fairResiduals[i])) fairValid.push(fairResiduals[i]);
  }
  fairValid.sort((a, b) => a - b);
  const sortedFairResiduals = new Float64Array(fairValid);

  const computeRollingMin = (window: number): Float64Array => {
    const W = Math.max(1, window);
    const out = new Float64Array(n);
    const deque: number[] = [];
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

  const rollMinPeriods = Math.max(Math.floor(cfg.riskRollDays / 4), 30);
  const rollingPct =
    cfg.riskMode === 'global'
      ? null
      : rollingEmpiricalPercentile(fairResiduals, cfg.riskRollDays, rollMinPeriods);
  const nearLowMin =
    cfg.riskMode === 'gated'
      ? computeRollingMin(cfg.riskGateNearDays)
      : null;

  const solidGreenWarmupOffset = empiricalQuantile(sortedQr, 0.001);
  const endTs = cleaned[n - 1].ts;
  const latestPct = empiricalPercentile(sortedFairResiduals, fairResiduals[n - 1]);
  const latestLinearRisk = clamp(
    (latestPct - cfg.lowQ) / (cfg.highQ - cfg.lowQ),
    0,
    1,
  );
  const latestSoftZ = clamp(
    (latestPct - cfg.lowQ) / (cfg.highQ - cfg.lowQ),
    0,
    1,
  );
  const riskGammaCurrent =
    latestLinearRisk > 0 &&
    latestLinearRisk < 1 &&
    latestSoftZ > 0 &&
    latestSoftZ < 1
      ? Math.log(latestLinearRisk) / Math.log(latestSoftZ)
      : 1.0;

  // Build the daily signal series
  const signals: CQMPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const trendOls = Math.exp(ols.intercept + ols.slope * x[i]);
    const qrMedian = scaledQrMed[i];
    const solidLower = scaledQrLow[i];
    const solidMedian = Number.isFinite(fairGold[i]) ? fairGold[i] : qrMedian;
    const solidUpper = scaledQrHigh[i];
    const qrDashedLow = scaledQrLow[i];
    const qrDashedMedian = scaledQrMed[i];
    const qrDashedHigh = scaledQrHigh[i];

    const pct = Number.isFinite(fairResiduals[i])
      ? empiricalPercentile(sortedFairResiduals, fairResiduals[i])
      : 0.5;
    let risk = riskFromPercentile(pct, cleaned[i].ts, endTs, cfg, riskGammaCurrent);

    if (rollingPct !== null && Number.isFinite(rollingPct[i])) {
      const rollingRisk = riskFromPercentile(
        rollingPct[i],
        cleaned[i].ts,
        endTs,
        cfg,
        riskGammaCurrent,
      );
      if (cfg.riskMode === 'rolling') {
        risk = rollingRisk;
      } else if (cfg.riskMode === 'gated' && nearLowMin !== null) {
        const gateWeight = computeGateBlendWeight(cleaned[i].price, nearLowMin[i], cfg);
        if (gateWeight > 0) {
          risk = applySoftGatedRisk(risk, rollingRisk, gateWeight, cfg);
        }
      }
    }

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
      qrDashedLow,
      qrDashedMedian,
      qrDashedHigh,
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
    riskGammaStart: cfg.riskGammaStart,
    riskGamma2018: cfg.riskGamma2018,
    riskGamma2022: cfg.riskGamma2022,
    riskGammaCurrent,
    riskHighQuantileStart: cfg.riskHighQuantileStart,
    riskHighQuantile2018: cfg.riskHighQuantile2018,
    riskHighQuantile2022: cfg.riskHighQuantile2022,
    sortedOlsResiduals: sortedOls,
    sortedQrResiduals: sortedQr,
    sortedFairResiduals,
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

function riskMappingCfg(fit: CQMFit): Required<CQMConfig> {
  return {
    ...DEFAULT_CONFIG,
    lowQ: fit.lowQ,
    highQ: fit.highQ,
    scorePower: fit.scorePower,
    riskGammaStart: fit.riskGammaStart,
    riskGamma2018: fit.riskGamma2018,
    riskGamma2022: fit.riskGamma2022,
    riskHighQuantileStart: fit.riskHighQuantileStart,
    riskHighQuantile2018: fit.riskHighQuantile2018,
    riskHighQuantile2022: fit.riskHighQuantile2022,
  };
}

/** Global (ungated) fair-value risk for a hypothetical price at snapshot date. */
export function riskForPriceFair(fit: CQMFit, ts: number, price: number): number {
  const snap = snapshotAt(fit, ts);
  if (!snap || !Number.isFinite(price) || price <= 0) return NaN;
  const fair = snap.qrDashedMedian;
  if (!Number.isFinite(fair) || fair <= 0) return NaN;
  const residual = Math.log(price) - Math.log(fair);
  const pct = empiricalPercentile(fit.sortedFairResiduals, residual);
  const endTs = fit.signals[fit.signals.length - 1]?.ts ?? ts;
  return riskFromPercentile(pct, ts, endTs, riskMappingCfg(fit), fit.riskGammaCurrent);
}

/** Inverse mapping: price that would produce the given global fair-value risk. */
export function priceForRiskFair(fit: CQMFit, ts: number, risk: number): number {
  const snap = snapshotAt(fit, ts);
  if (!snap) return NaN;
  const fair = snap.qrDashedMedian;
  if (!Number.isFinite(fair) || fair <= 0) return NaN;
  const clamped = clamp(risk, 0, 1);
  const cfg = riskMappingCfg(fit);
  const endTs = fit.signals[fit.signals.length - 1]?.ts ?? ts;
  const riskHighQ = interpolateCycleKnot(
    ts,
    endTs,
    cfg.riskHighQuantileStart,
    cfg.riskHighQuantile2018,
    cfg.riskHighQuantile2022,
    cfg.highQ,
  );
  const riskGamma = interpolateCycleKnot(
    ts,
    endTs,
    cfg.riskGammaStart,
    cfg.riskGamma2018,
    cfg.riskGamma2022,
    fit.riskGammaCurrent,
  );
  const residualQ = cfg.lowQ + Math.pow(clamped, 1 / riskGamma) * (riskHighQ - cfg.lowQ);
  const residual = empiricalQuantile(fit.sortedFairResiduals, residualQ);
  return Math.exp(Math.log(fair) + residual);
}

export interface RiskPricePoint {
  price: number;
  riskPct: number;
}

/** Risk-vs-price curve at a snapshot date (matches Python `run_eqm.py` panel 5). */
export function buildRiskPriceCurve(
  fit: CQMFit,
  ts?: number,
  numPoints = 600,
): RiskPricePoint[] {
  const targetTs = ts ?? fit.signals[fit.signals.length - 1]?.ts;
  if (!targetTs) return [];
  const snap = snapshotAt(fit, targetTs);
  if (!snap) return [];
  const pLo = priceForRiskFair(fit, targetTs, 0);
  const pHi = priceForRiskFair(fit, targetTs, 1);
  const lo = Math.max(pLo * 0.5, 1);
  const hi = pHi * 1.1;
  const out: RiskPricePoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const t = numPoints <= 1 ? 0 : i / (numPoints - 1);
    const price = lo + t * (hi - lo);
    const risk = riskForPriceFair(fit, targetTs, price);
    out.push({ price, riskPct: risk * 100 });
  }
  return out;
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
    qrDashedLow: target.qrDashedLow,
    qrDashedMedian: target.qrDashedMedian,
    qrDashedHigh: target.qrDashedHigh,
    score: target.score,
    risk: target.risk,
    trendRiskLower: target.trendRiskLower,
    trendRiskMedian: target.trendRiskMedian,
    trendRiskUpper: target.trendRiskUpper,
  };
}
