import type { Handler } from '@netlify/functions';
import { getBearerToken, getProfileFromToken, isPaidTier } from './lib/auth';
import { signalsStore } from './lib/store';
import { STRATEGY_SERIES_CATALOG } from '../../src/lib/strategyBuilder';

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

const validKeys = new Set(STRATEGY_SERIES_CATALOG.map((e) => e.key));

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const token = getBearerToken(event);
  const profile = await getProfileFromToken(token, 'id, email, tier');
  if (!profile) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Sign in required.' }),
    };
  }
  if (!isPaidTier(profile.tier)) {
    return {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Series detail is a Pro feature.' }),
    };
  }

  const key = event.queryStringParameters?.key;
  if (!key || !validKeys.has(key)) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: `Invalid series key. Valid keys: ${[...validKeys].join(', ')}` }),
    };
  }

  try {
    const store = signalsStore();
    const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;
    const rows = Array.isArray(cached?.data) ? cached.data : [];
    if (rows.length === 0) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Signal cache not populated.' }),
      };
    }

    const series: Array<{ d: string; v: number | null }> = [];
    for (const row of rows) {
      const val = row[key];
      series.push({ d: row.Date, v: typeof val === 'number' ? val : null });
    }

    const last = series[series.length - 1];

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        key,
        count: series.length,
        latest: last,
        data: series,
        cached_at: cached?.timestamp ? new Date(cached.timestamp).toISOString() : null,
      }),
    };
  } catch (err: any) {
    console.error('[series-detail]', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};
