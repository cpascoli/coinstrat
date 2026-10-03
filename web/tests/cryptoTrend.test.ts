import { describe, expect, it } from 'vitest';
import { computeCryptoTrendSeries, type CryptoTrendParams } from '../src/utils/cryptoTrend';

const base: CryptoTrendParams = {
  jawLength: 4,
  lipsLength: 2,
  bandMode: 'pct',
  pct: 0.015,
  atrPeriod: 3,
  atrMult: 1,
};

const series = (prices: number[]) =>
  prices.map((price, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, price }));

describe('computeCryptoTrendSeries', () => {
  it('seeds SMMA with the SMA, then applies Wilder smoothing (Pine semantics)', () => {
    const rows = computeCryptoTrendSeries(series([10, 20, 30, 40, 50]), base);
    expect(rows[2].jaw).toBeNull();
    expect(rows[3].jaw).toBe(25); // SMA(10,20,30,40)
    expect(rows[4].jaw).toBe((25 * 3 + 50) / 4);
    expect(rows[1].lips).toBe(15);
    expect(rows[2].lips).toBe((15 + 30) / 2);
  });

  it('is neutral during warm-up and classifies direction like the Pine colours', () => {
    const up = computeCryptoTrendSeries(series([100, 110, 120, 130, 140, 150]), base);
    expect(up[0].state).toBe('neutral');
    expect(up[5].state).toBe('up'); // lips above jaw → yellow
    const down = computeCryptoTrendSeries(series([150, 140, 130, 120, 110, 100]), base);
    expect(down[5].state).toBe('down'); // jaw above lips → purple
  });

  it('pct mode goes neutral when jaw/lips is within the band', () => {
    const flat = computeCryptoTrendSeries(series([100, 100, 100, 100, 100.5, 100.5]), base);
    expect(flat[5].state).toBe('neutral');
  });

  it('atr mode widens the band with volatility', () => {
    // Same net drift; the choppy path has a much larger ATR, so it stays neutral.
    const smooth = series([100, 101, 102, 103, 104, 105, 106]);
    const choppy = series([100, 110, 92, 112, 94, 115, 106]);
    const atr: CryptoTrendParams = { ...base, bandMode: 'atr', atrMult: 0.5 };
    expect(computeCryptoTrendSeries(smooth, atr).at(-1)!.state).toBe('up');
    expect(computeCryptoTrendSeries(choppy, atr).at(-1)!.state).toBe('neutral');
  });
});
