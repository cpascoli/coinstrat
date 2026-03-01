import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

/**
 * Triggered by the OpenClaw cron to recompute signals and refresh the cache.
 * Expects a shared secret in the Authorization header for protection.
 *
 * The actual signal computation runs client-side (engine.ts). This endpoint
 * accepts precomputed signal data as a POST body and stores it in Netlify Blobs.
 * This avoids duplicating the heavy data-fetching logic server-side.
 *
 * Flow:
 *   1. OpenClaw agent fetches raw data + runs engine (or calls the site and extracts data)
 *   2. Agent POSTs the computed signal array here
 *   3. This function stores it in Netlify Blobs with a timestamp
 */
const CRON_SECRET = process.env.CRON_SECRET;

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify shared secret
  const auth = event.headers['authorization'];
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const signals = JSON.parse(event.body || '[]');
    if (!Array.isArray(signals) || signals.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Expected non-empty signal array.' }) };
    }

    const store = getStore('signals');
    await store.setJSON('signals_latest', {
      timestamp: Date.now(),
      count: signals.length,
      data: signals,
    });

    console.log(`[signal-refresh] Cached ${signals.length} signal records.`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        count: signals.length,
        cached_at: new Date().toISOString(),
      }),
    };
  } catch (err: any) {
    console.error('[signal-refresh]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
