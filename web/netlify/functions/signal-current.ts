import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const CACHE_KEY = 'signals_latest';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }), headers: corsHeaders() };
  }

  try {
    const store = getStore('signals');
    const cached = await store.get(CACHE_KEY, { type: 'json' }).catch(() => null) as any;

    if (cached && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      const latest = cached.data[cached.data.length - 1];
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=300' },
        body: JSON.stringify({
          signal: latest,
          cached_at: new Date(cached.timestamp).toISOString(),
          next_refresh: new Date(cached.timestamp + CACHE_TTL_MS).toISOString(),
        }),
      };
    }

    return {
      statusCode: 503,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: 'Signal cache not yet populated. Trigger a refresh via the cron endpoint.',
      }),
    };
  } catch (err: any) {
    console.error('[signal-current]', err);
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
  };
}
