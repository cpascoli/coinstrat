import type { Handler } from '@netlify/functions';
import { signalsStore } from './lib/store';
import { refreshSignals } from './lib/compute';
import { authorizeAdminOrCron } from './lib/auth';
import { deliverSignalAlertChanges, detectAlertChanges } from './lib/signalAlerts';
import { evaluateActiveStrategies } from './lib/strategyAlerts';

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

      const strategySummary = await evaluateActiveStrategies(rebuilt, []);

      console.log(`[signal-refresh] Rebuilt full cache with ${rebuilt.length} rows.`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          mode: 'rebuild',
          count: rebuilt.length,
          latest_date: rebuilt[rebuilt.length - 1]?.Date ?? null,
          cached_at: new Date().toISOString(),
          strategies: strategySummary,
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

    const cachedAt = new Date().toISOString();

    await store.setJSON('signals_latest', {
      timestamp: Date.now(),
      count: combined.length,
      data: combined,
    });

    const alertWindow = [cachedData[cachedData.length - 1], ...newRows];
    const alertChanges = detectAlertChanges(alertWindow);
    const alertSummary = alertChanges.length > 0
      ? await deliverSignalAlertChanges(alertChanges)
      : { events: 0, deliveries: 0 };
    const strategySummary = await evaluateActiveStrategies(combined, newRows.map((row) => row.Date));

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
        cached_at: cachedAt,
        alerts: alertSummary,
        strategies: strategySummary,
      }),
    };
  } catch (err: any) {
    console.error('[signal-refresh]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
