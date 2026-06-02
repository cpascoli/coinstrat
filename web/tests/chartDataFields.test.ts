import { describe, expect, it } from 'vitest';
import { CHART_DATA_FIELDS, projectChartRow } from '../netlify/functions/lib/chartDataFields';

describe('chartDataFields', () => {
  it('includes liquidity inputs used by ChartsView', () => {
    expect(CHART_DATA_FIELDS).toEqual(expect.arrayContaining([
      'WALCL',
      'WTREGEN',
      'RRPONTSYD',
      'US_LIQ',
      'US_LIQ_YOY',
    ]));
  });

  it('drops undefined and NaN values to keep payloads small', () => {
    const projected = projectChartRow({
      Date: '2026-05-30',
      BTCUSD: 95000,
      US_LIQ: 5862410,
      WALCL: 6704383,
      WTREGEN: 830296,
      RRPONTSYD: 11677,
      NUPL: Number.NaN,
      BTC_MA40W: undefined,
      AB_SCORE: 99,
    });

    expect(projected).toEqual({
      Date: '2026-05-30',
      BTCUSD: 95000,
      US_LIQ: 5862410,
      WALCL: 6704383,
      WTREGEN: 830296,
      RRPONTSYD: 11677,
    });
  });
});
