import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { signalsStore } from './lib/store';
import { refreshSignals } from './lib/compute';

/**
 * Refresh the signal cache.  Two modes:
 *
 *  1. Empty body  → incremental refresh.  Reads the existing cache for
 *     historical context, fetches only the recent tail from each API,
 *     computes new signal rows, and appends them to the cache.
 *     This is the mode a daily cron (e.g. OpenClaw) should use.
 *
 *  2. Body { "mode": "rebuild" } → one-time full rebuild.  Recomputes
 *     the whole cached dataset and overwrites the blob.
 *
 *  3. Non-empty JSON array body → bulk seed / replace.  Stores the
 *     provided pre-computed data directly (manual seed via seed-cache.sh).
 *
 * Auth: `Bearer <CRON_SECRET>` or a valid admin Supabase JWT.
 */
const CRON_SECRET = process.env.CRON_SECRET;

async function isAdminJwt(token: string): Promise<boolean> {
  try {
    const sb = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.VITE_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return false;

    const admin = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    return data?.is_admin === true;
  } catch { return false; }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = event.headers['authorization'];
  const token = (auth ?? '').replace('Bearer ', '');
  const isCron = CRON_SECRET && token === CRON_SECRET;
  const isAdmin = !isCron && token ? await isAdminJwt(token) : false;

  if (!isCron && !isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const store = signalsStore();
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

      await store.setJSON('signals_latest', {
        timestamp: Date.now(),
        count: signals.length,
        data: signals,
      });

      console.log(`[signal-refresh] Bulk-seeded ${signals.length} rows.`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          mode: 'seed',
          count: signals.length,
          cached_at: new Date().toISOString(),
        }),
      };
    }

    const cached = await store
      .get('signals_latest', { type: 'json' })
      .catch(() => null) as any;

    const cachedData: any[] = cached?.data ?? [];
    if (cachedData.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            'Cache is empty — cannot run refresh from existing history. ' +
            'Seed the cache first via seed-cache.sh.',
        }),
      };
    }

    if (isRebuildRequest) {
      // ── Mode 2: full rebuild / overwrite ───────────────────────────
      console.log(
        `[signal-refresh] Full rebuild from ${cachedData[0]?.Date} ` +
        `(${cachedData.length} cached rows)…`,
      );

      const rebuilt = await refreshSignals(cachedData, {
        returnFullDataset: true,
        fullHistory: true,
      });

      await store.setJSON('signals_latest', {
        timestamp: Date.now(),
        count: rebuilt.length,
        data: rebuilt,
      });

      console.log(`[signal-refresh] Rebuilt full cache with ${rebuilt.length} rows.`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          mode: 'rebuild',
          count: rebuilt.length,
          latest_date: rebuilt[rebuilt.length - 1]?.Date ?? null,
          cached_at: new Date().toISOString(),
        }),
      };
    }

    // ── Mode 1: incremental refresh ────────────────────────────────
    const lastDate = cachedData[cachedData.length - 1]?.Date;
    console.log(
      `[signal-refresh] Incremental refresh from ${lastDate} ` +
      `(${cachedData.length} cached rows)…`,
    );

    const newRows = await refreshSignals(cachedData);

    if (newRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          mode: 'incremental',
          new_rows: 0,
          message: 'Cache is already up-to-date.',
          cached_at: cached?.timestamp
            ? new Date(cached.timestamp).toISOString()
            : null,
        }),
      };
    }

    const combined = [...cachedData, ...newRows];

    await store.setJSON('signals_latest', {
      timestamp: Date.now(),
      count: combined.length,
      data: combined,
    });

    console.log(
      `[signal-refresh] Appended ${newRows.length} new rows ` +
      `(${combined.length} total).`,
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        mode: 'incremental',
        new_rows: newRows.length,
        total: combined.length,
        latest_date: newRows[newRows.length - 1].Date,
        cached_at: new Date().toISOString(),
      }),
    };
  } catch (err: any) {
    console.error('[signal-refresh]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
