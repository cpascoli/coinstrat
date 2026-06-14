/** Fields required by dashboard, charts, and backtest (slim payload for /api/v1/signals/chart-data). */
export const CHART_DATA_FIELDS = [
  'Date',
  'BTCUSD',
  'ACCUM_ON',
  'CORE_ON',
  'MACRO_ON',
  'PRICE_REGIME_ON',
  'PRICE_REGIME',
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
  'ISM_PMI_ABOVE50_DAYS',
  'ISM_PMI_BELOW45_DAYS',
  'MVRV',
  'NUPL',
  'LTH_SOPR',
  'LTH_NUPL',
  'SIP',
  'SIP_EUPHORIA_FLAG',
  'SIP_EXHAUSTED',
  'SIP_OBS_DAYS',
  'STH_REALIZED_PRICE',
  'LTH_REALIZED_PRICE',
  'REALIZED_PRICE',
  'DXY',
  // USD regime inputs (used by the Scores USD card + the USD/DXY charts).
  'DXY_MA50',
  'DXY_MA200',
  'DXY_ROC20',
  'DXY_SCORE_RAW',
  'DXY_PERSIST',
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
  // Bottom Score price/structure inputs (used by the Factors breakdown).
  'BTC_DRAWDOWN_FROM_365D_HIGH',
  'BTC_ROC30',
  'BTC_ROC90',
  'BTC_60D_LOW',
  'BTC_30D_LOW',
  'BTC_PRIOR_30D_LOW',
  'BTC_DAYS_SINCE_60D_LOW',
] as const;

/**
 * Trim float precision to keep the payload under Netlify's 6 MB function-body
 * cap. Integers are preserved exactly; non-integers are rounded to 6
 * significant figures (well beyond chart pixel resolution) which strips the
 * long IEEE-754 tails (e.g. 1.1847836824005726 → 1.18478).
 */
function compactNumber(value: number): number {
  if (Number.isInteger(value)) return value;
  return Number(value.toPrecision(6));
}

export function projectChartRow(row: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of CHART_DATA_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) continue;
      projected[field] = compactNumber(value);
      continue;
    }
    projected[field] = value;
  }
  return projected;
}

export function projectChartRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(projectChartRow);
}
