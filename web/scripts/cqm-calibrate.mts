/**
 * CQM risk-mapping calibration harness (data-driven, walk-forward).
 *
 * Goal: decide — from our own objective, not from fitting BTCAnalytica — whether
 * the `highQ` / `γ` knobs in the percentile→risk mapping earn their keep, or
 * whether a cleaner mapping (identity on the valuation percentile) plus
 * co-optimised sizing thresholds does as well or better out-of-sample.
 *
 * Design
 * ------
 * 1. CAUSAL VALUATION PERCENTILE (expensive, cached):
 *    Walk forward over real BTC history. At each day t we refit `fitCQM` on
 *    history strictly before t (every `REFIT_EVERY_DAYS`) and record the raw,
 *    mapping-agnostic valuation percentile `pct(t) = empirical CDF of the
 *    fair-value log-residual`. The risk MAPPING is a cheap post-transform of
 *    `pct`, so we compute the series once and sweep mappings for free.
 *
 * 2. CANDIDATE MAPPINGS: identity, linear[lowQ,highQ], power[lowQ,highQ,γ],
 *    plus the current production baseline (linear[0.06, 0.68]).
 *
 * 3. SIZING: the canonical `computeCqmDynamicTrade` (maxCashFraction,
 *    sellThreshold). Mapping + thresholds jointly set the accumulate/hold/sell
 *    breakpoints, so we co-sweep them.
 *
 * 4. OBJECTIVE (risk-adjusted terminal wealth vs DCA):
 *      score = ln(terminalRatioVsDca) − λ_dd·maxDrawdown − λ_top·topRegret
 *    where topRegret = upside forfeited vs a never-sell twin (the "give up the
 *    top" penalty). All components are printed so trade-offs are legible.
 *
 * 5. CROSS-CYCLE VALIDATION: pick the best candidate on training windows, then
 *    report its out-of-sample score on a held-out window. With ~3 BTC cycles we
 *    favour robustness (consistency across windows) over peak in-sample fit.
 *
 * Run: CQM_CALIB=1 npx vitest run tests/cqm-calibrate.test.ts
 *      CQM_CALIB=1 CQM_CALIB_REFRESH=1 npx vitest run tests/cqm-calibrate.test.ts  (rebuild cache)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCQM, valuationPercentileFair } from '../src/utils/cqm.ts';
import {
  computeCqmDynamicTrade,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../src/utils/cqmSizing.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'output');
const CACHE_PATH = resolve(OUTPUT_DIR, 'cqm-calib-pct.json');

// --- config ---------------------------------------------------------------

const REFIT_EVERY_DAYS = 90;
const PCT_FROM_DATE = '2016-01-01'; // first date we emit a causal percentile for
const BASE = 100; // daily deposit (currency-agnostic)

// --- data load ------------------------------------------------------------

interface RawPoint { date: string; close: number; }
interface PricePoint { date: string; ts: number; price: number; }

function toTs(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function loadPoints(): PricePoint[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ date, ts: toTs(date), price: close }));
}

// --- step 1: causal valuation percentile (cached) -------------------------

interface PctPoint { date: string; price: number; pct: number; }

function cacheKey(points: PricePoint[]): string {
  const first = points[0]?.date ?? '';
  const last = points[points.length - 1]?.date ?? '';
  return `${points.length}|${first}|${last}|${PCT_FROM_DATE}|${REFIT_EVERY_DAYS}`;
}

function buildCausalPercentiles(points: PricePoint[]): PctPoint[] {
  const refresh = process.env.CQM_CALIB_REFRESH === '1';
  const key = cacheKey(points);
  if (!refresh && existsSync(CACHE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as { key: string; series: PctPoint[] };
      if (cached.key === key) return cached.series;
    } catch { /* fall through to recompute */ }
  }

  let firstIdx = points.length;
  for (let i = 0; i < points.length; i++) {
    if (points[i].date >= PCT_FROM_DATE) { firstIdx = i; break; }
  }

  const series: PctPoint[] = [];
  let fit: ReturnType<typeof fitCQM> | null = null;
  let daysSinceRefit = Infinity;
  const t0 = Date.now();

  for (let i = firstIdx; i < points.length; i++) {
    const p = points[i];
    if (daysSinceRefit >= REFIT_EVERY_DAYS && i >= 365) {
      try {
        fit = fitCQM(points.slice(0, i));
        daysSinceRefit = 0;
      } catch {
        daysSinceRefit = 0;
      }
    }
    daysSinceRefit += 1;
    if (!fit) continue;
    const pct = valuationPercentileFair(fit, p.ts, p.price);
    if (!Number.isFinite(pct)) continue;
    series.push({ date: p.date, price: p.price, pct });
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify({ key, series }), 'utf-8');
  console.log(`Built causal percentile series: ${series.length} days in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return series;
}

// --- step 2: candidate risk mappings --------------------------------------

type RiskMapping = { label: string; family: 'identity' | 'linear' | 'power'; map: (pct: number) => number };

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

function makeMapping(family: 'identity' | 'linear' | 'power', lowQ: number, highQ: number, gamma: number): RiskMapping {
  if (family === 'identity') {
    return { label: 'identity(pct)', family, map: (pct) => clamp01(pct) };
  }
  const span = Math.max(1e-6, highQ - lowQ);
  if (family === 'linear') {
    return {
      label: `linear[${lowQ.toFixed(2)},${highQ.toFixed(2)}]`,
      family,
      map: (pct) => clamp01((pct - lowQ) / span),
    };
  }
  return {
    label: `power[${lowQ.toFixed(2)},${highQ.toFixed(2)},γ${gamma.toFixed(2)}]`,
    family,
    map: (pct) => Math.pow(clamp01((pct - lowQ) / span), gamma),
  };
}

// --- step 3+4: simulation + objective -------------------------------------

interface SimMetrics {
  terminalRatio: number; // bot terminal value / DCA terminal value
  maxDrawdown: number;   // peak-to-trough on (value / deposited)
  topRegret: number;     // upside forfeited vs never-sell twin (0..1)
  finalBtc: number;
  finalCashFrac: number; // leftover cash / final portfolio value
}

interface SizingParams { maxCashFraction: number; sellThreshold: number; }

function simulate(
  window: PctPoint[],
  mapping: RiskMapping,
  sizing: SizingParams,
  sellEnabled: boolean,
): { terminalValue: number; deposited: number; btc: number; cash: number; maxDrawdown: number } {
  let cash = 0;
  let btc = 0;
  let deposited = 0;
  let peakRatio = -Infinity;
  let maxDrawdown = 0;

  for (const d of window) {
    cash += BASE;
    deposited += BASE;
    const risk = mapping.map(d.pct);
    const { buyAmount, sellAmount } = computeCqmDynamicTrade({
      baseAmount: BASE,
      risk,
      cashBalance: cash,
      btcHeld: btc,
      btcPrice: d.price,
      maxCashFraction: sizing.maxCashFraction,
      sellThreshold: sellEnabled ? sizing.sellThreshold : 1, // 1 ⇒ never sells
    });
    if (buyAmount > 0) {
      const spend = Math.min(buyAmount, cash);
      btc += spend / d.price;
      cash -= spend;
    } else if (sellAmount > 0) {
      const btcValue = btc * d.price;
      const sellUsd = Math.min(sellAmount, btcValue);
      btc -= sellUsd / d.price;
      cash += sellUsd;
    }
    const value = btc * d.price + cash;
    const ratio = value / deposited;
    if (ratio > peakRatio) peakRatio = ratio;
    if (peakRatio > 0) maxDrawdown = Math.max(maxDrawdown, (peakRatio - ratio) / peakRatio);
  }

  const last = window[window.length - 1];
  return { terminalValue: btc * last.price + cash, deposited, btc, cash, maxDrawdown };
}

function simulateDca(window: PctPoint[]): number {
  let btc = 0;
  for (const d of window) btc += BASE / d.price;
  return btc * window[window.length - 1].price;
}

function evaluate(window: PctPoint[], mapping: RiskMapping, sizing: SizingParams): SimMetrics {
  const bot = simulate(window, mapping, sizing, true);
  const hold = simulate(window, mapping, sizing, false);
  const dca = simulateDca(window);
  const terminalRatio = dca > 0 ? bot.terminalValue / dca : 1;
  const topRegret = hold.terminalValue > 0
    ? Math.max(0, (hold.terminalValue - bot.terminalValue) / hold.terminalValue)
    : 0;
  return {
    terminalRatio,
    maxDrawdown: bot.maxDrawdown,
    topRegret,
    finalBtc: bot.btc,
    finalCashFrac: bot.terminalValue > 0 ? bot.cash / bot.terminalValue : 0,
  };
}

const LAMBDA_DD = 0.5;   // drawdown aversion
const LAMBDA_TOP = 0.5;  // give-up-the-top aversion

function score(m: SimMetrics): number {
  return Math.log(Math.max(1e-6, m.terminalRatio)) - LAMBDA_DD * m.maxDrawdown - LAMBDA_TOP * m.topRegret;
}

// --- windows / cycles -----------------------------------------------------

interface Window { label: string; start: string; end: string; group: 'A' | 'B' | 'C'; }

// Cycle-ish windows: each spans an accumulation→euphoria→drawdown arc so the
// objective sees both the sell discipline and the give-up-the-top risk.
const WINDOWS: Window[] = [
  { label: '2016→2019 (cycle A)', start: '2016-01-01', end: '2019-12-31', group: 'A' },
  { label: '2019→2023 (cycle B)', start: '2019-01-01', end: '2023-01-31', group: 'B' },
  { label: '2023→now  (cycle C)', start: '2023-01-01', end: '2026-06-12', group: 'C' },
];

function sliceWindow(series: PctPoint[], w: Window): PctPoint[] {
  return series.filter((p) => p.date >= w.start && p.date <= w.end);
}

// --- candidate grid -------------------------------------------------------

function buildCandidates(): { mapping: RiskMapping; sizing: SizingParams }[] {
  const out: { mapping: RiskMapping; sizing: SizingParams }[] = [];
  const sells = [0.6, 0.7, 0.75, 0.85];
  const cashFracs = [0.04, 0.06, 0.08];

  const mappings: RiskMapping[] = [];
  // Clean / data-driven: identity on the percentile.
  mappings.push(makeMapping('identity', 0, 1, 1));
  // Linear with free anchors.
  for (const lowQ of [0.0, 0.06, 0.1]) {
    for (const highQ of [0.5, 0.6, 0.68, 0.8, 0.9, 1.0]) {
      if (highQ - lowQ < 0.2) continue;
      mappings.push(makeMapping('linear', lowQ, highQ, 1));
    }
  }
  // Power with curvature.
  for (const lowQ of [0.0, 0.06]) {
    for (const highQ of [0.6, 0.68, 0.8, 1.0]) {
      for (const gamma of [0.7, 1.5]) {
        mappings.push(makeMapping('power', lowQ, highQ, gamma));
      }
    }
  }

  for (const mapping of mappings) {
    for (const sellThreshold of sells) {
      for (const maxCashFraction of cashFracs) {
        out.push({ mapping, sizing: { maxCashFraction, sellThreshold } });
      }
    }
  }
  return out;
}

function familyOf(label: string): 'identity' | 'linear' | 'power' {
  if (label.startsWith('identity')) return 'identity';
  if (label.startsWith('linear')) return 'linear';
  return 'power';
}

// --- main run -------------------------------------------------------------

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function runCqmCalibration() {
  const points = loadPoints();
  const series = buildCausalPercentiles(points);
  const candidates = buildCandidates();

  const windowSlices = WINDOWS.map((w) => ({ w, slice: sliceWindow(series, w) }));
  for (const { w, slice } of windowSlices) {
    if (slice.length < 200) console.log(`WARN window ${w.label} has only ${slice.length} days`);
  }

  interface Row {
    label: string;
    sell: number;
    cash: number;
    perWindow: { group: string; score: number; ratio: number; dd: number; top: number }[];
    meanScore: number;
    robustScore: number; // mean − 0.5·std (consistency-aware)
  }

  const rows: Row[] = [];
  for (const c of candidates) {
    const per = windowSlices.map(({ w, slice }) => {
      const m = evaluate(slice, c.mapping, c.sizing);
      return { group: w.group, score: score(m), ratio: m.terminalRatio, dd: m.maxDrawdown, top: m.topRegret };
    });
    const scores = per.map((p) => p.score);
    rows.push({
      label: c.mapping.label,
      sell: c.sizing.sellThreshold,
      cash: c.sizing.maxCashFraction,
      perWindow: per,
      meanScore: mean(scores),
      robustScore: mean(scores) - 0.5 * std(scores),
    });
  }

  rows.sort((a, b) => b.robustScore - a.robustScore);

  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtRow = (r: Row) => {
    const w = r.perWindow
      .map((p) => `${p.group}:x${p.ratio.toFixed(2)}/DD${(p.dd * 100).toFixed(0)}/top${(p.top * 100).toFixed(0)}`)
      .join('  ');
    return `${r.label.padEnd(24)} sell>${fmtPct(r.sell).padStart(5)} cash${fmtPct(r.cash).padStart(4)} | ` +
      `robust ${r.robustScore.toFixed(3)} mean ${r.meanScore.toFixed(3)} | ${w}`;
  };

  console.log(`\n=== CQM mapping calibration (λ_dd=${LAMBDA_DD}, λ_top=${LAMBDA_TOP}) ===`);
  console.log('Per-window: x<terminal vs DCA> / DD<max drawdown %> / top<give-up-the-top %>\n');

  console.log('--- Top 20 candidates by robust score (mean − 0.5·std across cycles) ---');
  for (const r of rows.slice(0, 20)) console.log('  ' + fmtRow(r));

  // Baseline (current production: linear[0.06,0.68], sell 0.75, cash 6%).
  const baseline = rows.find((r) =>
    r.label === 'linear[0.06,0.68]' &&
    Math.abs(r.sell - CQM_DEFAULT_SELL_THRESHOLD) < 1e-9 &&
    Math.abs(r.cash - CQM_DEFAULT_MAX_CASH_FRACTION) < 1e-9);
  console.log('\n--- Current production baseline ---');
  if (baseline) console.log('  ' + fmtRow(baseline));
  else console.log('  (baseline combo not in grid)');

  // Best per family — the crux: does identity match the best tuned highQ/γ?
  console.log('\n--- Best candidate per mapping family ---');
  for (const fam of ['identity', 'linear', 'power'] as const) {
    const best = rows.find((r) => familyOf(r.label) === fam);
    if (best) console.log(`  ${fam.padEnd(9)} ` + fmtRow(best));
  }

  // Cross-cycle: train on A+B, test on C (and train on B+C, test on A).
  const trainTest = (trainGroups: string[], testGroup: string) => {
    const ranked = [...rows].sort((a, b) => {
      const sa = mean(a.perWindow.filter((p) => trainGroups.includes(p.group)).map((p) => p.score));
      const sb = mean(b.perWindow.filter((p) => trainGroups.includes(p.group)).map((p) => p.score));
      return sb - sa;
    });
    const best = ranked[0];
    const test = best.perWindow.find((p) => p.group === testGroup);
    const trainMean = mean(best.perWindow.filter((p) => trainGroups.includes(p.group)).map((p) => p.score));
    console.log(`  train ${trainGroups.join('+')} → ${best.label} sell>${fmtPct(best.sell)} cash${fmtPct(best.cash)} ` +
      `| train ${trainMean.toFixed(3)} | OOS ${testGroup} ${test ? test.score.toFixed(3) : 'n/a'} ` +
      `(x${test?.ratio.toFixed(2)}/DD${((test?.dd ?? 0) * 100).toFixed(0)}/top${((test?.top ?? 0) * 100).toFixed(0)})`);
  };
  console.log('\n--- Cross-cycle (out-of-sample) ---');
  trainTest(['A', 'B'], 'C');
  trainTest(['B', 'C'], 'A');
  trainTest(['A', 'C'], 'B');

  return rows;
}

// ===========================================================================
// Forward scenario stress — does the mapping hold up in the NEXT cycle?
// ===========================================================================

const SCENARIO_CACHE_PATH = resolve(OUTPUT_DIR, 'cqm-calib-scenario-pct.json');

/** Log-linear daily interpolation between (date, price) waypoints. */
function buildScenarioPath(peak: number): PricePoint[] {
  // Pre-markup path is fixed (independent of the eventual top); only the
  // 2028→2029 markup and post-peak decline scale with `peak`.
  const wp: [string, number][] = [
    ['2026-06-12', 63543],
    ['2026-10-01', 52000],   // summer-2026 washout
    ['2027-06-30', 70000],   // base building
    ['2027-12-31', 95000],   // pre-halving reclaim
    ['2028-04-15', Math.max(95000, 0.45 * peak)], // halving markup begins
    ['2028-12-31', 0.65 * peak],
    ['2029-06-30', 0.9 * peak],
    ['2029-10-15', peak],    // cycle peak
    ['2030-03-31', 0.7 * peak],
    ['2030-09-30', 0.5 * peak], // post-peak bear
  ];
  const out: PricePoint[] = [];
  for (let k = 0; k < wp.length - 1; k++) {
    const [d0, p0] = wp[k];
    const [d1, p1] = wp[k + 1];
    const t0 = toTs(d0);
    const t1 = toTs(d1);
    const lp0 = Math.log(p0);
    const lp1 = Math.log(p1);
    for (let t = t0; t < t1; t += 86_400_000) {
      const frac = (t - t0) / (t1 - t0);
      const price = Math.exp(lp0 + frac * (lp1 - lp0));
      out.push({ date: new Date(t).toISOString().slice(0, 10), ts: t, price });
    }
  }
  const [dl, pl] = wp[wp.length - 1];
  out.push({ date: dl, ts: toTs(dl), price: pl });
  return out;
}

/**
 * Causal forward percentile along a synthetic path: refit `fitCQM` on
 * real-history + synthetic-realized-so-far every REFIT_EVERY_DAYS, exactly as
 * the live bot would, and read the in-sample valuation percentile each day.
 */
function buildScenarioPercentiles(history: PricePoint[], path: PricePoint[]): PctPoint[] {
  const series: PctPoint[] = [];
  const combined = [...history];
  let fit = fitCQM(combined);
  let daysSinceRefit = 0;
  for (const p of path) {
    combined.push(p);
    daysSinceRefit += 1;
    if (daysSinceRefit >= REFIT_EVERY_DAYS) {
      try { fit = fitCQM(combined); } catch { /* keep prior fit */ }
      daysSinceRefit = 0;
    }
    const pct = valuationPercentileFair(fit, p.ts, p.price);
    if (Number.isFinite(pct)) series.push({ date: p.date, price: p.price, pct });
  }
  return series;
}

interface Scenario { label: string; peak: number; }

const SCENARIOS: Scenario[] = [
  { label: 'compressed top $150k (central prior)', peak: 150_000 },
  { label: 'base top      $225k', peak: 225_000 },
  { label: 'larger top    $350k', peak: 350_000 },
];

// Finalist mappings to compare head-to-head on the forward paths.
const FINALISTS: { mapping: RiskMapping; sizing: SizingParams }[] = [
  { mapping: makeMapping('identity', 0, 1, 1), sizing: { maxCashFraction: 0.08, sellThreshold: 0.85 } },
  { mapping: makeMapping('identity', 0, 1, 1), sizing: { maxCashFraction: 0.06, sellThreshold: 0.75 } },
  { mapping: makeMapping('linear', 0.06, 0.90, 1), sizing: { maxCashFraction: 0.06, sellThreshold: 0.80 } },
  { mapping: makeMapping('linear', 0.06, 0.68, 1), sizing: { maxCashFraction: 0.06, sellThreshold: 0.75 } }, // current prod
];

export function runCqmScenarioStress() {
  const points = loadPoints();
  const refresh = process.env.CQM_CALIB_REFRESH === '1';

  let cache: Record<string, PctPoint[]> = {};
  if (!refresh && existsSync(SCENARIO_CACHE_PATH)) {
    try { cache = JSON.parse(readFileSync(SCENARIO_CACHE_PATH, 'utf-8')); } catch { cache = {}; }
  }

  console.log('\n=== Forward scenario stress (live-style refit along synthetic next cycle) ===');
  console.log('Per mapping: x<terminal vs DCA> / DD<max drawdown %> / top<give-up-the-top %> / maxR<peak risk reached>\n');

  for (const sc of SCENARIOS) {
    const key = `${points.length}|${points[points.length - 1]?.date}|peak${sc.peak}|refit${REFIT_EVERY_DAYS}`;
    let series = cache[key];
    if (!series) {
      const path = buildScenarioPath(sc.peak);
      const t0 = Date.now();
      series = buildScenarioPercentiles(points, path);
      cache[key] = series;
      console.log(`[${sc.label}] built ${series.length}d forward pct in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    console.log(`-- ${sc.label} --`);
    for (const f of FINALISTS) {
      const m = evaluate(series, f.mapping, f.sizing);
      let maxR = 0;
      for (const d of series) maxR = Math.max(maxR, f.mapping.map(d.pct));
      console.log(
        `  ${f.mapping.label.padEnd(22)} sell>${(f.sizing.sellThreshold * 100).toFixed(0)}% cash${(f.sizing.maxCashFraction * 100).toFixed(0)}% | ` +
        `x${m.terminalRatio.toFixed(2)} / DD${(m.maxDrawdown * 100).toFixed(0)} / top${(m.topRegret * 100).toFixed(0)} / maxR${(maxR * 100).toFixed(0)}`,
      );
    }
    console.log('');
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(SCENARIO_CACHE_PATH, JSON.stringify(cache), 'utf-8');
}
