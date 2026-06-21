import type { Handler } from '@netlify/functions';
import { gzipSync } from 'node:zlib';
import { projectChartRows } from './lib/chartDataFields';
import { signalsStore } from './lib/store';

/**
 * Netlify synchronous functions cap the response body the function returns at
 * 6 MB. Edge auto-compression does not help because that cap is measured on
 * the *uncompressed* body, so we gzip the JSON ourselves and return it as a
 * base64 payload with `Content-Encoding: gzip` (the browser transparently
 * decompresses it). We keep a guard on the compressed size as a backstop.
 */
const MAX_RESPONSE_BYTES = 5_800_000;

/**
 * Public chart payload: slim cached signal history for the web app
 * (dashboard, charts, backtest). Avoids 17 parallel browser-side FRED
 * fetches that routinely hit FRED rate limits (429).
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }), headers: corsHeaders() };
  }

  try {
    const store = signalsStore();
    const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;

    if (!cached?.data || !Array.isArray(cached.data) || cached.data.length === 0) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: 'Signal cache not yet populated. Trigger a refresh via the cron endpoint.',
        }),
      };
    }

    const cachedAtMs = typeof cached.timestamp === 'number' ? cached.timestamp : null;
    const data = projectChartRows(cached.data);
    const json = JSON.stringify({
      count: data.length,
      data,
      cached_at: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
    });

    const gzipped = gzipSync(json);
    const base64 = gzipped.toString('base64');

    // The base64 string is what Netlify counts against the 6 MB cap.
    if (Buffer.byteLength(base64, 'utf8') > MAX_RESPONSE_BYTES) {
      console.error(
        '[signal-chart-data] gzipped payload still too large:',
        Buffer.byteLength(base64, 'utf8'),
      );
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Chart payload too large. Contact support.' }),
      };
    }

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
    console.error('[signal-chart-data]', err);
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
