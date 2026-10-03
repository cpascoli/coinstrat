/**
 * Parameter sweep for the Hybrid EMA Trend strategy (Lab "EMA Trend DCA").
 *
 * Sweeps fast/slow EMA periods and the signal saturation scale over several
 * market timeframes (cycle tops, bottoms, halvings) using the exact same
 * engine the Lab page runs (`runBacktest` with `emaDca`), so numbers here
 * reproduce in the UI.
 *
 * Objectives reported per combo and window:
 *   - totalReturn        (% on total deposits)
 *   - maxReturnDrawdown  (on portfolio ÷ deposits equity curve)
 *   - retOverDd          (totalReturn / maxReturnDrawdown)
 *   - lnVsBaseline       ln(finalValue / baselineFinalValue) — same deposits
 *
 * Robustness ranking: mean across windows of lnVsBaseline and of retOverDd
 * rank, since a combo that only wins in one regime is curve-fitting.
 *
 * Run: npx tsx scripts/ema-sweep.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest, BacktestConfig, StrategyResult } from '../src/services/backtest.ts';
import type { SignalData } from '../src/App.tsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'output');

// --- data ------------------------------------------------------------------

interface RawPoint { date: string; close: number; }

function loadRows(): SignalData[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ Date: date, BTCUSD: close }) as unknown as SignalData);
}

const rows = loadRows();
const lastDate = rows[rows.length - 1].Date;

function argExtreme(from: string, to: string, kind: 'max' | 'min'): { date: string; price: number } {
  let best: { date: string; price: number } | null = null;
  for (const r of rows) {
    if (r.Date < from || r.Date > to) continue;
    const p = r.BTCUSD;
    if (!best || (kind === 'max' ? p > best.price : p < best.price)) {
      best = { date: r.Date, price: p };
    }
  }
  if (!best) throw new Error(`no data in [${from}, ${to}]`);
  return best;
}

// Cycle anchor dates derived from the data itself (windows are generous
// brackets around the known events).
const top2017 = argExtreme('2017-06-01', '2018-02-01', 'max');
const top2021 = argExtreme('2021-01-01', '2022-01-01', 'max');
const top2025 = argExtreme('2024-11-01', lastDate, 'max');
const bottom2015 = argExtreme('2014-06-01', '2015-12-31', 'min'); // the "2014 bear" bottom
const bottom2018 = argExtreme('2018-06-01', '2019-03-31', 'min');
const bottom2022 = argExtreme('2022-06-01', '2023-03-31', 'min');

function minusYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()))
    .toISOString().slice(0, 10);
}

interface Window { key: string; label: string; start: string; end: string; }

const WINDOWS: Window[] = [
  { key: 'last4y', label: `Last 4 years (${minusYears(lastDate, 4)} → ${lastDate})`, start: minusYears(lastDate, 4), end: lastDate },
  { key: 'halving20_24', label: 'Halving 2020 → Halving 2024 (2020-05-11 → 2024-04-20)', start: '2020-05-11', end: '2024-04-20' },
  { key: 'top17_top21', label: `2017 top → 2021 top (${top2017.date} → ${top2021.date})`, start: top2017.date, end: top2021.date },
  { key: 'top21_top25', label: `2021 top → 2025 top (${top2021.date} → ${top2025.date})`, start: top2021.date, end: top2025.date },
  { key: 'bot14_bot18', label: `2014 bottom → 2018 bottom (${bottom2015.date} → ${bottom2018.date})`, start: bottom2015.date, end: bottom2018.date },
  { key: 'bot18_bot22', label: `2018 bottom → 2022 bottom (${bottom2018.date} → ${bottom2022.date})`, start: bottom2018.date, end: bottom2022.date },
];

// --- sweep grid --------------------------------------------------------------

const FAST_PERIODS = [5, 8, 10, 12, 16, 20, 26, 30, 40, 50];
const SLOW_PERIODS = [20, 26, 30, 40, 50, 60, 80, 100, 130, 160, 200];
const SIGNAL_SCALES = [0.01, 0.02, 0.03, 0.05, 0.075, 0.10, 0.15, 0.20];

// Lab defaults: weekly $100 DCA, no cash yield.
const BASE_CONFIG: Omit<BacktestConfig, 'startDate' | 'endDate'> = {
  dcaAmount: 100,
  frequency: 'weekly',
  offSignalMode: 'pause',
  macroAccel: false,
  accelMultiplier: 3,
};

interface Combo { fast: number; slow: number; scale: number; }

const COMBOS: Combo[] = [];
for (const fast of FAST_PERIODS) {
  for (const slow of SLOW_PERIODS) {
    if (fast >= slow) continue;
    for (const scale of SIGNAL_SCALES) COMBOS.push({ fast, slow, scale });
  }
}

interface RunMetrics {
  totalReturn: number;
  maxDd: number;
  retOverDd: number;
  irr: number;
  lnVsBaseline: number;
  trades: number;
}

function pick(results: StrategyResult[], name: string): StrategyResult {
  const r = results.find((x) => x.name === name);
  if (!r) throw new Error(`strategy ${name} missing`);
  return r;
}

// --- run ---------------------------------------------------------------------

// metrics[windowKey][comboIndex]
const metrics = new Map<string, RunMetrics[]>();
const baselinePerWindow = new Map<string, { totalReturn: number; maxDd: number; irr: number }>();

for (const w of WINDOWS) {
  const perCombo: RunMetrics[] = [];
  let baselineDone = false;
  for (const c of COMBOS) {
    const results = runBacktest(rows, {
      ...BASE_CONFIG,
      startDate: w.start,
      endDate: w.end,
      emaDca: true,
      emaFastPeriod: c.fast,
      emaSlowPeriod: c.slow,
      emaSignalScale: c.scale,
    });
    const ema = pick(results, 'EMA Trend DCA');
    const base = pick(results, 'Baseline DCA');
    if (!baselineDone) {
      baselinePerWindow.set(w.key, {
        totalReturn: base.totalReturn,
        maxDd: base.maxReturnDrawdown,
        irr: base.annualizedIrr,
      });
      baselineDone = true;
    }
    perCombo.push({
      totalReturn: ema.totalReturn,
      maxDd: ema.maxReturnDrawdown,
      retOverDd: ema.maxReturnDrawdown > 1e-6 ? ema.totalReturn / ema.maxReturnDrawdown : NaN,
      irr: ema.annualizedIrr,
      lnVsBaseline: Math.log(ema.finalPortfolioValue / base.finalPortfolioValue),
      trades: ema.trades.length,
    });
  }
  metrics.set(w.key, perCombo);
  console.error(`swept ${w.key} (${COMBOS.length} combos)`);
}

// --- aggregate ----------------------------------------------------------------

function rankOf(values: number[]): number[] {
  // rank 0 = best (highest value); NaN sinks to the bottom
  const idx = values.map((v, i) => [Number.isFinite(v) ? v : -Infinity, i] as const)
    .sort((a, b) => b[0] - a[0]);
  const ranks = new Array<number>(values.length);
  idx.forEach(([, i], r) => { ranks[i] = r; });
  return ranks;
}

interface Agg {
  combo: Combo;
  meanLnVsBaseline: number;
  meanRetOverDdRank: number;
  meanReturnRank: number;
  worstLnVsBaseline: number;
  perWindow: Record<string, RunMetrics>;
}

const returnRanks = new Map<string, number[]>();
const rodRanks = new Map<string, number[]>();
for (const w of WINDOWS) {
  const m = metrics.get(w.key)!;
  returnRanks.set(w.key, rankOf(m.map((x) => x.totalReturn)));
  rodRanks.set(w.key, rankOf(m.map((x) => x.retOverDd)));
}

const aggs: Agg[] = COMBOS.map((combo, i) => {
  let lnSum = 0;
  let rodRankSum = 0;
  let retRankSum = 0;
  let worstLn = Infinity;
  const perWindow: Record<string, RunMetrics> = {};
  for (const w of WINDOWS) {
    const m = metrics.get(w.key)![i];
    perWindow[w.key] = m;
    lnSum += m.lnVsBaseline;
    worstLn = Math.min(worstLn, m.lnVsBaseline);
    rodRankSum += rodRanks.get(w.key)![i];
    retRankSum += returnRanks.get(w.key)![i];
  }
  return {
    combo,
    meanLnVsBaseline: lnSum / WINDOWS.length,
    meanRetOverDdRank: rodRankSum / WINDOWS.length,
    meanReturnRank: retRankSum / WINDOWS.length,
    worstLnVsBaseline: worstLn,
    perWindow,
  };
});

// --- report --------------------------------------------------------------------

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pc = (x: number) => `${fmt(x * 100)}%`;
const comboLabel = (c: Combo) => `${c.fast}/${c.slow} @ ${(c.scale * 100).toFixed(1).replace(/\.0$/, '')}%`;

console.log(`\nData: ${rows[0].Date} → ${lastDate} (${rows.length} days)`);
console.log(`Grid: ${COMBOS.length} combos (fast × slow × scale), weekly $100 DCA, equal funding vs Baseline DCA\n`);
console.log('Anchors:',
  `2017 top ${top2017.date} ($${Math.round(top2017.price)})`,
  `| 2021 top ${top2021.date} ($${Math.round(top2021.price)})`,
  `| 2025 top ${top2025.date} ($${Math.round(top2025.price)})`,
  `| 2014-bear bottom ${bottom2015.date} ($${Math.round(bottom2015.price)})`,
  `| 2018 bottom ${bottom2018.date} ($${Math.round(bottom2018.price)})`,
  `| 2022 bottom ${bottom2022.date} ($${Math.round(bottom2022.price)})`,
);

function printRow(c: Combo, m: RunMetrics) {
  console.log(
    `  ${comboLabel(c).padEnd(16)} ret ${pc(m.totalReturn).padStart(8)}  ` +
    `dd ${pc(m.maxDd).padStart(7)}  ret/dd ${fmt(m.retOverDd, 2).padStart(6)}  ` +
    `irr ${pc(m.irr).padStart(7)}  vsDCA ${pc(Math.expm1(m.lnVsBaseline)).padStart(8)}  trades ${m.trades}`,
  );
}

for (const w of WINDOWS) {
  const m = metrics.get(w.key)!;
  const base = baselinePerWindow.get(w.key)!;
  console.log(`\n=== ${w.label} ===`);
  console.log(`  Baseline DCA: ret ${pc(base.totalReturn)}, dd ${pc(base.maxDd)}, irr ${pc(base.irr)}`);
  const byReturn = COMBOS.map((c, i) => i).sort((a, b) => m[b].totalReturn - m[a].totalReturn).slice(0, 5);
  const byRod = COMBOS.map((c, i) => i)
    .filter((i) => Number.isFinite(m[i].retOverDd))
    .sort((a, b) => m[b].retOverDd - m[a].retOverDd).slice(0, 5);
  console.log('  Top 5 by total return:');
  for (const i of byReturn) printRow(COMBOS[i], m[i]);
  console.log('  Top 5 by return / max drawdown:');
  for (const i of byRod) printRow(COMBOS[i], m[i]);
}

console.log('\n=== Robustness across all 6 windows ===');
console.log('\nTop 15 by mean ln(final ÷ baseline final):');
const byLn = [...aggs].sort((a, b) => b.meanLnVsBaseline - a.meanLnVsBaseline).slice(0, 15);
for (const a of byLn) {
  console.log(
    `  ${comboLabel(a.combo).padEnd(16)} meanVsDCA ${pc(Math.expm1(a.meanLnVsBaseline)).padStart(8)}  ` +
    `worstVsDCA ${pc(Math.expm1(a.worstLnVsBaseline)).padStart(8)}  ` +
    `meanRet/DD-rank ${fmt(a.meanRetOverDdRank, 0).padStart(4)}/${COMBOS.length}`,
  );
}

console.log('\nTop 15 by mean return/maxDD rank (risk-adjusted robustness):');
const byRod = [...aggs].sort((a, b) => a.meanRetOverDdRank - b.meanRetOverDdRank).slice(0, 15);
for (const a of byRod) {
  console.log(
    `  ${comboLabel(a.combo).padEnd(16)} meanRet/DD-rank ${fmt(a.meanRetOverDdRank, 0).padStart(4)}  ` +
    `meanVsDCA ${pc(Math.expm1(a.meanLnVsBaseline)).padStart(8)}  ` +
    `worstVsDCA ${pc(Math.expm1(a.worstLnVsBaseline)).padStart(8)}`,
  );
}

// Reference: current defaults 12/26 @ 5%
const defIdx = COMBOS.findIndex((c) => c.fast === 12 && c.slow === 26 && c.scale === 0.05);
if (defIdx >= 0) {
  console.log('\nCurrent defaults (12/26 @ 5%):');
  for (const w of WINDOWS) printRow(COMBOS[defIdx], metrics.get(w.key)![defIdx]);
  const a = aggs[defIdx];
  console.log(`  meanVsDCA ${pc(Math.expm1(a.meanLnVsBaseline))}, meanRet/DD-rank ${fmt(a.meanRetOverDdRank, 0)}/${COMBOS.length}`);
}

// --- persist ---------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(
  resolve(OUTPUT_DIR, 'ema-sweep.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    dataRange: { start: rows[0].Date, end: lastDate },
    config: BASE_CONFIG,
    windows: WINDOWS,
    baselinePerWindow: Object.fromEntries(baselinePerWindow),
    combos: COMBOS,
    aggregates: aggs.map(({ perWindow, ...rest }) => ({ ...rest, perWindow })),
  }, null, 2),
);
console.log(`\nWrote ${resolve(OUTPUT_DIR, 'ema-sweep.json')}`);
