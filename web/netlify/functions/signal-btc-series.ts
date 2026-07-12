import type { Handler } from '@netlify/functions';
import { gzipSync } from 'node:zlib';
import { projectBtcSeries, readBtcSeriesBlob } from './lib/btcSeriesCache';
import { signalsStore } from './lib/store';

/**
 * Slim, authoritative BTC daily price series ({ Date, BTCUSD }).
 *
 * Served from its own blob so the CQM fit / price charts have a tiny, reliable
 * source that is independent of the heavier `chart-data` payload. Falls back to
 * projecting the series out of `signals_latest` if the dedicated blob has not
 * been materialized yet (e.g. before the first refresh after deploy).
 *
 * The body is gzipped and base64-encoded with `Content-Encoding: gzip`; the
 * browser transparently decompresses it.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }), headers: corsHeaders() };
  }

  try {
    const blob = await readBtcSeriesBlob();
    let data = blob?.data;
    let cachedAtMs = blob?.timestamp ?? null;

    if (!data || !Array.isArray(data) || data.length === 0) {
      const store = signalsStore();
      const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as
        | { data?: Array<Record<string, unknown>>; timestamp?: number }
        | null;
      if (!cached?.data || !Array.isArray(cached.data) || cached.data.length === 0) {
        return {
          statusCode: 503,
          headers: corsHeaders(),
          body: JSON.stringify({
            error: 'BTC series not yet populated. Trigger a signal refresh.',
          }),
        };
      }
      data = projectBtcSeries(cached.data);
      cachedAtMs = typeof cached.timestamp === 'number' ? cached.timestamp : null;
    }

    const json = JSON.stringify({
      count: data.length,
      data,
      cached_at: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
    });
    const base64 = gzipSync(json).toString('base64');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...corsHeaders(),
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
      body: base64,
    };
  } catch (err: any) {
    console.error('[signal-btc-series]', err);
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
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
