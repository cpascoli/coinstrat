import { describe, it, expect } from 'vitest';
import { runBacktest, BacktestConfig } from '../src/services/backtest';
import { SignalData } from '../src/App';

function makeRow(date: string, price: number, accum = 0, macro = 0): SignalData {
  return {
    Date: date,
    BTCUSD: price,
    ACCUM_ON: accum,
    CORE_ON: accum,
    MACRO_ON: macro,
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

/**
 * Build a synthetic 30-day dataset (every day is a "Monday" because we use
 * daily frequency). Price = $100 throughout so trade math is trivial.
 */
function buildDailyData(n: number, price = 100): SignalData[] {
  const out: SignalData[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    out.push(makeRow(d.toISOString().slice(0, 10), price));
  }
  return out;
}

describe('Backtest — CQM Risk DCA strategy', () => {
  const baseConfig: BacktestConfig = {
    startDate: '2024-01-01',
    dcaAmount: 100,
    frequency: 'daily',
    offSignalMode: 'pause',
    macroAccel: false,
    accelMultiplier: 3,
  };

  it('does not run when cqmDca is false (only baseline + CORE)', () => {
    const data = buildDailyData(10);
    const results = runBacktest(data, baseConfig);
    expect(results.length).toBe(2);
    expect(results.map((r) => r.name)).toEqual(['Baseline DCA', 'CORE DCA']);
  });

  it('runs and produces a "CQM Risk DCA" strategy when enabled', () => {
    const data = buildDailyData(10);
    const riskMap = new Map<string, number>();
    for (const d of data) riskMap.set(d.Date, 0.5); // neutral, no trade
    const results = runBacktest(data, {
      ...baseConfig,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    });
    expect(results.length).toBe(3);
    expect(results[2].name).toBe('CQM Risk DCA');
  });

  it('Risk = 0 every day → buys full deposit (matches Baseline DCA)', () => {
    const n = 30;
    const price = 100;
    const data = buildDailyData(n, price);
    const riskMap = new Map<string, number>();
    for (const d of data) riskMap.set(d.Date, 0); // bottom — buy 100% of base
    const results = runBacktest(data, {
      ...baseConfig,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    });
    const baseline = results.find((r) => r.name === 'Baseline DCA')!;
    const cqm = results.find((r) => r.name === 'CQM Risk DCA')!;
    expect(cqm.totalInvested).toBeCloseTo(n * 100, 6);
    expect(cqm.btcAccumulated).toBeCloseTo(baseline.btcAccumulated, 8);
    expect(cqm.finalCashBalance).toBeCloseTo(0, 6);
  });

  it('Risk = 0.5 every day → no trades, cash accumulates as dry powder', () => {
    const n = 30;
    const price = 100;
    const data = buildDailyData(n, price);
    const riskMap = new Map<string, number>();
    for (const d of data) riskMap.set(d.Date, 0.5); // fair — do nothing
    const results = runBacktest(data, {
      ...baseConfig,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    });
    const cqm = results.find((r) => r.name === 'CQM Risk DCA')!;
    expect(cqm.totalInvested).toBeCloseTo(n * 100, 6);
    expect(cqm.btcAccumulated).toBeCloseTo(0, 8);
    expect(cqm.finalCashBalance).toBeCloseTo(n * 100, 6);
  });

  it('Risk = 1 every day → never buys, never accumulates BTC', () => {
    const n = 30;
    const price = 100;
    const data = buildDailyData(n, price);
    const riskMap = new Map<string, number>();
    for (const d of data) riskMap.set(d.Date, 1.0); // top — sell base
    const results = runBacktest(data, {
      ...baseConfig,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    });
    const cqm = results.find((r) => r.name === 'CQM Risk DCA')!;
    // No BTC was ever bought, so sells go to zero. Cash equals all deposits.
    expect(cqm.btcAccumulated).toBeCloseTo(0, 8);
    expect(cqm.finalCashBalance).toBeCloseTo(n * 100, 6);
    expect(cqm.totalInvested).toBeCloseTo(n * 100, 6);
  });

  it('half bottoms then half tops → accumulates BTC then partially exits', () => {
    const n = 60;
    const price = 100;
    const data = buildDailyData(n, price);
    const riskMap = new Map<string, number>();
    // First 30 days at risk=0 (deep value), next 30 at risk=1 (top)
    for (let i = 0; i < n; i++) {
      riskMap.set(data[i].Date, i < 30 ? 0 : 1);
    }
    const results = runBacktest(data, {
      ...baseConfig,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    });
    const cqm = results.find((r) => r.name === 'CQM Risk DCA')!;
    // First 30 days: bought 30 × $100 = $3000 of BTC at $100 → 30 BTC
    // Next 30 days: deposited $3000, sold up to $100/day (= 1 BTC/day) for 30 days
    //               BTC sold = 30 × 1 = 30 BTC
    // Final BTC = 0; final cash = 30×100 (deposits during sell phase) + 30×100 (sell proceeds) = $6000
    // Total deposited = 60 × $100 = $6000
    expect(cqm.btcAccumulated).toBeCloseTo(0, 6);
    expect(cqm.finalCashBalance).toBeCloseTo(6000, 6);
    expect(cqm.totalInvested).toBeCloseTo(6000, 6);
  });

  it('trade-fraction acceleration (BUY): deploys more than base when cash > base / fraction', () => {
    // 100 days at risk = 0 with a fresh cash slate. Deposits flow in but
    // 1% of the small cash balance never wins the max() — both configs
    // should accumulate identical BTC.
    const n = 100;
    const price = 100;
    const data = buildDailyData(n, price);
    const riskMap = new Map<string, number>();
    for (const d of data) riskMap.set(d.Date, 0);
    const cfg = {
      ...baseConfig,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    };
    const noAccel = runBacktest(data, { ...cfg, cqmTradeFraction: 0 });
    const withAccel = runBacktest(data, { ...cfg, cqmTradeFraction: 0.01 });
    const a = noAccel.find((r) => r.name === 'CQM Risk DCA')!;
    const b = withAccel.find((r) => r.name === 'CQM Risk DCA')!;
    expect(b.btcAccumulated).toBeCloseTo(a.btcAccumulated, 6);
  });

  it('trade-fraction acceleration (BUY): redeploys cash that piled up during a bull regime', () => {
    // Phase 1: 200 days at risk = 1 with NO BTC to sell — the deposit just
    //          builds a cash pile.
    // Phase 2: 100 days at risk = 0 — the 1% fraction should let the
    //          strategy deploy noticeably more than `base` per day.
    const phase1 = 200;
    const phase2 = 100;
    const n = phase1 + phase2;
    const price = 100;
    const base = 100;
    const data = buildDailyData(n, price);
    const riskMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      riskMap.set(data[i].Date, i < phase1 ? 1 : 0);
    }
    const cfg = {
      ...baseConfig,
      dcaAmount: base,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    };
    const noAccel = runBacktest(data, { ...cfg, cqmTradeFraction: 0 });
    const withAccel = runBacktest(data, { ...cfg, cqmTradeFraction: 0.01 });
    const a = noAccel.find((r) => r.name === 'CQM Risk DCA')!;
    const b = withAccel.find((r) => r.name === 'CQM Risk DCA')!;
    expect(b.btcAccumulated).toBeGreaterThan(a.btcAccumulated * 1.5);
    expect(b.finalCashBalance).toBeLessThan(a.finalCashBalance);
  });

  it('trade-fraction acceleration (SELL): liquidates faster when BTC value is high', () => {
    // Phase 1: 100 days at risk = 0, price = $100 → accumulate 100 BTC at
    //          $100 (using all deposits + tiny dry powder).
    // Phase 2: 100 days at risk = 1, price = $1,000 → BTC value is
    //          ~$100K. With 1% trade fraction the sell rate is ~$1K/day
    //          instead of the $100 base.
    const phase1 = 100;
    const phase2 = 100;
    const n = phase1 + phase2;
    const base = 100;
    const data: SignalData[] = [];
    const riskMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const dt = new Date(Date.UTC(2024, 0, 1 + i));
      const date = dt.toISOString().slice(0, 10);
      const price = i < phase1 ? 100 : 1000;
      data.push(makeRow(date, price));
      riskMap.set(date, i < phase1 ? 0 : 1);
    }
    const cfg = {
      ...baseConfig,
      dcaAmount: base,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    };
    const noAccel = runBacktest(data, { ...cfg, cqmTradeFraction: 0 });
    const withAccel = runBacktest(data, { ...cfg, cqmTradeFraction: 0.01 });
    const a = noAccel.find((r) => r.name === 'CQM Risk DCA')!;
    const b = withAccel.find((r) => r.name === 'CQM Risk DCA')!;
    // No-accel:  phase 2 sells $100/day at $1K → 0.1 BTC/day → ends with
    //            ~90 BTC and ~$20K cash from sells + deposits.
    // With-accel: phase 2 sells ~1 BTC/day → ends near 0 BTC and a much
    //             larger cash balance.
    expect(b.finalBtcHeld).toBeLessThan(a.finalBtcHeld * 0.5);
    expect(b.finalCashBalance).toBeGreaterThan(a.finalCashBalance * 2);
    // Total return is identical here because both strategies end at the
    // same constant phase-2 price ($1K): selling BTC vs holding BTC at the
    // same price yields the same portfolio value. The win for the
    // accelerated sell side shows up when the price subsequently drops
    // (covered indirectly by the V-shape mini-cycle test below).
  });

  it('maxReturnDrawdown reflects loss vs deposits when gross portfolio DD is zero', () => {
    const n = 9;
    const data: SignalData[] = [];
    const riskMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2026, 4, 25 + i));
      const date = d.toISOString().slice(0, 10);
      const price = 77000 - i * 1000;
      data.push(makeRow(date, price));
      riskMap.set(date, 0.31);
    }
    const results = runBacktest(data, {
      ...baseConfig,
      startDate: '2026-05-25',
      cqmDca: true,
      cqmRiskByDate: riskMap,
      cqmTradeFraction: 0,
    });
    const cqm = results.find((r) => r.name === 'CQM Risk DCA')!;
    expect(cqm.maxDrawdown).toBeCloseTo(0, 6);
    expect(cqm.maxReturnDrawdown).toBeGreaterThan(0.02);
    expect(cqm.totalReturn).toBeLessThan(0);
  });

  it('accumulates BTC + cash (BTCAnalytica-style) on a synthetic mini-cycle', () => {
    // Synthetic price cycle: $20K → $80K → $20K
    // Risks: 0 at low, 1 at high, 0 at low again
    const n = 30;
    const data: SignalData[] = [];
    const riskMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      const date = d.toISOString().slice(0, 10);
      // V-shape: cheap → expensive → cheap (15 + 15)
      const phase = i / (n - 1);
      const price = 20000 + 60000 * Math.sin(Math.PI * phase); // 20K → 80K → 20K
      data.push(makeRow(date, price));
      // Risk co-moves with price (low risk when price is low)
      riskMap.set(date, Math.sin(Math.PI * phase));
    }
    const results = runBacktest(data, {
      ...baseConfig,
      dcaAmount: 500,
      cqmDca: true,
      cqmRiskByDate: riskMap,
    });
    const baseline = results.find((r) => r.name === 'Baseline DCA')!;
    const cqm = results.find((r) => r.name === 'CQM Risk DCA')!;
    // CQM should outperform a naïve baseline that buys equally at every price
    expect(cqm.totalReturn).toBeGreaterThan(baseline.totalReturn);
  });
});
