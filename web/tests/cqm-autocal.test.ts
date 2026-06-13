/**
 * Flaw B experiment: auto-recalibrated fair value vs raw QR fan, both causal.
 *
 * Uses the production `qrAutoCalibrate` option in fitCQM (trailing 3y median
 * residual anchor, 4y ramp) against the uncalibrated raw fan. Compares
 * strategy performance (dynamic sizing 6%/75%) across the five standard
 * windows, plus today's bot risk under each variant.
 *
 * Run: CQM_AUTOCAL=1 npx vitest run tests/cqm-autocal.test.ts
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCQM, riskForPriceFair, type CQMConfig } from '../src/utils/cqm';
import { computeCqmDynamicTrade } from '../src/utils/cqmSizing';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint { date: string; close: number }
interface PricePoint { date: string; ts: number; price: number }

const REALIZED_TAIL: RawPoint[] = [
  { date: '2026-05-24', close: 76984.9 },
  { date: '2026-05-25', close: 77265.9 },
  { date: '2026-05-26', close: 75824.0 },
  { date: '2026-05-27', close: 74337.1 },
  { date: '2026-05-28', close: 73515.7 },
  { date: '2026-05-29', close: 73370.7 },
  { date: '2026-05-30', close: 73753.7 },
  { date: '2026-05-31', close: 73570.0 },
  { date: '2026-06-01', close: 71317.5 },
  { date: '2026-06-02', close: 66669.7 },
  { date: '2026-06-03', close: 64035.8 },
  { date: '2026-06-04', close: 63814.0 },
  { date: '2026-06-05', close: 61037.9 },
  { date: '2026-06-06', close: 60855.7 },
  { date: '2026-06-07', close: 63307.6 },
  { date: '2026-06-08', close: 63076.4 },
  { date: '2026-06-09', close: 61690.4 },
  { date: '2026-06-10', close: 61464.4 },
  { date: '2026-06-11', close: 63552.3 },
];

const RAW_FIT: CQMConfig = { qrAutoCalibrate: false, qrScaleRampStartDate: '2999-01-01' };
const REFIT_EVERY_DAYS = 90;

function loadPoints(): PricePoint[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = [
    ...(JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[]),
    ...REALIZED_TAIL,
  ];
  const out: PricePoint[] = [];
  for (const r of raw) {
    if (!Number.isFinite(r.close) || r.close <= 0) continue;
    out.push({ date: r.date, ts: new Date(r.date).getTime(), price: r.close });
  }
  return out;
}

/** Causal fit with the production trailing-median auto-calibration. */
function fitAutoCalibrated(history: PricePoint[]): ReturnType<typeof fitCQM> {
  return fitCQM(history, { qrAutoCalibrate: true });
}

type FitFn = (history: PricePoint[]) => ReturnType<typeof fitCQM>;

function buildWfRisk(points: PricePoint[], fromDate: string, fitFn: FitFn): Map<string, number> {
  const out = new Map<string, number>();
  let fit: ReturnType<typeof fitCQM> | null = null;
  let daysSince = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.date < fromDate) continue;
    if (daysSince >= REFIT_EVERY_DAYS) {
      const history = points.slice(0, i);
      if (history.length >= 365) {
        try {
          fit = fitFn(history);
          daysSince = 0;
        } catch {
          daysSince = 0;
        }
      }
    }
    daysSince += 1;
    if (!fit) {
      out.set(p.date, 0.5);
      continue;
    }
    let r = riskForPriceFair(fit, p.ts, p.price);
    if (!Number.isFinite(r)) r = 0.5;
    out.set(p.date, Math.max(0, Math.min(1, r)));
  }
  return out;
}

interface SimResult { ret: number; maxRetDD: number; avgRisk: number }

function simulateDynamic(
  win: PricePoint[],
  riskBy: Map<string, number>,
): SimResult {
  const base = 100;
  let cash = 0;
  let btc = 0;
  let deposited = 0;
  let peakRatio = -Infinity;
  let maxRetDD = 0;
  let riskSum = 0;
  for (const d of win) {
    cash += base;
    deposited += base;
    const raw = riskBy.get(d.date);
    const R = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw!)) : 0.5;
    riskSum += R;
    const sized = computeCqmDynamicTrade({
      baseAmount: base,
      risk: R,
      cashBalance: cash,
      btcHeld: btc,
      btcPrice: d.price,
    });
    if (sized.buyAmount > 0) {
      const spend = Math.min(sized.buyAmount, cash);
      btc += spend / d.price;
      cash -= spend;
    } else if (sized.sellAmount > 0) {
      const sellUsd = Math.min(sized.sellAmount, btc * d.price);
      btc -= sellUsd / d.price;
      cash += sellUsd;
    }
    const ratio = (btc * d.price + cash) / deposited;
    if (ratio > peakRatio) peakRatio = ratio;
    maxRetDD = Math.max(maxRetDD, (peakRatio - ratio) / peakRatio);
  }
  const last = win[win.length - 1].price;
  return {
    ret: ((btc * last + cash) - deposited) / deposited,
    maxRetDD,
    avgRisk: riskSum / win.length,
  };
}

function simulateDca(win: PricePoint[]): SimResult {
  const base = 100;
  let btc = 0;
  let deposited = 0;
  let peakRatio = -Infinity;
  let maxRetDD = 0;
  for (const d of win) {
    deposited += base;
    btc += base / d.price;
    const ratio = (btc * d.price) / deposited;
    if (ratio > peakRatio) peakRatio = ratio;
    maxRetDD = Math.max(maxRetDD, (peakRatio - ratio) / peakRatio);
  }
  const last = win[win.length - 1].price;
  return { ret: (btc * last - deposited) / deposited, maxRetDD, avgRisk: NaN };
}

const WINDOWS = [
  { label: '2022 bottom→now', start: '2022-11-21', end: '2026-06-11' },
  { label: 'halving→halving', start: '2020-05-11', end: '2024-04-19' },
  { label: 'last 3y', start: '2023-06-11', end: '2026-06-11' },
  { label: 'last 5y', start: '2021-06-11', end: '2026-06-11' },
  { label: 'YTD 2026', start: '2026-01-01', end: '2026-06-11' },
];

function pct(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a';
}

describe('CQM auto-recalibration experiment', () => {
  it.runIf(process.env.CQM_AUTOCAL === '1')('raw fan vs trailing-median auto-cal', () => {
    const points = loadPoints();
    const fromDate = WINDOWS.reduce((a, w) => (w.start < a ? w.start : a), '9999');

    console.log('\nBuilding raw-fan WF risk…');
    const rawRisk = buildWfRisk(points, fromDate, (h) => fitCQM(h, RAW_FIT));
    console.log('Building auto-calibrated WF risk…');
    const autoRisk = buildWfRisk(points, fromDate, fitAutoCalibrated);

    console.log('\n=== Dynamic sizing (6% / 75%), $100/day, causal risk ===');
    for (const w of WINDOWS) {
      const win = points.filter((p) => p.date >= w.start && p.date <= w.end);
      if (win.length === 0) continue;
      const dca = simulateDca(win);
      const raw = simulateDynamic(win, rawRisk);
      const auto = simulateDynamic(win, autoRisk);
      console.log(
        `\n${w.label} (${w.start} → ${w.end})\n` +
        `  Simple DCA          ret ${pct(dca.ret).padStart(7)} | DD ${pct(dca.maxRetDD)}\n` +
        `  CQM raw-fan WF      ret ${pct(raw.ret).padStart(7)} | DD ${pct(raw.maxRetDD)} | avg risk ${pct(raw.avgRisk)}\n` +
        `  CQM auto-cal WF     ret ${pct(auto.ret).padStart(7)} | DD ${pct(auto.maxRetDD)} | avg risk ${pct(auto.avgRisk)}`,
      );
    }

    // Today's bot risk under each variant (full history through 2026-06-11).
    const last = points[points.length - 1];
    const manualFit = fitCQM(points, { qrAutoCalibrate: false }); // legacy manual anchor
    const rawFit = fitCQM(points, RAW_FIT);                       // raw fan
    const autoFit = fitAutoCalibrated(points);                    // auto-recalibrated (default)
    const riskOf = (fit: ReturnType<typeof fitCQM>) => riskForPriceFair(fit, last.ts, last.price);
    const fairOf = (fit: ReturnType<typeof fitCQM>) =>
      fit.signals[fit.signals.length - 1]?.qrDashedMedian ?? NaN;
    console.log(`\n=== Today (${last.date}, $${Math.round(last.price).toLocaleString()}) ===`);
    console.log(`  Manual anchor (production): fair $${Math.round(fairOf(manualFit)).toLocaleString()} | risk ${pct(riskOf(manualFit))}`);
    console.log(`  Raw fan:                    fair $${Math.round(fairOf(rawFit)).toLocaleString()} | risk ${pct(riskOf(rawFit))}`);
    console.log(`  Auto-recalibrated:          fair $${Math.round(fairOf(autoFit)).toLocaleString()} | risk ${pct(riskOf(autoFit))}`);
  }, 3_600_000);
});
