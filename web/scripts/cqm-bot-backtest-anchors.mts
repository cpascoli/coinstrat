/**
 * Backtest CQM Risk DCA from key cycle anchors using current fitCQM().
 *
 * Two sizing variants per anchor:
 *   1. Live bot  — cqmTradeFraction = 0
 *      target = base × (1 − 2 × Risk)
 *   2. 1% reserve acceleration (Backtest UI default)
 *      size = max(base, 1% × cash) on BUYs / max(base, 1% × btcValue) on SELLs
 *      target = size × (1 − 2 × Risk)
 *
 * Run: npm test -- tests/cqm-bot-backtest-anchors.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCQM } from '../src/utils/cqm.ts';
import { runBacktest, type BacktestConfig, type StrategyResult } from '../src/services/backtest.ts';
import type { SignalData } from '../src/App.tsx';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint {
  date: string;
  close: number;
}

/** Production tail merged when local btc_daily.json ends before bot start. */
const PRODUCTION_TAIL: RawPoint[] = [
  { date: '2026-05-24', close: 77000.57 },
  { date: '2026-05-25', close: 77273.26 },
  { date: '2026-05-26', close: 75842.51 },
  { date: '2026-05-27', close: 74348.55 },
  { date: '2026-05-28', close: 73531.95 },
  { date: '2026-05-29', close: 73384.46 },
  { date: '2026-05-30', close: 73794.27 },
  { date: '2026-05-31', close: 73601.92 },
  { date: '2026-06-01', close: 71329.41 },
  { date: '2026-06-02', close: 67587.2 },
];

function toSignalRow(date: string, price: number): SignalData {
  return {
    Date: date,
    BTCUSD: price,
    ACCUM_ON: 0,
    CORE_ON: 0,
    MACRO_ON: 0,
    PRICE_REGIME_ON: 0,
    VAL_SCORE: 0,
    DXY_SCORE: 0,
    LIQ_SCORE: 0,
    BIZ_CYCLE_SCORE: 0,
    US_LIQ: 0,
    US_LIQ_YOY: 0,
    US_LIQ_13W_DELTA: 0,
  } as SignalData;
}

function loadBtcRows(): SignalData[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  for (const r of PRODUCTION_TAIL) {
    if (!byDate.has(r.date)) byDate.set(r.date, r.close);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => toSignalRow(date, close));
}

function findAthInWindow(rows: SignalData[], from: string, to: string): string {
  const window = rows.filter((r) => r.Date >= from && r.Date <= to);
  if (!window.length) return from;
  let best = window[0];
  for (const r of window) {
    if (r.BTCUSD > best.BTCUSD) best = r;
  }
  return best.Date;
}

function findLowInWindow(rows: SignalData[], from: string, to: string): string {
  const window = rows.filter((r) => r.Date >= from && r.Date <= to);
  if (!window.length) return from;
  let low = window[0];
  for (const r of window) {
    if (r.BTCUSD < low.BTCUSD) low = r;
  }
  return low.Date;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtBtc(n: number): string {
  return n.toFixed(6);
}

interface Variant {
  label: string;
  tradeFraction: number;
}

const VARIANTS: Variant[] = [
  { label: 'Live bot (base only)', tradeFraction: 0 },
  { label: '1% reserve acceleration', tradeFraction: 0.01 },
];

function printStrategyRow(r: StrategyResult) {
  console.log(
    `  ${r.name.padEnd(18)}${fmtPct(r.totalReturn).padStart(7)}  ${fmtPct(r.maxDrawdown).padStart(6)}  ${fmtBtc(r.finalBtcHeld).padStart(10)}  ${fmtUsd(r.finalCashBalance).padStart(8)}  ${fmtUsd(r.finalPortfolioValue)}`,
  );
}

function printVariantBlock(
  variant: Variant,
  baseline: StrategyResult,
  cqm: StrategyResult,
) {
  console.log(`  [${variant.label}]`);
  console.log('  Strategy          Return    Max DD    BTC held    Cash      Portfolio');
  printStrategyRow(baseline);
  printStrategyRow(cqm);
  const alpha = cqm.totalReturn - baseline.totalReturn;
  console.log(`  CQM vs baseline: ${alpha >= 0 ? '+' : ''}${fmtPct(alpha)} total return`);
  console.log('');
}

export function runCqmBotAnchorBacktest() {
  const rows = loadBtcRows();
  const latest = rows[rows.length - 1]?.Date ?? '2026-06-02';

  const points = rows.map((r) => ({
    date: r.Date,
    ts: new Date(`${r.Date}T00:00:00Z`).getTime(),
    price: r.BTCUSD,
  }));

  const fit = fitCQM(points);
  const riskByDate = new Map<string, number>();
  for (const s of fit.signals) riskByDate.set(s.date, s.risk);

  const nov2021Ath = findAthInWindow(rows, '2021-11-01', '2021-11-30');
  const nov2022Low = findLowInWindow(rows, '2022-11-01', '2022-11-30');
  const oct2025Ath = findAthInWindow(rows, '2025-10-01', '2025-10-31');
  const botStart = '2026-05-25';

  const anchors = [
    { label: `Nov 2021 ATH (${nov2021Ath})`, startDate: nov2021Ath },
    { label: `Nov 2022 cycle low (${nov2022Low})`, startDate: nov2022Low },
    { label: `Oct 2025 ATH (${oct2025Ath})`, startDate: oct2025Ath },
    { label: `Jan 2026 YTD (2026-01-01 → ${latest})`, startDate: '2026-01-01' },
    { label: `Coinbase bot live (${botStart} → ${latest})`, startDate: botStart },
  ];

  const sharedConfig: Omit<BacktestConfig, 'startDate' | 'cqmTradeFraction'> = {
    dcaAmount: 100,
    frequency: 'daily',
    offSignalMode: 'pause',
    macroAccel: false,
    accelMultiplier: 3,
    cqmDca: true,
    cqmRiskByDate: riskByDate,
  };

  console.log('CQM bot backtest — current gated blend');
  console.log(`Data through ${latest} | $${sharedConfig.dcaAmount}/day | frequency: daily`);
  console.log(`CQM at latest: risk ${((fit.signals[fit.signals.length - 1]?.risk ?? 0) * 100).toFixed(1)}%`);
  console.log('');
  console.log('Reserve acceleration: when cash (buys) or BTC value (sells) exceeds base/1%,');
  console.log('trade size scales to 1% of that reserve instead of a flat base — redeploys dry');
  console.log('powder faster in bears and liquidates ~1%/day of BTC at tops.');
  console.log('');

  for (const anchor of anchors) {
    const startRow = rows.find((r) => r.Date === anchor.startDate);
    const endRow = rows[rows.length - 1];
    if (!startRow) {
      console.log(`── ${anchor.label} ──`);
      console.log(`  Skipped: no price row for ${anchor.startDate}`);
      console.log('');
      continue;
    }

    const startRisk = riskByDate.get(anchor.startDate);
    const endRisk = riskByDate.get(endRow.Date);

    console.log(`── ${anchor.label} ──`);
    console.log(`  BTC  ${fmtUsd(startRow.BTCUSD)} → ${fmtUsd(endRow.BTCUSD)}`);
    console.log(`  CQM risk  ${startRisk != null ? fmtPct(startRisk) : 'n/a'} → ${endRisk != null ? fmtPct(endRisk) : 'n/a'}`);

    for (const variant of VARIANTS) {
      const config: BacktestConfig = {
        ...sharedConfig,
        startDate: anchor.startDate,
        cqmTradeFraction: variant.tradeFraction,
      };
      const results = runBacktest(rows, config);
      const baseline = results.find((r) => r.name === 'Baseline DCA');
      const cqm = results.find((r) => r.name === 'CQM Risk DCA');
      if (!baseline || !cqm) continue;

      if (variant === VARIANTS[0]) {
        const days = baseline.series.filter((s) => s.date >= anchor.startDate).length;
        console.log(`  Periods   ${days} days | invested ${fmtUsd(cqm.totalInvested)} each strategy`);
        console.log('');
      }

      printVariantBlock(variant, baseline, cqm);
    }
  }
}
