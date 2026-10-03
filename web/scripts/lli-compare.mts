/**
 * Compare LLI constructions vs Buy&Hold / Simple DCA / CQM Risk DCA
 * across the same cycle windows used for the EMA sweep.
 *
 * Strategies (equal weekly $100 funding except Buy&Hold):
 *   - Buy & Hold      — lump-sum the same total capital on day 1, hold to end
 *   - Simple DCA      — Baseline DCA (always buy the deposit)
 *   - CQM Risk DCA    — walk-forward CQM dynamic sizing
 *   - LLI ribbon4     — 4-EMA ribbon on CQM Risk → gates CQM
 *   - LLI EMA+ATR     — UniqueCharts 30/60 + 0.3×ATR(60) on CQM Risk → gates CQM
 *
 * Run: npx tsx scripts/lli-compare.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest, StrategyResult } from '../src/services/backtest.ts';
import {
  LLI_DEFAULT_PERIODS,
  LLI_DEFAULT_FAST_PERIOD,
  LLI_DEFAULT_SLOW_PERIOD,
  LLI_DEFAULT_ATR_PERIOD,
  LLI_DEFAULT_ATR_MULT,
  computeLliStates,
} from '../src/utils/larssonLine.ts';
import type { SignalData } from '../src/App.tsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'output');

interface RawPoint { date: string; close: number; }

function loadRows(): SignalData[] {
  const raw = JSON.parse(
    readFileSync(resolve(__dirname, '../public/data/btc_daily.json'), 'utf-8'),
  ) as RawPoint[];
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ Date: date, BTCUSD: close }) as unknown as SignalData);
}

function loadWalkForwardRisk(): Map<string, number> {
  const payload = JSON.parse(
    readFileSync(resolve(__dirname, 'output/cqm_walkforward_payload.json'), 'utf-8'),
  ) as { data?: Array<{ date: string; risk: number }> };
  const map = new Map<string, number>();
  for (const e of payload.data ?? []) {
    const r = Number(e.risk);
    if (e.date && Number.isFinite(r)) map.set(e.date, Math.max(0, Math.min(1, r)));
  }
  return map;
}

function argExtreme(
  rows: SignalData[],
  from: string,
  to: string,
  kind: 'max' | 'min',
): { date: string; price: number } {
  let best: { date: string; price: number } | null = null;
  for (const r of rows) {
    if (r.Date < from || r.Date > to) continue;
    if (!best || (kind === 'max' ? r.BTCUSD > best.price : r.BTCUSD < best.price)) {
      best = { date: r.Date, price: r.BTCUSD };
    }
  }
  if (!best) throw new Error(`no data in [${from}, ${to}]`);
  return best;
}

function minusYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** Count Monday-sampled weeks in [start, end] inclusive (matches weekly DCA). */
function countWeeklyDeposits(rows: SignalData[], start: string, end: string): number {
  let n = 0;
  let lastKey = '';
  for (const d of rows) {
    if (d.Date < start || d.Date > end) continue;
    if (!Number.isFinite(d.BTCUSD) || d.BTCUSD <= 0) continue;
    const dt = new Date(`${d.Date}T00:00:00Z`);
    const dayOfWeek = dt.getUTCDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(dt);
    monday.setUTCDate(monday.getUTCDate() + diff);
    const key = monday.toISOString().slice(0, 10);
    if (key !== lastKey) {
      n++;
      lastKey = key;
    }
  }
  return n;
}

/**
 * Equal-capital Buy & Hold: invest (weeklyDeposits × $100) as a lump sum on
 * the first day of the window, hold to the end. Same total capital as DCA.
 */
function runBuyAndHold(
  rows: SignalData[],
  start: string,
  end: string,
  dcaAmount: number,
): { totalReturn: number; maxDrawdown: number; finalValue: number; invested: number; trades: number } {
  const window = rows.filter(
    (r) => r.Date >= start && r.Date <= end && Number.isFinite(r.BTCUSD) && r.BTCUSD > 0,
  );
  if (window.length < 2) {
    return { totalReturn: NaN, maxDrawdown: NaN, finalValue: NaN, invested: 0, trades: 0 };
  }
  const n = countWeeklyDeposits(rows, start, end);
  const invested = n * dcaAmount;
  const startPrice = window[0].BTCUSD;
  const btc = invested / startPrice;

  let peak = -Infinity;
  let maxDd = 0;
  for (const d of window) {
    const v = btc * d.BTCUSD;
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  const finalValue = btc * window[window.length - 1].BTCUSD;
  return {
    totalReturn: invested > 0 ? (finalValue - invested) / invested : 0,
    maxDrawdown: maxDd,
    finalValue,
    invested,
    trades: 1,
  };
}

function metrics(r: StrategyResult) {
  return {
    totalReturn: r.totalReturn,
    maxDd: r.maxReturnDrawdown,
    retOverDd: r.maxReturnDrawdown > 1e-6 ? r.totalReturn / r.maxReturnDrawdown : NaN,
    irr: r.annualizedIrr,
    finalValue: r.finalPortfolioValue,
    invested: r.totalInvested,
    trades: r.trades.length,
    finalCashFrac: r.finalPortfolioValue > 0 ? r.finalCashBalance / r.finalPortfolioValue : 0,
  };
}

const pc = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

const rows = loadRows();
const riskByDate = loadWalkForwardRisk();
const lastDate = rows[rows.length - 1].Date;

const top2017 = argExtreme(rows, '2017-06-01', '2018-02-01', 'max');
const top2021 = argExtreme(rows, '2021-01-01', '2022-01-01', 'max');
const top2025 = argExtreme(rows, '2024-11-01', lastDate, 'max');
const bottom2015 = argExtreme(rows, '2014-06-01', '2015-12-31', 'min');
const bottom2018 = argExtreme(rows, '2018-06-01', '2019-03-31', 'min');
const bottom2022 = argExtreme(rows, '2022-06-01', '2023-03-31', 'min');

const WINDOWS = [
  // Full-cycle / reference windows
  { key: 'last4y', label: `Last 4 years (${minusYears(lastDate, 4)} → ${lastDate})`, start: minusYears(lastDate, 4), end: lastDate },
  { key: 'halving20_24', label: 'Halving 2020 → Halving 2024', start: '2020-05-11', end: '2024-04-20' },
  { key: 'top17_top21', label: `2017 top → 2021 top (${top2017.date} → ${top2021.date})`, start: top2017.date, end: top2021.date },
  { key: 'top21_top25', label: `2021 top → 2025 top (${top2021.date} → ${top2025.date})`, start: top2021.date, end: top2025.date },
  { key: 'bot14_bot18', label: `2014 bottom → 2018 bottom (${bottom2015.date} → ${bottom2018.date})`, start: bottom2015.date, end: bottom2018.date },
  { key: 'bot18_bot22', label: `2018 bottom → 2022 bottom (${bottom2018.date} → ${bottom2022.date})`, start: bottom2018.date, end: bottom2022.date },
  // Early-cycle accumulation analogues: ~2–3 years from a cycle bottom
  // (proxy for accumulating at the current bottom over the next 2–3 years).
  { key: 'accum14_16', label: 'Accum: Jun 2014 → Jun 2016 (2y from ’14 bottom)', start: '2014-06-01', end: '2016-06-01' },
  { key: 'accum14_17', label: 'Accum: Jun 2014 → Jun 2017 (3y from ’14 bottom)', start: '2014-06-01', end: '2017-06-01' },
  { key: 'accum18_20', label: 'Accum: Jun 2018 → Jun 2020 (2y from ’18 bottom)', start: '2018-06-01', end: '2020-06-01' },
  { key: 'accum18_21', label: 'Accum: Jun 2018 → Jun 2021 (3y from ’18 bottom)', start: '2018-06-01', end: '2021-06-01' },
  { key: 'accum22_24', label: 'Accum: Jun 2022 → Jun 2024 (2y from ’22 bottom)', start: '2022-06-01', end: '2024-06-01' },
  { key: 'accum22_25', label: 'Accum: Jun 2022 → Jun 2025 (3y from ’22 bottom)', start: '2022-06-01', end: '2025-06-01' },
];

const ACCUM_KEYS = new Set([
  'accum14_16', 'accum14_17', 'accum18_20', 'accum18_21', 'accum22_24', 'accum22_25',
]);

const DCA = 100;
const baseCfg = {
  dcaAmount: DCA,
  frequency: 'weekly' as const,
  offSignalMode: 'pause' as const,
  macroAccel: false,
  accelMultiplier: 3,
  cqmRiskByDate: riskByDate,
  cqmDynamicSizing: true,
};

console.log(`Data: ${rows[0].Date} → ${lastDate}`);
console.log(`Walk-forward CQM risk points: ${riskByDate.size}`);
console.log(`Funding: weekly $${DCA} DCA (Buy&Hold = equal lump sum on day 1)\n`);

// State occupancy over full risk history (sanity).
const riskSeries = [...riskByDate.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, value]) => ({ date, value }));
for (const [label, params] of [
  ['ribbon4 8/21/55/144', { mode: 'ribbon4' as const, periods: LLI_DEFAULT_PERIODS, minGap: 0.002 }],
  ['emaAtr 30/60 ×0.3', {
    mode: 'emaAtr' as const,
    fastPeriod: LLI_DEFAULT_FAST_PERIOD,
    slowPeriod: LLI_DEFAULT_SLOW_PERIOD,
    atrPeriod: LLI_DEFAULT_ATR_PERIOD,
    atrMult: LLI_DEFAULT_ATR_MULT,
  }],
] as const) {
  const st = computeLliStates(riskSeries, params);
  const c = { gold: 0, blue: 0, gray: 0 };
  for (const s of st.values()) c[s]++;
  const n = st.size || 1;
  console.log(
    `States [${label}]: gold ${pc(c.gold / n)}  blue ${pc(c.blue / n)}  gray ${pc(c.gray / n)}`,
  );
}

type Row = {
  name: string;
  totalReturn: number;
  maxDd: number;
  retOverDd: number;
  irr: number;
  trades: number;
  finalCashFrac: number;
  invested: number;
  finalValue: number;
};

const allResults: Record<string, Row[]> = {};

for (const w of WINDOWS) {
  // Skip windows that start before walk-forward risk is available when
  // strategies need it — still run them; early days fall back to risk=0.5.
  const bh = runBuyAndHold(rows, w.start, w.end, DCA);

  const dcaOnly = runBacktest(rows, {
    ...baseCfg,
    startDate: w.start,
    endDate: w.end,
    cqmDca: false,
    lliCqmDca: false,
  });
  const withCqm = runBacktest(rows, {
    ...baseCfg,
    startDate: w.start,
    endDate: w.end,
    cqmDca: true,
    lliCqmDca: false,
  });
  const ribbon = runBacktest(rows, {
    ...baseCfg,
    startDate: w.start,
    endDate: w.end,
    cqmDca: false,
    lliCqmDca: true,
    lliMode: 'ribbon4',
    lliSeries: 'risk',
    lliPeriods: LLI_DEFAULT_PERIODS,
  });
  const emaAtr = runBacktest(rows, {
    ...baseCfg,
    startDate: w.start,
    endDate: w.end,
    cqmDca: false,
    lliCqmDca: true,
    lliMode: 'emaAtr',
    lliSeries: 'risk',
    lliFastPeriod: LLI_DEFAULT_FAST_PERIOD,
    lliSlowPeriod: LLI_DEFAULT_SLOW_PERIOD,
    lliAtrPeriod: LLI_DEFAULT_ATR_PERIOD,
    lliAtrMult: LLI_DEFAULT_ATR_MULT,
  });

  const pick = (results: StrategyResult[], name: string) => {
    const r = results.find((x) => x.name === name);
    if (!r) throw new Error(`missing ${name}`);
    return metrics(r);
  };

  const table: Row[] = [
    {
      name: 'Buy & Hold',
      totalReturn: bh.totalReturn,
      maxDd: bh.maxDrawdown,
      retOverDd: bh.maxDrawdown > 1e-6 ? bh.totalReturn / bh.maxDrawdown : NaN,
      irr: NaN, // single cashflow — IRR ≡ totalReturn annualized separately if needed
      trades: bh.trades,
      finalCashFrac: 0,
      invested: bh.invested,
      finalValue: bh.finalValue,
    },
    { name: 'Simple DCA', ...pick(dcaOnly, 'Baseline DCA') },
    { name: 'CQM Risk DCA', ...pick(withCqm, 'CQM Risk DCA') },
    { name: 'LLI ribbon4', ...pick(ribbon, 'LLI+CQM DCA') },
    { name: 'LLI EMA+ATR', ...pick(emaAtr, 'LLI+CQM DCA') },
  ];
  allResults[w.key] = table;

  console.log(`\n=== ${w.label} ===`);
  console.log(
    `${'Strategy'.padEnd(16)} ${'ROI'.padStart(8)} ${'MaxDD'.padStart(8)} ${'ROI/DD'.padStart(8)} ${'Trades'.padStart(7)} ${'Cash%'.padStart(7)} ${'Final $'.padStart(12)}`,
  );
  for (const r of table) {
    console.log(
      `${r.name.padEnd(16)} ${pc(r.totalReturn).padStart(8)} ${pc(r.maxDd).padStart(8)} ${num(r.retOverDd).padStart(8)} ${String(r.trades).padStart(7)} ${pc(r.finalCashFrac).padStart(7)} ${('$' + Math.round(r.finalValue).toLocaleString()).padStart(12)}`,
    );
  }
}

const names = ['Buy & Hold', 'Simple DCA', 'CQM Risk DCA', 'LLI ribbon4', 'LLI EMA+ATR'];

function printSummary(title: string, windows: typeof WINDOWS) {
  const n = windows.length;
  console.log(`\n=== ${title} (mean across ${n} windows) ===`);
  console.log(
    `${'Strategy'.padEnd(16)} ${'Mean ROI'.padStart(10)} ${'Mean DD'.padStart(10)} ${'Mean ROI/DD'.padStart(12)} ${'Beat DCA'.padStart(10)} ${'Best DD'.padStart(10)}`,
  );
  for (const name of names) {
    const rowsFor = windows.map((w) => allResults[w.key].find((r) => r.name === name)!);
    const meanRoi = rowsFor.reduce((s, r) => s + r.totalReturn, 0) / rowsFor.length;
    const meanDd = rowsFor.reduce((s, r) => s + r.maxDd, 0) / rowsFor.length;
    const rods = rowsFor.map((r) => r.retOverDd).filter(Number.isFinite);
    const meanRod = rods.length ? rods.reduce((s, x) => s + x, 0) / rods.length : NaN;
    const dcaRois = windows.map((w) => allResults[w.key].find((r) => r.name === 'Simple DCA')!.totalReturn);
    const beat = rowsFor.filter((r, i) => r.totalReturn > dcaRois[i]).length;
    const bestDd = rowsFor.filter((r, i) => {
      const dcaDd = allResults[windows[i].key].find((x) => x.name === 'Simple DCA')!.maxDd;
      return r.maxDd < dcaDd;
    }).length;
    console.log(
      `${name.padEnd(16)} ${pc(meanRoi).padStart(10)} ${pc(meanDd).padStart(10)} ${num(meanRod).padStart(12)} ${`${beat}/${n}`.padStart(10)} ${`${bestDd}/${n}`.padStart(10)}`,
    );
  }

  let ribbonBeatsAtr = 0;
  let atrBeatsRibbon = 0;
  let ribbonBetterDd = 0;
  let atrBetterDd = 0;
  for (const w of windows) {
    const a = allResults[w.key].find((r) => r.name === 'LLI ribbon4')!;
    const b = allResults[w.key].find((r) => r.name === 'LLI EMA+ATR')!;
    if (a.totalReturn > b.totalReturn) ribbonBeatsAtr++;
    else if (b.totalReturn > a.totalReturn) atrBeatsRibbon++;
    if (a.maxDd < b.maxDd) ribbonBetterDd++;
    else if (b.maxDd < a.maxDd) atrBetterDd++;
  }
  console.log(`LLI head-to-head: ribbon4 better ROI in ${ribbonBeatsAtr}/${n}, EMA+ATR in ${atrBeatsRibbon}/${n}`);
  console.log(`LLI head-to-head: ribbon4 lower DD in ${ribbonBetterDd}/${n}, EMA+ATR in ${atrBetterDd}/${n}`);
}

const accumWindows = WINDOWS.filter((w) => ACCUM_KEYS.has(w.key));
const refWindows = WINDOWS.filter((w) => !ACCUM_KEYS.has(w.key));
printSummary('Early-cycle accumulation analogues (your use case)', accumWindows);
printSummary('Reference / full-cycle windows', refWindows);
printSummary('All windows', WINDOWS);

mkdirSync(OUTPUT_DIR, { recursive: true });
const outPath = resolve(OUTPUT_DIR, 'lli-compare.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      funding: { dcaAmount: DCA, frequency: 'weekly' },
      lliDefaults: {
        ribbon4: LLI_DEFAULT_PERIODS,
        emaAtr: {
          fast: LLI_DEFAULT_FAST_PERIOD,
          slow: LLI_DEFAULT_SLOW_PERIOD,
          atrPeriod: LLI_DEFAULT_ATR_PERIOD,
          atrMult: LLI_DEFAULT_ATR_MULT,
        },
        series: 'risk (walk-forward)',
      },
      windows: WINDOWS,
      results: allResults,
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${outPath}`);
