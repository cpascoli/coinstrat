/** Fields required by dashboard, charts, and backtest (slim payload for /api/v1/signals/chart-data). */
export const CHART_DATA_FIELDS = [
  'Date',
  'BTCUSD',
  'ACCUM_ON',
  'CORE_ON',
  'MACRO_ON',
  'PRICE_REGIME_ON',
  'VAL_SCORE',
  'DXY_SCORE',
  'LIQ_SCORE',
  'BIZ_CYCLE_SCORE',
  'US_LIQ',
  'US_LIQ_YOY',
  'US_LIQ_13W_DELTA',
  'WALCL',
  'WTREGEN',
  'RRPONTSYD',
  'SAHM',
  'YC_M',
  'NO',
  'NO_YOY',
  'ISM_PMI',
  'MVRV',
  'NUPL',
  'LTH_SOPR',
  'LTH_NUPL',
  'SIP',
  'SIP_EUPHORIA_FLAG',
  'SIP_EXHAUSTED',
  'STH_REALIZED_PRICE',
  'LTH_REALIZED_PRICE',
  'DXY',
  'G3_ASSETS',
  'G3_YOY',
  'ECB_RAW',
  'BOJ_RAW',
  'EURUSD',
  'JPYUSD',
  'BOTTOM_ACCUM_SCORE',
  'BOTTOM_ONCHAIN_SCORE',
  'BOTTOM_CAPITULATION_SCORE',
  'BOTTOM_LIQUIDITY_SCORE',
  'BOTTOM_MACRO_SCORE',
  'BOTTOM_PRICE_SETUP_SCORE',
  'BOTTOM_PRICE_REPAIR_SCORE',
  'BOTTOM_ACCUM_BAND',
  'BOTTOM_DEPLOYMENT_RANGE',
  'BTC_FUNDING_RATE',
  'BTC_FUNDING_7D_AVG',
  'BTC_OPEN_INTEREST_USD',
  'BTC_OI_DRAWDOWN_90D',
  'BTC_MA40W',
] as const;

export function projectChartRow(row: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of CHART_DATA_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && Number.isNaN(value)) continue;
    projected[field] = value;
  }
  return projected;
}

export function projectChartRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(projectChartRow);
}
