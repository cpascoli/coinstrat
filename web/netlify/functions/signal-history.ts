import type { Handler } from '@netlify/functions';
import { signalsStore } from './lib/store';
import { buildApiRateLimitHeaders, requirePaidApiKey } from './lib/apiAccess';

const DEFAULT_HISTORY_FIELDS = [
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
  'SAHM',
  'YC_M',
  'NO_YOY',
  'MVRV',
  'SIP',
  'SIP_EUPHORIA_FLAG',
  'SIP_EXHAUSTED',
  'SIP_OBS_DAYS',
  'STH_REALIZED_PRICE',
  'LTH_REALIZED_PRICE',
  'BOTTOM_ACCUM_SCORE',
  'BOTTOM_ONCHAIN_SCORE',
  'BOTTOM_CAPITULATION_SCORE',
  'BOTTOM_LIQUIDITY_SCORE',
  'BOTTOM_MACRO_SCORE',
  'BOTTOM_PRICE_SETUP_SCORE',
  'BOTTOM_PRICE_REPAIR_SCORE',
  'BOTTOM_STRUCTURE_SCORE',
  'BOTTOM_ACCUM_BAND',
  'BOTTOM_DEPLOYMENT_RANGE',
  'BTC_FUNDING_RATE',
  'BTC_FUNDING_7D_AVG',
  'BTC_OPEN_INTEREST_USD',
  'BTC_OI_DRAWDOWN_90D',
];

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }), headers: corsHeaders() };
  }

  const apiKey = event.headers['x-api-key'] ?? event.headers['X-API-Key'];
  const access = await requirePaidApiKey(apiKey);

  if ('statusCode' in access) {
    return {
      statusCode: access.statusCode,
      headers: {
        ...corsHeaders(),
        ...(access.rateLimit ? buildApiRateLimitHeaders(access.rateLimit) : {}),
      },
      body: JSON.stringify({ error: access.error }),
    };
  }

  try {
    const store = signalsStore();
    const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;

    if (!cached?.data) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Signal cache not populated.' }),
      };
    }

    // Optional date range filtering
    const params = event.queryStringParameters || {};
    let results = cached.data as any[];

    if (params.from) {
      results = results.filter((d: any) => d.Date >= params.from!);
    }
    if (params.to) {
      results = results.filter((d: any) => d.Date <= params.to!);
    }

    const fields = parseFields(params.fields);
    results = results.map((row: any) => projectRow(row, fields));

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        ...buildApiRateLimitHeaders(access.rateLimit),
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({
        count: results.length,
        data: results,
        cached_at: new Date(cached.timestamp).toISOString(),
        rate_limit: access.rateLimit,
      }),
    };
  } catch (err: any) {
    console.error('[signal-history]', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function parseFields(fieldsParam?: string): string[] {
  if (!fieldsParam) return DEFAULT_HISTORY_FIELDS;
  if (fieldsParam === 'all') return [];

  const requested = fieldsParam
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  return Array.from(new Set(['Date', ...requested]));
}

function projectRow(row: any, fields: string[]) {
  if (fields.length === 0) return row;

  const projected: Record<string, any> = {};
  for (const field of fields) {
    if (row[field] !== undefined) projected[field] = row[field];
  }
  return projected;
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  };
}
