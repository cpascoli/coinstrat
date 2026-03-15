import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import { runSignalRefresh, seedSignalCache } from './lib/signalRefreshRunner';

/**
 * Refresh the signal cache.  Two modes:
 *
 *  1. Empty body  → incremental refresh.  Reads the existing cache for
 *     historical context, fetches only the recent tail from each API,
 *     computes new signal rows, and appends them to the cache.
 *     This is the mode the scheduled alert workflow should use.
 *
 *  2. Body { "mode": "rebuild" } → one-time full rebuild.  Recomputes
 *     the whole cached dataset and overwrites the blob.
 *
 *  3. Non-empty JSON array body → bulk seed / replace.  Stores the
 *     provided pre-computed data directly (manual seed via seed-cache.sh).
 *
 * Auth: `Bearer <CRON_SECRET>` or a valid admin Supabase JWT.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const body = (event.body ?? '').trim();
    const parsedBody = body ? JSON.parse(body) : null;
    const isRebuildRequest =
      !!parsedBody &&
      !Array.isArray(parsedBody) &&
      parsedBody.mode === 'rebuild';
    const isSeedPayload = Array.isArray(parsedBody);

    if (isSeedPayload) {
      // ── Mode 3: bulk seed / replace ────────────────────────────────
      const signals = parsedBody;
      if (!Array.isArray(signals) || signals.length === 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Expected non-empty signal array.' }),
        };
      }
      const result = await seedSignalCache(signals);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    }

    if (isRebuildRequest) {
      const result = await runSignalRefresh('rebuild');

      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    }

    const result = await runSignalRefresh('incremental');

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err: any) {
    console.error('[signal-refresh]', err);
    const statusCode = err.message?.includes('Cache is empty') ? 400 : 500;
    return { statusCode, body: JSON.stringify({ error: err.message }) };
  }
};
