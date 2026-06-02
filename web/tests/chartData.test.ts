import { describe, expect, it } from 'vitest';
import { enrichChartRows } from '../src/services/chartData';
import type { SignalData } from '../src/App';

describe('enrichChartRows', () => {
  it('derives DXY moving averages and G3 USD components from raw cache fields', () => {
    const rows: SignalData[] = Array.from({ length: 60 }, (_, i) => ({
      Date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      BTCUSD: 90000,
      ACCUM_ON: 0,
      CORE_ON: 0,
      MACRO_ON: 0,
      PRICE_REGIME_ON: 0,
      VAL_SCORE: 1,
      DXY_SCORE: 1,
      LIQ_SCORE: 1,
      BIZ_CYCLE_SCORE: 1,
      US_LIQ: 5_000_000,
      US_LIQ_YOY: 1,
      US_LIQ_13W_DELTA: 1000,
      DXY: 100 + i * 0.1,
      WALCL: 6_700_000,
      ECB_RAW: 6_000_000,
      BOJ_RAW: 6_500_000,
      EURUSD: 1.1,
      JPYUSD: 150,
      MVRV: 2,
    }));

    const enriched = enrichChartRows(rows);
    const last = enriched[enriched.length - 1];

    expect(Number.isFinite(last.DXY_MA50)).toBe(true);
    expect(Number.isFinite(last.DXY_MA200)).toBe(false);
    expect(last.FED_USD).toBe(6_700_000);
    expect(last.ECB_USD).toBeCloseTo(6_600_000);
    expect(last.BOJ_USD).toBeCloseTo(6_500_000 * 100 / 150);
    expect(last.NUPL).toBeCloseTo(0.5);
  });
});
