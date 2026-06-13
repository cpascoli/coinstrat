/**
 * CQM backtest verification report (run via vitest) — reproduces the
 * models/cqm/backtest page result for 2021-11-08 → 2025-08-06 and probes
 * alternative sizing rules. Prints a report rather than asserting.
 *
 * The walk-forward (no look-ahead) probe refits the model ~16 times and takes
 * ~1 minute, so it only runs when CQM_WF=1 is set:
 *   CQM_WF=1 npx vitest run tests/verify-cqm-window.test.ts
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCQM, riskForPriceFair } from '../src/utils/cqm';
import { buildWalkForwardRiskMap } from '../src/utils/cqmWalkForward';
import { runBacktest, BacktestConfig, StrategyResult } from '../src/services/backtest';
import { SignalData } from '../src/App';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint { date: string; close: number }

// Daily closes after btc_daily.json ends (2026-05-23). Source: Kraken XBTUSD
// daily OHLC (UTC), fetched 2026-06-12.
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

function loadData(): { signal: SignalData[]; points: { date: string; ts: number; price: number }[] } {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = [
    ...(JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[]),
    ...REALIZED_TAIL,
  ];
  const signal: SignalData[] = [];
  const points: { date: string; ts: number; price: number }[] = [];
  for (const r of raw) {
    if (!Number.isFinite(r.close) || r.close <= 0) continue;
    const ts = new Date(r.date).getTime();
    points.push({ date: r.date, ts, price: r.close });
    signal.push({
      Date: r.date,
      BTCUSD: r.close,
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
    } as SignalData);
  }
  return { signal, points };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function usd(x: number): string {
  return `$${Math.round(x).toLocaleString('en-US')}`;
}

function report(label: string, r: StrategyResult): void {
  // average cash balance over the window
  let cashSum = 0;
  for (const s of r.series) cashSum += s.portfolioValue - s.btcHeld * s.btcPrice;
  const avgCash = cashSum / Math.max(1, r.series.length);
  console.log(
    `${label.padEnd(42)} ret ${pct(r.totalReturn).padStart(7)} | ` +
    `final ${usd(r.finalPortfolioValue).padStart(9)} | invested ${usd(r.totalInvested)} | ` +
    `BTC ${r.finalBtcHeld.toFixed(4)} | cash ${usd(r.finalCashBalance).padStart(9)} | ` +
    `avgCash ${usd(avgCash).padStart(9)} | maxRetDD ${pct(r.maxReturnDrawdown)}`,
  );
}

describe('verify CQM backtest window', () => {
  it('reproduces 2021-11-08 → 2025-08-06', () => {
    const { signal, points } = loadData();
    const fit = fitCQM(points); // full-history fit, exactly like Backtest.tsx
    const riskByDate = new Map<string, number>();
    for (const s of fit.signals) riskByDate.set(s.date, s.risk);

    const base: BacktestConfig = {
      startDate: '2021-11-08',
      endDate: '2025-08-06',
      dcaAmount: 100,
      frequency: 'daily',
      offSignalMode: 'pause',
      macroAccel: false,
      accelMultiplier: 3,
      cqmDca: true,
      cqmRiskByDate: riskByDate,
    };

    console.log('\n=== Window 2021-11-08 → 2025-08-06, $100/day ===');

    // 1. CQM tab config: short enabled, fraction 0
    const tab = runBacktest(signal, { ...base, cqmTradeFraction: 0, cqmAllowShort: true });
    report('Baseline DCA', tab.find((r) => r.name === 'Baseline DCA')!);
    report('CQM tab (short, frac 0)', tab.find((r) => r.name === 'CQM Risk DCA')!);

    // 2. Lab config: no short, fraction 0
    const lab0 = runBacktest(signal, { ...base, cqmTradeFraction: 0, cqmAllowShort: false });
    report('CQM lab (no short, frac 0)', lab0.find((r) => r.name === 'CQM Risk DCA')!);

    // 3. Reserve-scaled variants
    for (const f of [0.01, 0.02, 0.03, 0.05, 0.10]) {
      const res = runBacktest(signal, { ...base, cqmTradeFraction: f, cqmAllowShort: false });
      report(`CQM lab (no short, frac ${(f * 100).toFixed(0)}%)`, res.find((r) => r.name === 'CQM Risk DCA')!);
    }

    // risk stats over the window for context
    const winRisks = fit.signals.filter((s) => s.date >= base.startDate && s.date <= (base.endDate ?? '9999'));
    const avg = winRisks.reduce((a, s) => a + s.risk, 0) / winRisks.length;
    const below = winRisks.filter((s) => s.risk < 0.5).length;
    console.log(
      `\nCQM risk in window: avg ${pct(avg)}, days<50% risk: ${below}/${winRisks.length} (${pct(below / winRisks.length)})`,
    );

    // Lump-sum buy & hold with the same total capital on day 1 (for the
    // benchmark discussion).
    const win = signal.filter((d) => d.Date >= base.startDate && d.Date <= base.endDate!);
    const p0 = win[0].BTCUSD;
    const p1 = win[win.length - 1].BTCUSD;
    console.log(`Lump-sum B&H same total capital day 1: ret ${pct(p1 / p0 - 1)} (price ${usd(p0)} → ${usd(p1)})`);
  }, 600_000);

  // -------------------------------------------------------------------------
  // Custom sizing rules (same equal-funding sim, $100/day deposit)
  // -------------------------------------------------------------------------
  interface RuleResult { ret: number; finalBtc: number; finalCash: number; avgCash: number; maxRetDD: number }
  function simulateRule(
    win: { date: string; price: number }[],
    riskBy: Map<string, number>,
    rule: (risk: number, cash: number, btcVal: number, base: number) => number, // signed USD, +buy / -sell
  ): RuleResult {
    const baseAmt = 100;
    let cash = 0;
    let btc = 0;
    let deposited = 0;
    let cashSum = 0;
    let peakRatio = -Infinity;
    let maxRetDD = 0;
    for (const d of win) {
      cash += baseAmt;
      deposited += baseAmt;
      const r = riskBy.get(d.date);
      const risk = Number.isFinite(r) ? Math.max(0, Math.min(1, r!)) : 0.5;
      const signed = rule(risk, cash, btc * d.price, baseAmt);
      if (signed > 0) {
        const spend = Math.min(signed, cash);
        btc += spend / d.price;
        cash -= spend;
      } else if (signed < 0) {
        const sellUsd = Math.min(-signed, btc * d.price);
        btc -= sellUsd / d.price;
        cash += sellUsd;
      }
      cashSum += cash;
      // drawdown on portfolio ÷ deposits (same definition as maxReturnDrawdown)
      const ratio = (btc * d.price + cash) / deposited;
      if (ratio > peakRatio) peakRatio = ratio;
      const dd = (peakRatio - ratio) / peakRatio;
      if (dd > maxRetDD) maxRetDD = dd;
    }
    const last = win[win.length - 1].price;
    const final = btc * last + cash;
    return {
      ret: (final - deposited) / deposited,
      finalBtc: btc,
      finalCash: cash,
      avgCash: cashSum / win.length,
      maxRetDD,
    };
  }

  function reportRule(label: string, r: RuleResult): void {
    console.log(
      `${label.padEnd(52)} ret ${pct(r.ret).padStart(7)} | BTC ${r.finalBtc.toFixed(4)} | ` +
      `cash ${usd(r.finalCash).padStart(9)} | avgCash ${usd(r.avgCash).padStart(9)} | maxRetDD ${pct(r.maxRetDD)}`,
    );
  }

  // --- sizing rules under comparison ---------------------------------------
  const ruleCurrent = (R: number, _c: number, _b: number, base: number): number =>
    base * (1 - 2 * R);
  // Dynamic: deploy up to 5%/day of the cash pile at risk 0, tapering to 0 at
  // fair value; symmetric base-sized sells above 0.5.
  const ruleDynamic = (R: number, cash: number, _b: number, base: number): number => {
    if (R < 0.5) {
      const frac = 0.05 * (0.5 - R) / 0.5;
      return Math.max(base * (1 - 2 * R), frac * cash);
    }
    return -base * (2 * R - 1);
  };
  // Dynamic buy side only; never sells.
  const ruleDynamicBuyOnly = (R: number, cash: number, _b: number, base: number): number => {
    if (R >= 0.5) return 0;
    const frac = 0.05 * (0.5 - R) / 0.5;
    return Math.max(base * (1 - 2 * R), frac * cash);
  };

  it('probes improved sizing rules (full-sample risk)', () => {
    const { points } = loadData();
    const fit = fitCQM(points);
    const riskBy = new Map<string, number>();
    for (const s of fit.signals) riskBy.set(s.date, s.risk);
    const win = points
      .filter((p) => p.date >= '2021-11-08' && p.date <= '2025-08-06')
      .map((p) => ({ date: p.date, price: p.price }));

    console.log('\n=== Sizing-rule probes (full-sample risk), same window/deposits ===');

    reportRule('A. current: base×(1−2R)', simulateRule(win, riskBy, (R, _c, _b, base) => base * (1 - 2 * R)));

    reportRule('B. dead zone: sell only R>0.75', simulateRule(win, riskBy, (R, _c, _b, base) => {
      if (R < 0.5) return base * (1 - 2 * R);
      if (R > 0.75) return -base * ((R - 0.75) / 0.25);
      return 0;
    }));

    reportRule('C. cash-frac buy (5% at R=0): max(base rule, frac)', simulateRule(win, riskBy, (R, cash, _b, base) => {
      if (R < 0.5) {
        const frac = 0.05 * (0.5 - R) / 0.5;
        return Math.max(base * (1 - 2 * R), frac * cash);
      }
      return -base * (2 * R - 1);
    }));

    reportRule('D. C-buy + dead-zone sell (1% of BTC, R>0.75)', simulateRule(win, riskBy, (R, cash, btcVal, base) => {
      if (R < 0.5) {
        const frac = 0.05 * (0.5 - R) / 0.5;
        return Math.max(base * (1 - 2 * R), frac * cash);
      }
      if (R > 0.75) return -Math.max(base, 0.01 * btcVal) * ((R - 0.75) / 0.25);
      return 0;
    }));

    reportRule('E. buy-only (never sell) + 5% cash-frac', simulateRule(win, riskBy, (R, cash, _b, base) => {
      if (R >= 0.5) return 0;
      const frac = 0.05 * (0.5 - R) / 0.5;
      return Math.max(base * (1 - 2 * R), frac * cash);
    }));
  }, 600_000);

  // -------------------------------------------------------------------------
  // Walk-forward risk (no look-ahead): expanding-window refit every 90 days,
  // tail calibration disabled (ramp start pushed past the data end).
  // -------------------------------------------------------------------------
  it.runIf(process.env.CQM_WF === '1')('walk-forward risk, no look-ahead', () => {
    const { signal, points } = loadData();
    const startDate = '2021-11-08';
    const endDate = '2025-08-06';
    const wfCfg = { qrAutoCalibrate: false, qrScaleRampStartDate: '2999-01-01' };

    const wfRisk = new Map<string, number>();
    let fitWf: ReturnType<typeof fitCQM> | null = null;
    let daysSince = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.date < startDate || p.date > endDate) continue;
      if (!fitWf || daysSince >= 90) {
        fitWf = fitCQM(points.slice(0, i), wfCfg); // strictly causal: data before day t
        daysSince = 0;
      }
      daysSince += 1;
      let r = riskForPriceFair(fitWf, p.ts, p.price);
      if (!Number.isFinite(r)) r = 0.5;
      wfRisk.set(p.date, Math.max(0, Math.min(1, r)));
    }

    const risks = [...wfRisk.values()];
    const avg = risks.reduce((a, b) => a + b, 0) / risks.length;
    const below = risks.filter((r) => r < 0.5).length;
    console.log(
      `\n=== Walk-forward risk (causal, no tail calibration) ===\n` +
      `avg risk ${pct(avg)}, days<50%: ${below}/${risks.length} (${pct(below / risks.length)})`,
    );

    const base: BacktestConfig = {
      startDate,
      endDate,
      dcaAmount: 100,
      frequency: 'daily',
      offSignalMode: 'pause',
      macroAccel: false,
      accelMultiplier: 3,
      cqmDca: true,
      cqmRiskByDate: wfRisk,
    };
    const tab = runBacktest(signal, { ...base, cqmTradeFraction: 0, cqmAllowShort: true });
    report('WF: CQM tab (short, frac 0)', tab.find((r) => r.name === 'CQM Risk DCA')!);
    const lab1 = runBacktest(signal, { ...base, cqmTradeFraction: 0.01, cqmAllowShort: false });
    report('WF: CQM lab (no short, frac 1%)', lab1.find((r) => r.name === 'CQM Risk DCA')!);

    const win = points
      .filter((p) => p.date >= startDate && p.date <= endDate)
      .map((p) => ({ date: p.date, price: p.price }));
    reportRule('WF D. C-buy + dead-zone sell', simulateRule(win, wfRisk, (R, cash, btcVal, b) => {
      if (R < 0.5) {
        const frac = 0.05 * (0.5 - R) / 0.5;
        return Math.max(b * (1 - 2 * R), frac * cash);
      }
      if (R > 0.75) return -Math.max(b, 0.01 * btcVal) * ((R - 0.75) / 0.25);
      return 0;
    }));
    reportRule('WF E. buy-only + 5% cash-frac', simulateRule(win, wfRisk, (R, cash, _b, b) => {
      if (R >= 0.5) return 0;
      const frac = 0.05 * (0.5 - R) / 0.5;
      return Math.max(b * (1 - 2 * R), frac * cash);
    }));
  }, 1_200_000);

  // -------------------------------------------------------------------------
  // Multi-window comparison: dynamic sizing vs simple DCA vs lump-sum B&H.
  // One causal walk-forward risk map (expanding refit every 90 days, tail
  // calibration disabled) covers all windows; the in-sample (backtest-page)
  // risk map is shown for the current rule as a reference.
  // Slow (~25 refits): run with CQM_WINDOWS=1.
  // -------------------------------------------------------------------------
  it.runIf(process.env.CQM_WINDOWS === '1')('multi-window: dynamic vs DCA vs B&H', () => {
    const { points } = loadData();

    const windows: Array<{ label: string; start: string; end: string }> = [
      { label: '2022 bottom → yesterday', start: '2022-11-21', end: '2026-06-11' },
      { label: 'halving → halving', start: '2020-05-11', end: '2024-04-19' },
      { label: 'last 3 years', start: '2023-06-11', end: '2026-06-11' },
      { label: 'last 5 years', start: '2021-06-11', end: '2026-06-11' },
      { label: 'year to date 2026', start: '2026-01-01', end: '2026-06-11' },
    ];

    // In-sample risk (what the backtest page uses today).
    const fullFit = fitCQM(points);
    const pageRisk = new Map<string, number>();
    for (const s of fullFit.signals) pageRisk.set(s.date, s.risk);

    // Walk-forward risk from the earliest window start onward.
    const wfStart = windows.reduce((a, w) => (w.start < a ? w.start : a), '9999');
    const wfCfg = { qrAutoCalibrate: false, qrScaleRampStartDate: '2999-01-01' };
    const wfRisk = new Map<string, number>();
    let fitWf: ReturnType<typeof fitCQM> | null = null;
    let daysSince = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.date < wfStart) continue;
      if (!fitWf || daysSince >= 90) {
        fitWf = fitCQM(points.slice(0, i), wfCfg);
        daysSince = 0;
      }
      daysSince += 1;
      let r = riskForPriceFair(fitWf, p.ts, p.price);
      if (!Number.isFinite(r)) r = 0.5;
      wfRisk.set(p.date, Math.max(0, Math.min(1, r)));
    }

    for (const w of windows) {
      const win = points
        .filter((p) => p.date >= w.start && p.date <= w.end)
        .map((p) => ({ date: p.date, price: p.price }));
      if (win.length === 0) {
        console.log(`\n### ${w.label}: no data`);
        continue;
      }
      const p0 = win[0].price;
      const p1 = win[win.length - 1].price;
      // B&H drawdown = price drawdown over the window.
      let peak = -Infinity;
      let bhDD = 0;
      for (const d of win) {
        if (d.price > peak) peak = d.price;
        bhDD = Math.max(bhDD, (peak - d.price) / peak);
      }
      const wfWin = win.map((d) => wfRisk.get(d.date)).filter((r): r is number => Number.isFinite(r));
      const wfAvg = wfWin.reduce((a, b) => a + b, 0) / Math.max(1, wfWin.length);

      console.log(
        `\n### ${w.label} (${w.start} → ${w.end}, ${win.length}d, ` +
        `${usd(p0)} → ${usd(p1)}, WF avg risk ${pct(wfAvg)})`,
      );
      console.log(
        `${'Lump-sum B&H (same capital day 1)'.padEnd(52)} ret ${pct(p1 / p0 - 1).padStart(7)} | ` +
        `maxDD ${pct(bhDD)}`,
      );
      reportRule('Simple DCA', simulateRule(win, new Map(), (_R, _c, _b, base) => base * 2)); // always buy full deposit
      reportRule('CQM current rule — page risk (in-sample)', simulateRule(win, pageRisk, ruleCurrent));
      reportRule('CQM current rule — WF risk', simulateRule(win, wfRisk, ruleCurrent));
      reportRule('CQM dynamic (5% cash-frac) — WF risk', simulateRule(win, wfRisk, ruleDynamic));
      reportRule('CQM dynamic buy-only — WF risk', simulateRule(win, wfRisk, ruleDynamicBuyOnly));
    }
  }, 1_800_000);

  // -------------------------------------------------------------------------
  // Integration check: production pipeline (buildWalkForwardRiskMap +
  // runBacktest with dynamic sizing defaults) on the halving→halving window.
  // Run with CQM_INTEGRATION=1 (slow: ~1 min of refits).
  // -------------------------------------------------------------------------
  it.runIf(process.env.CQM_INTEGRATION === '1')('production pipeline on halving window', () => {
    const { signal, points } = loadData();
    const wfRisk = buildWalkForwardRiskMap(points, { fromDate: '2020-05-11' });

    const results = runBacktest(signal, {
      startDate: '2020-05-11',
      endDate: '2024-04-19',
      dcaAmount: 100,
      frequency: 'daily',
      offSignalMode: 'pause',
      macroAccel: false,
      accelMultiplier: 3,
      cqmDca: true,
      cqmRiskByDate: wfRisk,
      // dynamic sizing defaults (6% / 0.75) via omitted overrides
    });

    console.log('\n=== Production pipeline, halving → halving ===');
    for (const r of results) {
      console.log(
        `${r.name.padEnd(16)} ret ${pct(r.totalReturn).padStart(7)} | ` +
        `IRR ${pct(r.annualizedIrr).padStart(7)} | maxRetDD ${pct(r.maxReturnDrawdown)} | ` +
        `ret/DD ${Number.isFinite(r.returnOverMaxDrawdown) ? r.returnOverMaxDrawdown.toFixed(2) : 'n/a'} | ` +
        `avgCash ${usd(r.avgCashBalance)} | BTC ${r.finalBtcHeld.toFixed(4)}`,
      );
    }
  }, 1_200_000);
});
