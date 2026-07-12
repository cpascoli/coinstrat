import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fitCQM } from '../src/utils/cqm';
import { generateForwardPrices, projectForwardBands } from '../src/utils/cqmForwardSim';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RawPoint { date: string; close: number; }

function loadBtcPoints(): { date: string; ts: number; price: number }[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  return raw
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .map((r) => ({ date: r.date, ts: new Date(r.date).getTime(), price: r.close }));
}

function logVol(arr: { price: number }[]): number {
  const r: number[] = [];
  for (let i = 1; i < arr.length; i++) r.push(Math.log(arr[i].price / arr[i - 1].price));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
}

function maxIn(path: { date: string; price: number }[], from: string, to: string): number {
  return Math.max(...path.filter((p) => p.date >= from && p.date <= to).map((p) => p.price));
}
function minIn(path: { date: string; price: number }[], from: string, to: string): number {
  return Math.min(...path.filter((p) => p.date >= from && p.date <= to).map((p) => p.price));
}

describe('CQM forward price simulation', () => {
  const points = loadBtcPoints();
  const fit = fitCQM(points);
  const last = fit.signals[fit.signals.length - 1];

  it('stays within a sane envelope around the projected median (no blow-ups)', () => {
    // Deep-bear troughs may dip below the over-narrow extrapolated 0.1% floor by
    // design, but the path must never blow up: bounded relative to the median.
    for (const seed of [0xc0ffee, 0xbada55, 0x1234, 0xfeed]) {
      const path = generateForwardPrices(fit, { endDate: '2034-12-31', seed });
      expect(path.length).toBeGreaterThan(2000);
      for (const p of path) {
        const b = projectForwardBands(fit, p.ts, last.ts)!;
        expect(p.price).toBeGreaterThan(b.q50 * 0.2);
        expect(p.price).toBeLessThan(b.q50 * 5);
      }
    }
  });

  it('draws peaks and correlated retracements within the requested ranges', () => {
    const seeds = [0xc0ffee, 0xbada55, 0x1234, 0xfeed, 0x9999, 0x5151, 0xabcd, 0x2468, 0x7777, 0x3030, 0xdead, 0x0f0f];
    const rows = seeds.map((seed) => {
      const path = generateForwardPrices(fit, { endDate: '2034-12-31', seed });
      const peak1 = maxIn(path, '2029-06-01', '2030-03-31');
      const trough1 = minIn(path, '2030-09-01', '2031-06-30');
      const peak2 = maxIn(path, '2033-08-01', '2034-03-31');
      const trough2 = minIn(path, '2034-08-01', '2034-12-31');
      return { seed, peak1, r1: 1 - trough1 / peak1, peak2, r2: 1 - trough2 / peak2 };
    });

    console.log('\nseed        2029 peak    retr1     2033 peak     retr2');
    for (const r of rows) {
      console.log(
        `${('0x' + r.seed.toString(16)).padEnd(10)} ${('$' + Math.round(r.peak1).toLocaleString()).padStart(10)}  ` +
        `${(r.r1 * 100).toFixed(1).padStart(5)}%  ${('$' + Math.round(r.peak2).toLocaleString()).padStart(11)}  ` +
        `${(r.r2 * 100).toFixed(1).padStart(5)}%`,
      );
    }

    // Visible peaks fall in the requested ranges.
    for (const r of rows) {
      expect(r.peak1).toBeGreaterThan(190_000);
      expect(r.peak1).toBeLessThan(470_000);
      expect(r.peak2).toBeGreaterThan(480_000);
      expect(r.peak2).toBeLessThan(1_050_000);
    }
    // Average retracements land in the requested bands.
    const avg = (f: (x: typeof rows[number]) => number) => rows.reduce((a, x) => a + f(x), 0) / rows.length;
    const ar1 = avg((x) => x.r1);
    const ar2 = avg((x) => x.r2);
    console.log(`\navg retr1 ${(ar1 * 100).toFixed(1)}%  ·  avg retr2 ${(ar2 * 100).toFixed(1)}%`);
    expect(ar1).toBeGreaterThan(0.40);
    expect(ar1).toBeLessThan(0.50);
    expect(ar2).toBeGreaterThan(0.35);
    expect(ar2).toBeLessThan(0.45);

    // Bullishness correlation: deeper peaks → deeper retracements (Pearson > 0).
    const corr = (xs: number[], ys: number[]) => {
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      return sxy / Math.sqrt(sxx * syy);
    };
    expect(corr(rows.map((r) => r.peak1), rows.map((r) => r.r1))).toBeGreaterThan(0.5);
    expect(corr(rows.map((r) => r.peak2), rows.map((r) => r.r2))).toBeGreaterThan(0.5);
  });

  it('is cyclical and re-rolls per seed', () => {
    const a = generateForwardPrices(fit, { endDate: '2034-12-31', seed: 0xc0ffee });
    const b = generateForwardPrices(fit, { endDate: '2034-12-31', seed: 0xbada55 });
    expect(maxIn(a, '2029-06-01', '2030-02-28')).toBeGreaterThan(minIn(a, '2026-06-13', '2026-12-31') * 2);
    const overlap = a.slice(100, 200).filter((p, i) => p.price === b[100 + i].price);
    expect(overlap.length).toBeLessThan(5);
  });

  it('diminishes volatility into the future', () => {
    const path = generateForwardPrices(fit, { endDate: '2034-12-31', seed: 0xc0ffee });
    const firstYear = path.filter((p) => p.date < '2027-06-15');
    const lastYear = path.filter((p) => p.date >= '2033-12-31');
    expect(logVol(lastYear)).toBeLessThan(logVol(firstYear));
    console.log(`Last real ${last.date} $${Math.round(last.price).toLocaleString()} · ` +
      `vol first yr ${(logVol(firstYear) * 100).toFixed(2)}% → last yr ${(logVol(lastYear) * 100).toFixed(2)}%`);
  });
});
