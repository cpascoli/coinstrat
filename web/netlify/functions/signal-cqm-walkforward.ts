import type { Handler } from '@netlify/functions';
import { readWalkForwardCache } from './lib/cqmWalkForwardCache';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // recomputed daily after the refresh

/**
 * Serve the precomputed walk-forward CQM risk map (date → risk, 0..1).
 * Identical for every user, so it is cached aggressively at the edge.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const payload = await readWalkForwardCache();

    if (!payload?.data || !Array.isArray(payload.data) || payload.data.length === 0) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({
          error:
            'Walk-forward risk not yet computed. Trigger signal-cqm-walkforward-background to populate it.',
        }),
      };
    }

    const cachedAtMs = typeof payload.timestamp === 'number' ? payload.timestamp : null;
    const stale = cachedAtMs === null || Date.now() - cachedAtMs > CACHE_TTL_MS;

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        refit_every_days: payload.refit_every_days,
        from_date: payload.from_date,
        latest_date: payload.latest_date,
        count: payload.count,
        data: payload.data,
        cached_at: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
        stale,
      }),
    };
  } catch (err: any) {
    console.error('[signal-cqm-walkforward]', err);
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
