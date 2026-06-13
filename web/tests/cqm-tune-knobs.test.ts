/**
 * Grid search for CQM dynamic sizing knobs (cash-frac at R=0, sell threshold).
 * Run: CQM_TUNE=1 npx vitest run tests/cqm-tune-knobs.test.ts
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCQM, riskForPriceFair } from '../src/utils/cqm';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint { date: string; close: number }

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

function loadPoints(): { date: string; ts: number; price: number }[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = [
    ...(JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[]),
    ...REALIZED_TAIL,
  ];
  const out: { date: string; ts: number; price: number }[] = [];
  for (const r of raw) {
    if (!Number.isFinite(r.close) || r.close <= 0) continue;
    out.push({ date: r.date, ts: new Date(r.date).getTime(), price: r.close });
  }
  return out;
}

function buildWalkForwardRisk(
  points: { date: string; ts: number; price: number }[],
  fromDate: string,
  refitDays = 90,
): Map<string, number> {
  const wfCfg = { qrAutoCalibrate: false, qrScaleRampStartDate: '2999-01-01' };
  const out = new Map<string, number>();
  let fit: ReturnType<typeof fitCQM> | null = null;
  let daysSince = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.date < fromDate) continue;
    if (!fit || daysSince >= refitDays) {
      fit = fitCQM(points.slice(0, i), wfCfg);
      daysSince = 0;
    }
    daysSince += 1;
    let r = riskForPriceFair(fit, p.ts, p.price);
    if (!Number.isFinite(r)) r = 0.5;
    out.set(p.date, Math.max(0, Math.min(1, r)));
  }
  return out;
}

interface SimResult { ret: number; maxRetDD: number; avgCash: number }

function simulate(
  win: { date: string; price: number }[],
  riskBy: Map<string, number>,
  base: number,
  maxCashFrac: number,
  sellThreshold: number,
): SimResult {
  let cash = 0;
  let btc = 0;
  let deposited = 0;
  let cashSum = 0;
  let peakRatio = -Infinity;
  let maxRetDD = 0;

  for (const d of win) {
    cash += base;
    deposited += base;
    const raw = riskBy.get(d.date);
    const R = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw!)) : 0.5;
    const btcVal = btc * d.price;

    let signed = 0;
    if (R < 0.5) {
      const taper = (0.5 - R) / 0.5;
      const cashFrac = maxCashFrac * taper;
      signed = Math.max(base * (1 - 2 * R), cashFrac * cash);
    } else if (R > sellThreshold && sellThreshold < 1) {
      const sellScale = (R - sellThreshold) / (1 - sellThreshold);
      signed = -Math.max(base, 0.01 * btcVal) * sellScale;
    }

    if (signed > 0) {
      const spend = Math.min(signed, cash);
      btc += spend / d.price;
      cash -= spend;
    } else if (signed < 0) {
      const sellUsd = Math.min(-signed, btcVal);
      btc -= sellUsd / d.price;
      cash += sellUsd;
    }

    cashSum += cash;
    const ratio = (btc * d.price + cash) / deposited;
    if (ratio > peakRatio) peakRatio = ratio;
    maxRetDD = Math.max(maxRetDD, (peakRatio - ratio) / peakRatio);
  }

  const last = win[win.length - 1].price;
  return {
    ret: ((btc * last + cash) - deposited) / deposited,
    maxRetDD,
    avgCash: cashSum / win.length,
  };
}

function simulateDca(win: { date: string; price: number }[], base: number): SimResult {
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
  return { ret: (btc * last - deposited) / deposited, maxRetDD, avgCash: 0 };
}

const WINDOWS = [
  { label: '2022 bottom→now', start: '2022-11-21', end: '2026-06-11' },
  { label: 'halving→halving', start: '2020-05-11', end: '2024-04-19' },
  { label: 'last 3y', start: '2023-06-11', end: '2026-06-11' },
  { label: 'last 5y', start: '2021-06-11', end: '2026-06-11' },
  { label: 'YTD 2026', start: '2026-01-01', end: '2026-06-11' },
];

const CASH_FRACS = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08];
const SELL_THRESHOLDS = [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 1.0]; // 1.0 = buy-only

describe('CQM knob tuning', () => {
  it.runIf(process.env.CQM_TUNE === '1')('grid search', () => {
    const points = loadPoints();
    const wfFrom = WINDOWS.reduce((a, w) => (w.start < a ? w.start : a), '9999');
    const wfRisk = buildWalkForwardRisk(points, wfFrom);

    type Row = {
      cashFrac: number;
      sellThresh: number;
      avgRet: number;
      avgRetVsDca: number;
      winsVsDca: number;
      avgDD: number;
      dcaAvgDD: number;
      ddReduction: number;
      score: number;
      perWindow: string[];
    };

    const rows: Row[] = [];

    for (const cashFrac of CASH_FRACS) {
      for (const sellThresh of SELL_THRESHOLDS) {
        let retSum = 0;
        let retVsDcaSum = 0;
        let wins = 0;
        let ddSum = 0;
        let dcaDdSum = 0;
        const perWindow: string[] = [];

        for (const w of WINDOWS) {
          const win = points
            .filter((p) => p.date >= w.start && p.date <= w.end)
            .map((p) => ({ date: p.date, price: p.price }));
          const dca = simulateDca(win, 100);
          const cqm = simulate(win, wfRisk, 100, cashFrac, sellThresh);
          retSum += cqm.ret;
          retVsDcaSum += cqm.ret - dca.ret;
          if (cqm.ret >= dca.ret) wins += 1;
          ddSum += cqm.maxRetDD;
          dcaDdSum += dca.maxRetDD;
          perWindow.push(
            `${w.label}: ${(cqm.ret * 100).toFixed(1)}% vs DCA ${(dca.ret * 100).toFixed(1)}% ` +
            `(DD ${(cqm.maxRetDD * 100).toFixed(0)}% vs ${(dca.maxRetDD * 100).toFixed(0)}%)`,
          );
        }

        const avgRet = retSum / WINDOWS.length;
        const avgRetVsDca = retVsDcaSum / WINDOWS.length;
        const avgDD = ddSum / WINDOWS.length;
        const dcaAvgDD = dcaDdSum / WINDOWS.length;
        const ddReduction = dcaAvgDD - avgDD;
        // Score: beat DCA on return, reward drawdown reduction, penalise losing too many windows
        const score = avgRetVsDca + 0.35 * ddReduction + 0.05 * wins;

        rows.push({
          cashFrac,
          sellThresh,
          avgRet,
          avgRetVsDca,
          winsVsDca: wins,
          avgDD,
          dcaAvgDD,
          ddReduction,
          score,
          perWindow,
        });
      }
    }

    rows.sort((a, b) => b.score - a.score);

    console.log('\n=== Top 15 knob combinations (WF risk, score = ret-vs-DCA + 0.35×DD-reduction + 0.05×wins) ===');
    for (const r of rows.slice(0, 15)) {
      const sellLabel = r.sellThresh >= 1 ? 'buy-only' : `${(r.sellThresh * 100).toFixed(0)}%`;
      console.log(
        `cashFrac=${(r.cashFrac * 100).toFixed(0)}% sell>${sellLabel} | ` +
        `avgRet ${(r.avgRet * 100).toFixed(1)}% | vsDCA ${(r.avgRetVsDca * 100).toFixed(1)}pp | ` +
        `wins ${r.winsVsDca}/5 | avgDD ${(r.avgDD * 100).toFixed(1)}% (DCA ${(r.dcaAvgDD * 100).toFixed(1)}%) | ` +
        `score ${r.score.toFixed(3)}`,
      );
    }

    const best = rows[0];
    console.log('\n=== Best combo detail ===');
    console.log(
      `cashFrac=${(best.cashFrac * 100).toFixed(0)}%, sellThreshold=${best.sellThresh >= 1 ? 'buy-only' : best.sellThresh}`,
    );
    for (const line of best.perWindow) console.log(`  ${line}`);
  }, 1_800_000);
});
