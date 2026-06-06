import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  fitCQM,
  snapshotAt,
  buildRiskPriceCurve,
  riskForPriceFair,
  priceForRiskFair,
  computeGateBlendWeight,
  blendGatedRisk,
  softenGateBlendWeight,
  applySoftGatedRisk,
} from '../src/utils/cqm';

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

/** Binance daily tail through 2026-06-06 (not always present in the static JSON). */
const BTC_TAIL_EXTENSION = [
  { date: '2026-05-24', price: 77001 },
  { date: '2026-05-25', price: 77273.26 },
  { date: '2026-05-26', price: 75842.51 },
  { date: '2026-05-27', price: 74348.55 },
  { date: '2026-05-28', price: 73531.95 },
  { date: '2026-05-29', price: 73384.46 },
  { date: '2026-05-30', price: 73794.27 },
  { date: '2026-05-31', price: 73601.92 },
  { date: '2026-06-01', price: 71329.41 },
  { date: '2026-06-02', price: 67587.2 },
  { date: '2026-06-03', price: 68962.85 },
  { date: '2026-06-04', price: 67074.14 },
  { date: '2026-06-05', price: 63710.54 },
  { date: '2026-06-06', price: 60600.46 },
].map((r) => ({ ...r, ts: new Date(r.date).getTime() }));

function withTail(points: { date: string; ts: number; price: number }[]) {
  const seen = new Set(points.map((p) => p.date));
  const extra = BTC_TAIL_EXTENSION.filter((p) => !seen.has(p.date));
  return [...points, ...extra];
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
    // v1b solids: upper is tail-scaled QR 99.9%. When it converges with the
    // gold SMA median the band can collapse (median == upper); we only require >=.
    expect(snapshot.solidUpper).toBeGreaterThanOrEqual(snapshot.solidMedian);
    expect(snapshot.risk).toBeGreaterThanOrEqual(0);
    expect(snapshot.risk).toBeLessThanOrEqual(1);
    expect(snapshot.score).toBeGreaterThanOrEqual(0);
    expect(snapshot.score).toBeLessThanOrEqual(1);
    // For score_power = 1.5, score should be <= risk for risk in [0, 1]
    expect(snapshot.score).toBeLessThanOrEqual(snapshot.risk + 1e-9);
  });

  it('matches the fair-value QR calibration at 2026-05-28', () => {
    const fit = fitCQM(withTail(points));
    const ts = new Date('2026-05-28').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.price).toBeCloseTo(73531.95, -1);
    expect(snapshot.risk * 100).toBeGreaterThan(28);
    expect(snapshot.risk * 100).toBeLessThan(42);
    expect(snapshot.qrDashedMedian / 1000).toBeCloseTo(100.8, 0);
    expect(snapshot.solidMedian).toBeGreaterThan(snapshot.solidLower);
    expect(snapshot.solidUpper).toBeGreaterThan(snapshot.solidMedian);
    expect(snapshot.solidLower).toBeLessThan(snapshot.price);
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

  it('QR 0.1% band stays below price at major cycle bottoms', () => {
    const fit = fitCQM(points);
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
      expect(
        snapshot.solidLower,
        `QR 0.1% should be below BTC at ${date} (${desc})`,
      ).toBeLessThan(snapshot.price);
    }
  });

  it('scaled QR 99.9% band is ordered above gold at 2026-05-28', () => {
    const fit = fitCQM(withTail(points));
    const ts = new Date('2026-05-28').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.solidUpper).toBeGreaterThan(snapshot.solidMedian);
    expect(snapshot.qrDashedHigh).toBeCloseTo(snapshot.solidUpper, -1);
  });

  it('gated 2y risk preserves May-28 calibration and lowers cycle-bottom risk', () => {
    const extended = withTail(points);
    const globalFit = fitCQM(extended, { riskMode: 'global' });
    const gatedFit = fitCQM(extended, { riskMode: 'gated' });

    const snapshotTs = new Date('2026-05-28').getTime();
    const globalSnap = snapshotAt(globalFit, snapshotTs);
    const gatedSnap = snapshotAt(gatedFit, snapshotTs);
    expect(globalSnap).not.toBeNull();
    expect(gatedSnap).not.toBeNull();
    if (!globalSnap || !gatedSnap) return;

    expect(gatedSnap.risk).toBeCloseTo(globalSnap.risk, 6);
    expect(gatedSnap.risk * 100).toBeGreaterThan(28);
    expect(gatedSnap.risk * 100).toBeLessThan(42);

    const bottoms = ['2015-01-15', '2018-12-15', '2020-03-15', '2022-11-21'];
    for (const date of bottoms) {
      const ts = new Date(date).getTime();
      const g = snapshotAt(globalFit, ts);
      const gated = snapshotAt(gatedFit, ts);
      expect(g, date).not.toBeNull();
      expect(gated, date).not.toBeNull();
      if (!g || !gated) continue;
      expect(gated.risk).toBeLessThanOrEqual(g.risk + 1e-9);
      expect(gated.risk).toBeLessThanOrEqual(0.20);
    }
  });

  it('pure rolling risk would over-buy today (sanity check)', () => {
    const extended = withTail(points);
    const rollingFit = fitCQM(extended, { riskMode: 'rolling' });
    const gatedFit = fitCQM(extended, { riskMode: 'gated' });
    const ts = new Date('2026-05-28').getTime();
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

  it('softenGateBlendWeight slows linear gate engagement', () => {
    expect(softenGateBlendWeight(0.5, 2)).toBeCloseTo(0.25, 6);
    expect(softenGateBlendWeight(1, 2)).toBeCloseTo(1, 6);
    expect(softenGateBlendWeight(0, 2)).toBeCloseTo(0, 6);
  });

  it('applySoftGatedRisk floors gated risk as a fraction of global', () => {
    const cfg = { riskGateWeightPower: 2, riskGateGlobalFloor: 0.75 };
    // weight 0 → global only
    expect(applySoftGatedRisk(0.128, 0, 0, cfg)).toBeCloseTo(0.128, 6);
    // full gate, rolling 0, global 12.8% → floor 9.6%
    expect(applySoftGatedRisk(0.128, 0, 1, cfg)).toBeCloseTo(0.096, 6);
    // partial gate: softer than hard blend, above floor
    expect(applySoftGatedRisk(0.223, 0, 0.09, cfg)).toBeCloseTo(0.221, 2);
  });

  it('gated blend softens near-low entry without a single-day cliff to zero', () => {
    const extended = withTail(points);
    const fit = fitCQM(extended, { riskMode: 'gated' });
    const may31 = fit.signals.find((s) => s.date === '2026-05-31');
    const jun1 = fit.signals.find((s) => s.date === '2026-06-01');
    const jun2 = fit.signals.find((s) => s.date === '2026-06-02');
    expect(may31).toBeDefined();
    expect(jun1).toBeDefined();
    expect(jun2).toBeDefined();
    if (!may31 || !jun1 || !jun2) return;

    const oneDayDrop = may31.risk - jun1.risk;
    // Soft gate: gradual transition, not a cliff to zero.
    expect(oneDayDrop).toBeGreaterThan(0);
    expect(oneDayDrop).toBeLessThan(0.10);
    expect(jun1.risk).toBeGreaterThan(0.15);
    expect(jun2.risk).toBeLessThanOrEqual(jun1.risk + 1e-9);
    expect(jun2.risk).toBeGreaterThan(0.10);
  });

  it('exposes scaled asymmetric QR fan values at the snapshot date', () => {
    const fit = fitCQM(withTail(points));
    const ts = new Date('2026-05-28').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.qrDashedLow).toBeGreaterThan(0);
    expect(snapshot.qrDashedMedian).toBeGreaterThan(snapshot.qrDashedLow);
    expect(snapshot.qrDashedHigh).toBeGreaterThan(snapshot.qrDashedMedian);
    expect(snapshot.qrDashedMedian / 1000).toBeCloseTo(100.8, 0);
  });

  it('builds a monotonic risk-vs-price curve with invertible knot prices', () => {
    const fit = fitCQM(withTail(points));
    const ts = new Date('2026-06-06').getTime();
    const snapshot = snapshotAt(fit, ts);
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    const curve = buildRiskPriceCurve(fit, ts, 120);
    expect(curve.length).toBe(120);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].riskPct).toBeGreaterThanOrEqual(curve[i - 1].riskPct - 1e-9);
    }

    for (const risk of [0, 0.25, 0.5, 0.75, 1]) {
      const price = priceForRiskFair(fit, ts, risk);
      expect(price).toBeGreaterThan(0);
      expect(riskForPriceFair(fit, ts, price)).toBeCloseTo(risk, 2);
    }

    const atSpot = riskForPriceFair(fit, ts, snapshot.price);
    expect(atSpot).toBeGreaterThan(0);
    expect(atSpot).toBeLessThanOrEqual(1);
  });
});
