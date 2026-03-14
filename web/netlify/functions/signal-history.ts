import type { Handler } from '@netlify/functions';
import { signalsStore } from './lib/store';
import { buildApiRateLimitHeaders, requirePaidApiKey } from './lib/apiAccess';

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

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  };
}
