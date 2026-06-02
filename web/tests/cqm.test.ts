import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fitCQM, snapshotAt, computeGateBlendWeight, blendGatedRisk } from '../src/utils/cqm';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint {
  date: string;
  close: number;
}

function loadBtcPoints(): { date: string; ts: number; price: number }[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  return raw
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .map((r) => ({ date: r.date, ts: new Date(r.date).getTime(), price: r.close }));
}

describe('CoinStrat Quantile Model', () => {
  const points = loadBtcPoints();
  // Most recent data point in the local cache
  const latest = points[points.length - 1];

  it('loads enough BTC history to fit', () => {
    expect(points.length).toBeGreaterThan(2000);
  });

  it('produces a stable fit and a reasonable snapshot at the latest date', () => {
    const fit = fitCQM(points);
    // Default startDate filters out pre-2014 history; expect the fit to cover
    // every post-startDate input point.
    const expectedN = points.filter(
      (p) => p.ts >= new Date('2014-01-01').getTime(),
    ).length;
    expect(fit.signals.length).toBe(expectedN);
    expect(fit.timePower).toBeCloseTo(0.6, 6);
    expect(fit.scorePower).toBeCloseTo(1.5, 6);
    // QR median trend should be a positive log-linear fit
    expect(fit.qrSlope).toBeGreaterThan(0);
    expect(Number.isFinite(fit.qrIntercept)).toBe(true);
    expect(fit.upperAthFactor).toBeCloseTo(1.28, 6);
    expect(fit.solidGoldWindow).toBe(730);
    expect(fit.solidGoldFloorWindow).toBe(30);
    expect(fit.solidGoldFloorBuffer).toBeCloseTo(2.0, 6);
    expect(fit.solidGreenHalfLifeYears).toBeCloseTo(1.0, 6);
    expect(fit.solidGreenQuantile).toBeCloseTo(0.05, 6);
    expect(fit.solidGreenFloorWindow).toBe(30);
    expect(fit.solidGreenFloorBuffer).toBeCloseTo(0.95, 6);
    expect(fit.solidGreenWarmupOffset).toBeLessThan(0);

    const snapshot = snapshotAt(fit);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.date).toBe(latest.date);
    expect(snapshot.price).toBeCloseTo(latest.price, 6);
    // Sanity-check ranges for an end-of-2025 / 2026 snapshot
    expect(snapshot.solidLower).toBeGreaterThan(0);
    expect(snapshot.solidLower).toBeLessThan(snapshot.solidMedian);
    // Upper is max(rolling_ATH * upper_ath_factor, QR median). When the QR
    // median has caught up to the ATH-anchored ceiling the band collapses
    // and median == upper, which is fine; we only require >=.
    expect(snapshot.solidUpper).toBeGreaterThanOrEqual(snapshot.solidMedian);
    expect(snapshot.risk).toBeGreaterThanOrEqual(0);
    expect(snapshot.risk).toBeLessThanOrEqual(1);
    expect(snapshot.score).toBeGreaterThanOrEqual(0);
    expect(snapshot.score).toBeLessThanOrEqual(1);
    // For score_power = 1.5, score should be <= risk for risk in [0, 1]
    expect(snapshot.score).toBeLessThanOrEqual(snapshot.risk + 1e-9);
  });

  it('matches the BTCAnalytica chart at 2026-05-22', () => {
    const fit = fitCQM(points);
    const ts = new Date('2026-05-22').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    // Reference values for 2026-05-22:
    //   - Price / Risk / QR median: from the Python replica (matches the
    //     statsmodels QR fit at q=0.5).
    //   - Solid bands: from the BTCAnalytica chart's snapshot box.
    //
    //   Price       $75.5K  (BTC close)
    //   EQM Risk    28.6%   (replica, OLS-residual percentile)
    //   QR 50%      $125.3K (replica QR median)
    //   EQM 50%     $108.4K (BTCAnalytica solid gold)
    //   EQM 99.9%   $159.4K (BTCAnalytica solid red)
    //   EQM 0.1%    $45.4K  (BTCAnalytica solid green)
    //
    // The TS port targets the BTCAnalytica solid bands (NOT the Python
    // replica's QR-median-based solid bands, which produced parabolic
    // gold and green lines).
    expect(snapshot.price).toBeCloseTo(75466.52, 0);
    expect(snapshot.risk * 100).toBeCloseTo(28.6, 0); // ±0.5%
    // Solid red: rolling_ATH × 1.28; matches chart within 0.2%.
    expect(snapshot.solidUpper / 1000).toBeCloseTo(159.6, 0);
    // Solid gold: rolling-730d Q0.5 of (price/ATH) × ATH(t), running-max.
    // Fits chart's $108.4K within ~3.5% (predicted $111.9K).
    expect(snapshot.solidMedian / 1000).toBeGreaterThan(105);
    expect(snapshot.solidMedian / 1000).toBeLessThan(115);
    // Solid green: time-decayed weighted Q0.05 of (price/ATH) × ATH(t),
    // running-max, then clipped from above by 0.95 × rolling-min(price, 30d)
    // so it acts as a true floor at cycle bottoms. Fits chart's $45.4K
    // within ~6% (predicted $47.8K) — the price-floor constraint doesn't
    // bind here because BTC is well above the shelved level.
    expect(snapshot.solidLower / 1000).toBeGreaterThan(44);
    expect(snapshot.solidLower / 1000).toBeLessThan(50);
    expect(snapshot.solidLower).toBeLessThan(snapshot.solidMedian);
    // Green should be below price by a meaningful margin
    expect(snapshot.solidLower).toBeLessThan(snapshot.price);
    // Score = risk^score_power, with score_power=1.5
    const expectedScore = Math.pow(snapshot.risk, 1.5);
    expect(snapshot.score).toBeCloseTo(expectedScore, 6);
  });

  it('GOLD band stays approximately between RED and GREEN at every cycle date', () => {
    const fit = fitCQM(points);
    // The price-relative ceiling pulls gold down at deep bear bottoms,
    // keeping it between red and green instead of plateauing at the
    // previous-cycle bull peak.
    const cycleDates = [
      { date: '2017-12-17', desc: 'cycle 2 ATH' },
      { date: '2018-12-15', desc: 'cycle 2 bottom' },
      { date: '2021-11-10', desc: 'cycle 3 ATH' },
      { date: '2022-11-21', desc: 'cycle 3 bottom' },
      { date: '2024-08-05', desc: 'cycle 4 mid-correction' },
      { date: '2026-05-22', desc: 'snapshot' },
    ];
    for (const { date, desc } of cycleDates) {
      const ts = new Date(date).getTime();
      const snapshot = snapshotAt(fit, ts);
      expect(snapshot, `snapshot at ${date} (${desc})`).not.toBeNull();
      if (!snapshot) continue;
      // Gold is strictly between green and red.
      expect(
        snapshot.solidMedian,
        `gold > green at ${date} (${desc})`,
      ).toBeGreaterThan(snapshot.solidLower);
      expect(
        snapshot.solidMedian,
        `gold < red at ${date} (${desc})`,
      ).toBeLessThan(snapshot.solidUpper);
    }
  });

  it('GREEN band acts as a true price floor at every cycle bottom', () => {
    const fit = fitCQM(points);
    // The price-floor constraint should keep the green band below BTC at
    // each major cycle bottom (within the 5% safety buffer).
    const cycleBottoms = [
      { date: '2015-01-15', desc: 'cycle 1' },
      { date: '2018-12-15', desc: 'cycle 2' },
      { date: '2020-03-15', desc: 'covid crash' },
      { date: '2022-11-21', desc: 'cycle 3' },
    ];
    for (const { date, desc } of cycleBottoms) {
      const ts = new Date(date).getTime();
      const snapshot = snapshotAt(fit, ts);
      expect(snapshot, `snapshot at ${date} (${desc})`).not.toBeNull();
      if (!snapshot) continue;
      // Green must be strictly below price at the bottom — confirms the
      // floor constraint is working. The 0.95 buffer means the worst-case
      // ratio is ~0.95.
      expect(
        snapshot.solidLower,
        `green should be below BTC at ${date} (${desc})`,
      ).toBeLessThan(snapshot.price);
      expect(
        snapshot.solidLower / snapshot.price,
        `green/price ratio at ${date} (${desc})`,
      ).toBeLessThanOrEqual(0.96);
    }
  });

  it('RED band matches BTCAnalytica chart at 2026-05-22 within 0.5%', () => {
    const fit = fitCQM(points);
    const ts = new Date('2026-05-22').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    const chartRed = 159_400;
    const err = Math.abs(snapshot.solidUpper - chartRed) / chartRed;
    expect(err).toBeLessThan(0.005);
  });

  it('gated 2y risk preserves today calibration and lowers cycle-bottom risk', () => {
    const globalFit = fitCQM(points, { riskMode: 'global' });
    const gatedFit = fitCQM(points, { riskMode: 'gated' });

    const snapshotTs = new Date('2026-05-22').getTime();
    const globalSnap = snapshotAt(globalFit, snapshotTs);
    const gatedSnap = snapshotAt(gatedFit, snapshotTs);
    expect(globalSnap).not.toBeNull();
    expect(gatedSnap).not.toBeNull();
    if (!globalSnap || !gatedSnap) return;

    // Gated mode must not change today's risk vs global (reference ~28.6%).
    expect(gatedSnap.risk).toBeCloseTo(globalSnap.risk, 6);
    expect(gatedSnap.risk * 100).toBeCloseTo(28.6, 0);

    const bottoms = ['2015-01-15', '2018-12-15', '2020-03-15', '2022-11-21'];
    for (const date of bottoms) {
      const ts = new Date(date).getTime();
      const g = snapshotAt(globalFit, ts);
      const gated = snapshotAt(gatedFit, ts);
      expect(g, date).not.toBeNull();
      expect(gated, date).not.toBeNull();
      if (!g || !gated) continue;
      expect(gated.risk).toBeLessThanOrEqual(g.risk + 1e-9);
      expect(gated.risk).toBeLessThanOrEqual(0.15);
    }
  });

  it('pure rolling risk would over-buy today (sanity check)', () => {
    const rollingFit = fitCQM(points, { riskMode: 'rolling' });
    const gatedFit = fitCQM(points, { riskMode: 'gated' });
    const ts = new Date('2026-05-22').getTime();
    const rollingSnap = snapshotAt(rollingFit, ts);
    const gatedSnap = snapshotAt(gatedFit, ts);
    expect(rollingSnap).not.toBeNull();
    expect(gatedSnap).not.toBeNull();
    if (!rollingSnap || !gatedSnap) return;
    // Rolling-only collapses today's risk; gated preserves the global reading.
    expect(rollingSnap.risk).toBeLessThan(gatedSnap.risk - 0.05);
  });

  it('gate blend weight ramps linearly between near-low enter and the raw low', () => {
    const cfg = { riskGateNearBuffer: 1.15 };
    const nearLow = 100;
    expect(computeGateBlendWeight(116, nearLow, cfg)).toBe(0);
    expect(computeGateBlendWeight(100, nearLow, cfg)).toBe(1);
    expect(computeGateBlendWeight(107.5, nearLow, cfg)).toBeCloseTo(0.5, 6);
  });

  it('blendGatedRisk preserves global at weight 0 and min(global, rolling) at weight 1', () => {
    expect(blendGatedRisk(0.25, 0, 0)).toBeCloseTo(0.25, 6);
    expect(blendGatedRisk(0.25, 0, 1)).toBeCloseTo(0, 6);
    expect(blendGatedRisk(0.25, 0, 0.5)).toBeCloseTo(0.125, 6);
    expect(blendGatedRisk(0.20, 0.30, 1)).toBeCloseTo(0.20, 6);
  });

  it('gated blend softens near-low entry without a single-day cliff to zero', () => {
    const extension = [
      { date: '2026-05-24', ts: new Date('2026-05-24').getTime(), price: 77001 },
      { date: '2026-05-25', ts: new Date('2026-05-25').getTime(), price: 77273.26 },
      { date: '2026-05-26', ts: new Date('2026-05-26').getTime(), price: 75842.51 },
      { date: '2026-05-27', ts: new Date('2026-05-27').getTime(), price: 74348.55 },
      { date: '2026-05-28', ts: new Date('2026-05-28').getTime(), price: 73531.95 },
      { date: '2026-05-29', ts: new Date('2026-05-29').getTime(), price: 73384.46 },
      { date: '2026-05-30', ts: new Date('2026-05-30').getTime(), price: 73794.27 },
      { date: '2026-05-31', ts: new Date('2026-05-31').getTime(), price: 73601.92 },
      { date: '2026-06-01', ts: new Date('2026-06-01').getTime(), price: 71329.41 },
      { date: '2026-06-02', ts: new Date('2026-06-02').getTime(), price: 67587.2 },
    ];
    const extended = [...points, ...extension];
    const fit = fitCQM(extended, { riskMode: 'gated' });
    const may31 = fit.signals.find((s) => s.date === '2026-05-31');
    const jun1 = fit.signals.find((s) => s.date === '2026-06-01');
    const jun2 = fit.signals.find((s) => s.date === '2026-06-02');
    expect(may31).toBeDefined();
    expect(jun1).toBeDefined();
    expect(jun2).toBeDefined();
    if (!may31 || !jun1 || !jun2) return;

    const oneDayDrop = may31.risk - jun1.risk;
    expect(oneDayDrop).toBeGreaterThan(0.02);
    expect(oneDayDrop).toBeLessThan(0.20);
    expect(jun1.risk).toBeGreaterThan(0.03);
    expect(jun2.risk).toBeLessThanOrEqual(jun1.risk + 1e-9);
  });

  it('exposes asymmetric QR fan values at the snapshot date', () => {
    const fit = fitCQM(points);
    const ts = new Date('2026-05-22').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.qrDashedLow).toBeGreaterThan(0);
    expect(snapshot.qrDashedMedian).toBeGreaterThan(snapshot.qrDashedLow);
    expect(snapshot.qrDashedHigh).toBeGreaterThan(snapshot.qrDashedMedian);
    // Upper QR tail should bend (compress) — at snapshot median below old OLS fan
    expect(snapshot.qrDashedMedian / 1000).toBeGreaterThan(100);
    expect(snapshot.qrDashedMedian / 1000).toBeLessThan(140);
  });
});
