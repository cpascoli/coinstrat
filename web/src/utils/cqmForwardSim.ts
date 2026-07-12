/**
 * Forward BTC price simulation for the CQM backtester.
 *
 * Generates a semi-random but "realistic" daily USD price path beyond the last
 * day of real history, so the simulator can be run into the future. The path is
 * constructed to satisfy the properties the model cares about:
 *
 *   1. Cyclical — a ~4-year halving cycle anchored to the cycle-low schedule
 *      (lows 2026 / 2030 / 2034) with peaks ~12-18 months after each halving
 *      (late 2029 / late 2033). The base-case peak-to-trough retracement is
 *      tuned per cycle (see RETRACEMENT) — ~50-55% then ~45-50%.
 *   2. Diminishing expected returns — cycle peaks/troughs are pinned as multiples
 *      of the QR-50% median, whose log-time parabola flattens into the future.
 *   3. Diminishing volatility — an Ornstein-Uhlenbeck noise overlay whose
 *      stationary std is seeded from recent realised swing volatility and decays
 *      slowly into the future.
 *   4. Constrained — every price stays inside a sane QR envelope. The literal QR
 *      fan collapses when its quadratic curvature is extrapolated years past the
 *      data, so beyond history we hold the fan's log-width fixed at its last
 *      in-sample value (`projectForwardBands`) rather than letting it implode.
 *
 * Re-rolling with a different `seed` keeps the same base-case cycle shape but
 * draws different noise. This is illustrative scenario generation, NOT a forecast.
 */
import { projectBandsAt, type CQMFit, type ProjectedBands } from './cqm';

const DAY_MS = 86_400_000;

export interface ForwardSimPoint {
  date: string;
  ts: number;
  price: number;
}

export interface ForwardSimConfig {
  /** Inclusive end date of the simulation (YYYY-MM-DD). */
  endDate: string;
  /** PRNG seed — change it to re-roll a different path. */
  seed: number;
  /** Override the OU stationary std (log swing); defaults to recent realised vol. */
  swingStd?: number;
}

// --- cycle structure -------------------------------------------------------
// Two forward cycles. The opening low is the 2026 bottom; each cycle then has a
// peak followed by a trough. Peaks are absolute USD prices drawn (per re-roll)
// from a range, and the following retracement is correlated with how bullish the
// peak came out — a more bullish cycle gives back a bit more, a moderate/bearish
// cycle retraces more shallowly.
const OPENING_LOW_DATE = '2026-09-30';
const PEAK_DATES = ['2029-10-01', '2033-12-15'] as const; // Sep/Oct 2029, end 2033
const TROUGH_DATES = ['2030-12-31', '2034-12-31'] as const; // end 2030, end 2034

// Visible-high target ranges (USD): bullishness u∈[0,1] interpolates within them.
// Centreline peaks are set a touch below the visible targets because OU noise
// lifts the realised (charted) high a little above the centreline.
const PEAK_RANGE: Array<[number, number]> = [
  [175_000, 380_000], // 2029 peak → visible ~$200k–$450k
  [430_000, 850_000], // 2033 peak → visible ~$500k–$1.0M
];
// Centreline peak-to-trough retracements, correlated with the same bullishness
// draw. Set a few points below the visible targets (OU inflates the realised
// peak-to-trough) so the charted swing lands at:
//   cycle 1 (2029→2030): ~40–50%   ·   cycle 2 (2033→2034): ~35–45%
const RETRACE_RANGE: Array<[number, number]> = [
  [0.265, 0.385],
  [0.245, 0.365],
];
// The opening 2026 low, as a multiple of its median (we start near it).
const FIRST_LOW_MEDIAN_MULTIPLE = 0.6;
// Soft guardrail half-width (log) around the cyclical centreline. The path is
// kept inside max(frozen QR fan, centreline ± this), so the model band binds
// where it is wider but deep/bullish cycles aren't clipped by an over-narrow
// extrapolated fan.
const GUARD_LOG_MARGIN = 0.55;

// OU noise overlay (mean-reverting log deviation around the cyclical centre).
const OU_PHI = 0.94; // persistence (~2-3 week swings)
const SWING_STD_FALLBACK = 0.14; // used if realised vol can't be measured
const SWING_STD_MIN = 0.05;
const SWING_STD_MAX = 0.6;
// Volatility decay into the future: stationary std × exp(-k · yearsFromStart).
const VOL_DECAY_PER_YEAR = 0.08;

// --- date / numeric utils --------------------------------------------------

function toTs(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}
function toDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
function lerp(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * clamp(t, 0, 1);
}

/** Deterministic PRNG (mulberry32) → unit-interval draws. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGauss(rng: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Numerically stable softplus: log(1 + e^x). */
function softplus(x: number): number {
  return x > 30 ? x : Math.log1p(Math.exp(x));
}

/**
 * Smoothly clamp `v` into the open interval (lo, hi). The interior is virtually
 * identity (softplus saturates only near the edges), so prices never touch the
 * guardrails but can approach them.
 */
function softClamp(v: number, lo: number, hi: number): number {
  const k = Math.max((hi - lo) * 0.04, 1e-6);
  const aboveLo = lo + k * softplus((v - lo) / k);
  return hi - k * softplus((hi - aboveLo) / k);
}

/**
 * QR fan for the simulator. Inside history this is the literal model fan; beyond
 * the last in-sample day the median keeps its log-time drift but the fan's
 * log-width is frozen at its last in-sample value, so the guardrail stays wide
 * enough for realistic cycles instead of collapsing as the quadratic is
 * extrapolated. Returns null when the underlying fit has no fan.
 */
export function projectForwardBands(
  fit: CQMFit,
  ts: number,
  lastHistoryTs: number,
): ProjectedBands | null {
  const cur = projectBandsAt(fit, ts);
  if (!cur) return null;
  if (ts <= lastHistoryTs) return cur;
  const ref = projectBandsAt(fit, lastHistoryTs);
  if (!ref || ref.q50 <= 0) return cur;
  return {
    q001: cur.q50 * (ref.q001 / ref.q50),
    q50: cur.q50,
    q999: cur.q50 * (ref.q999 / ref.q50),
  };
}

interface Waypoint {
  ts: number;
  logPrice: number;
}

/** One re-roll's cycle parameters (absolute peak USD + its retracement). */
interface CycleDraw {
  peakUsd: number;
  retracement: number;
}

/**
 * Build the cyclical centreline waypoints (in log-price). Starts from the last
 * real price, dips into the opening 2026 low, then for each cycle places the
 * drawn peak followed by a trough = peak × (1 − retracement).
 */
function buildWaypoints(
  fit: CQMFit,
  startTs: number,
  startPrice: number,
  lastHistoryTs: number,
  cycles: CycleDraw[],
): Waypoint[] {
  const medAt = (ts: number): number => projectForwardBands(fit, ts, lastHistoryTs)?.q50 ?? NaN;

  const raw: Waypoint[] = [{ ts: startTs, logPrice: Math.log(startPrice) }];

  // Opening low (2026).
  const openLowTs = toTs(OPENING_LOW_DATE);
  raw.push({ ts: openLowTs, logPrice: Math.log(FIRST_LOW_MEDIAN_MULTIPLE * medAt(openLowTs)) });

  for (let i = 0; i < cycles.length; i++) {
    const peakTs = toTs(PEAK_DATES[i]);
    const troughTs = toTs(TROUGH_DATES[i]);
    raw.push({ ts: peakTs, logPrice: Math.log(cycles[i].peakUsd) });
    raw.push({ ts: troughTs, logPrice: Math.log(cycles[i].peakUsd * (1 - cycles[i].retracement)) });
  }

  return raw
    .filter((w) => Number.isFinite(w.logPrice) && (w.ts === startTs || w.ts > startTs))
    .sort((a, b) => a.ts - b.ts);
}

/** Smoothstep log-price interpolation across sorted waypoints. */
function centerLogAt(waypoints: Waypoint[], ts: number): number {
  if (ts <= waypoints[0].ts) return waypoints[0].logPrice;
  const last = waypoints[waypoints.length - 1];
  if (ts >= last.ts) return last.logPrice;
  for (let i = 1; i < waypoints.length; i++) {
    if (ts <= waypoints[i].ts) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      const t = (ts - a.ts) / (b.ts - a.ts);
      return a.logPrice + (b.logPrice - a.logPrice) * smoothstep(t);
    }
  }
  return last.logPrice;
}

/** Recent realised swing volatility: std of log(price) − log(SMA) over a window. */
function measureSwingStd(fit: CQMFit, smaDays = 30, lookbackDays = 180): number {
  const s = fit.signals;
  const n = s.length;
  if (n < smaDays + 20) return SWING_STD_FALLBACK;
  const from = Math.max(smaDays, n - lookbackDays);
  const devs: number[] = [];
  for (let i = from; i < n; i++) {
    let sum = 0;
    for (let j = i - smaDays + 1; j <= i; j++) sum += Math.log(s[j].price);
    const sma = sum / smaDays;
    devs.push(Math.log(s[i].price) - sma);
  }
  if (devs.length < 10) return SWING_STD_FALLBACK;
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
  const variance = devs.reduce((a, b) => a + (b - mean) ** 2, 0) / devs.length;
  return clamp(Math.sqrt(variance), SWING_STD_MIN, SWING_STD_MAX);
}

/**
 * Generate a forward daily price path from the day after the fit's last day
 * through `endDate` (inclusive). Returns an empty array if the fit lacks the
 * asymmetric QR fan or the window is empty.
 */
export function generateForwardPrices(fit: CQMFit, config: ForwardSimConfig): ForwardSimPoint[] {
  const lastSignal = fit.signals[fit.signals.length - 1];
  if (!lastSignal) return [];
  const startTs = lastSignal.ts;
  const endTs = toTs(config.endDate);
  if (!Number.isFinite(endTs) || endTs <= startTs) return [];
  if (!projectForwardBands(fit, startTs, startTs)) return [];

  // Draw this re-roll's cycle parameters: a bullishness u∈[0,1] per cycle sets
  // both the peak (within its range) and — correlated — the retracement (bullish
  // peaks give back a bit more; moderate/bearish cycles retrace more shallowly).
  const rng = makeRng(config.seed);
  const cycles: CycleDraw[] = PEAK_RANGE.map((peakRange, i) => {
    const u = rng();
    return { peakUsd: lerp(peakRange, u), retracement: lerp(RETRACE_RANGE[i], u) };
  });

  const waypoints = buildWaypoints(fit, startTs, lastSignal.price, startTs, cycles);
  const swingStd = config.swingStd ?? measureSwingStd(fit);
  const gauss = makeGauss(rng);

  // Seed the OU deviation so day one continues from the last real price.
  let dev = Math.log(lastSignal.price) - centerLogAt(waypoints, startTs);

  const out: ForwardSimPoint[] = [];
  for (let ts = startTs + DAY_MS; ts <= endTs; ts += DAY_MS) {
    const bands = projectForwardBands(fit, ts, startTs);
    if (!bands) break;
    const centerLog = centerLogAt(waypoints, ts);
    // Guardrail: the wider of the frozen QR fan and a channel around the
    // centreline, so deep/bullish cycles render without being clipped by an
    // over-narrow extrapolated fan, while OU spikes stay bounded.
    const logLo = Math.min(Math.log(bands.q001), centerLog - GUARD_LOG_MARGIN);
    const logHi = Math.max(Math.log(bands.q999), centerLog + GUARD_LOG_MARGIN);

    const years = (ts - startTs) / (365.25 * DAY_MS);
    const sigmaT = swingStd * Math.exp(-VOL_DECAY_PER_YEAR * years) * Math.sqrt(1 - OU_PHI * OU_PHI);
    dev = OU_PHI * dev + sigmaT * gauss();

    const logP = softClamp(centerLog + dev, logLo, logHi);
    out.push({ date: toDateStr(ts), ts, price: Math.max(Math.exp(logP), 1) });
  }

  return out;
}
