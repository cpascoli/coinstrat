/**
 * Smoke test for LLI+CQM DCA vs Baseline / CQM / EMA Trend.
 * Uses a cheap full-sample CQM fit as a stand-in for walk-forward risk
 * (good enough to verify the state machine + gating; Lab uses walk-forward).
 *
 * Run: npx tsx scripts/lli-cqm-smoke.mts
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../src/services/backtest.ts';
import { fitCQM, riskForPriceFairProjected } from '../src/utils/cqm.ts';
import { computeLliStates, LLI_DEFAULT_PERIODS } from '../src/utils/larssonLine.ts';
import type { SignalData } from '../src/App.tsx';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint { date: string; close: number; }

const raw = JSON.parse(
  readFileSync(resolve(__dirname, '../public/data/btc_daily.json'), 'utf-8'),
) as RawPoint[];
const byDate = new Map<string, number>();
for (const r of raw) {
  if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
}
const rows = [...byDate.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, close]) => ({ Date: date, BTCUSD: close }) as unknown as SignalData);

const hist = rows.map((r) => ({
  date: r.Date,
  ts: new Date(`${r.Date}T00:00:00Z`).getTime(),
  price: r.BTCUSD,
}));
const fit = fitCQM(hist);
const riskByDate = new Map<string, number>();
for (const p of hist) {
  const r = riskForPriceFairProjected(fit, p.ts, p.price);
  if (Number.isFinite(r)) riskByDate.set(p.date, Math.max(0, Math.min(1, r)));
}

const riskSeries = [...riskByDate.entries()].map(([date, value]) => ({ date, value }));
const states = computeLliStates(riskSeries, {
  mode: 'ribbon4',
  periods: LLI_DEFAULT_PERIODS,
  minGap: 0.002,
});
const counts = { gold: 0, blue: 0, gray: 0 };
for (const s of states.values()) counts[s]++;
console.log('State distribution (full sample, lookback risk):', counts);

const WINDOWS = [
  { key: 'last4y', start: '2022-06-12', end: rows[rows.length - 1].Date },
  { key: 'halving20_24', start: '2020-05-11', end: '2024-04-20' },
  { key: 'bot18_bot22', start: '2018-12-15', end: '2022-11-21' },
];

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

for (const w of WINDOWS) {
  const results = runBacktest(rows, {
    startDate: w.start,
    endDate: w.end,
    dcaAmount: 100,
    frequency: 'weekly',
    offSignalMode: 'pause',
    macroAccel: false,
    accelMultiplier: 3,
    cqmDca: true,
    cqmRiskByDate: riskByDate,
    cqmDynamicSizing: true,
    emaDca: true,
    lliCqmDca: true,
    lliMode: 'ribbon4',
    lliSeries: 'risk',
    lliPeriods: LLI_DEFAULT_PERIODS,
  });
  console.log(`\n=== ${w.key} (${w.start} → ${w.end}) ===`);
  for (const name of ['Baseline DCA', 'CQM Risk DCA', 'EMA Trend DCA', 'LLI+CQM DCA']) {
    const r = results.find((x) => x.name === name);
    if (!r) {
      console.log(`  ${name}: MISSING`);
      continue;
    }
    console.log(
      `  ${name.padEnd(16)} ret ${pc(r.totalReturn).padStart(8)}  ` +
      `dd ${pc(r.maxReturnDrawdown).padStart(7)}  ` +
      `ret/dd ${(r.maxReturnDrawdown > 1e-6 ? r.totalReturn / r.maxReturnDrawdown : NaN).toFixed(2).padStart(6)}  ` +
      `trades ${String(r.trades.length).padStart(4)}  ` +
      `cash ${pc(r.finalCashBalance / Math.max(1, r.finalPortfolioValue))}`,
    );
  }
}
