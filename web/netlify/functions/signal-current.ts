import type { Handler } from '@netlify/functions';
import { signalsStore } from './lib/store';

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
    const store = signalsStore();
    const cached = await store.get(CACHE_KEY, { type: 'json' }).catch(() => null) as any;

    if (!cached?.data || !Array.isArray(cached.data) || cached.data.length === 0) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: 'Signal cache not yet populated. Trigger a refresh via the cron endpoint.',
        }),
      };
    }

    const latest = cached.data[cached.data.length - 1];
    const cachedAtMs = typeof cached.timestamp === 'number' ? cached.timestamp : null;
    const isFresh = cachedAtMs !== null && (Date.now() - cachedAtMs) < CACHE_TTL_MS;

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        signal: latest,
        cached_at: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
        next_refresh: cachedAtMs ? new Date(cachedAtMs + CACHE_TTL_MS).toISOString() : null,
        stale: !isFresh,
      }),
    }
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
