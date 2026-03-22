import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import { runSignalRefresh, seedSignalCache, patchBtcusdInCache } from './lib/signalRefreshRunner';

/**
 * Refresh the signal cache.  Modes (determined by POST body):
 *
 *  1. Empty body  → incremental refresh.  Reads the existing cache for
 *     historical context, fetches only the recent tail from each API,
 *     computes new signal rows, and appends them to the cache.
 *     This is the mode the scheduled alert workflow uses.
 *
 *  2. Body { "mode": "patch_btcusd" } → fast BTCUSD back-fill.  Patches
 *     every cached row's BTCUSD value using btc_daily.json + CryptoCompare
 *     tail.  Completes in ~2 s (no FRED calls).  Use this from the Admin UI
 *     to fix historical null BTCUSD values.
 *
 *  3. Body { "mode": "rebuild" } → full recompute.  Re-fetches all APIs
 *     with no date filter and rewrites the entire cache.  WARNING: this
 *     hits Netlify's function timeout on most plans; prefer patch_btcusd
 *     for fixing BTCUSD, or run a manual seed via seed-cache.sh instead.
 *
 *  4. Non-empty JSON array body → bulk seed / replace.  Stores the
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
    const mode = (!Array.isArray(parsedBody) && parsedBody?.mode) || null;
    const isSeedPayload = Array.isArray(parsedBody);

    if (isSeedPayload) {
      // ── Mode 4: bulk seed / replace ────────────────────────────────
      const signals = parsedBody;
      if (!Array.isArray(signals) || signals.length === 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Expected non-empty signal array.' }),
        };
      }
      const result = await seedSignalCache(signals);
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    if (mode === 'patch_btcusd') {
      // ── Mode 2: fast BTCUSD back-fill (recommended from Admin UI) ──
      const result = await patchBtcusdInCache();
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    if (mode === 'rebuild') {
      // ── Mode 3: full recompute (slow — may timeout on Starter plan) ─
      const result = await runSignalRefresh('rebuild');
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    // ── Mode 1: incremental (default) ─────────────────────────────────
    const result = await runSignalRefresh('incremental');
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err: any) {
    console.error('[signal-refresh]', err);
    const statusCode = err.message?.includes('Cache is empty') ? 400 : 500;
    return { statusCode, body: JSON.stringify({ error: err.message }) };
  }
};
