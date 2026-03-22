import { refreshSignals, loadMergedBtcSeries, type SignalRow } from './compute';
import { persistSignalAlertChanges, detectAlertChanges } from './signalAlerts';
import { signalsStore } from './store';
import { evaluateActiveStrategies } from './strategyAlerts';

interface CachedSignalsPayload {
  timestamp: number;
  count: number;
  data: SignalRow[];
}

export type SignalRefreshResult =
  | {
    ok: true;
    mode: 'seed';
    count: number;
    cached_at: string;
  }
  | {
    ok: true;
    mode: 'patch_btcusd';
    patched: number;
    total: number;
    cached_at: string;
  }
  | {
    ok: true;
    mode: 'rebuild';
    count: number;
    latest_date: string | null;
    cached_at: string;
    alerts: { events: number; deliveries: number };
    strategies: { strategies: number; events: number; deliveries: number };
  }
  | {
    ok: true;
    mode: 'incremental';
    new_rows: 0;
    message: string;
    cached_at: string | null;
    alerts: { events: number; deliveries: number };
    strategies: { strategies: number; events: number; deliveries: number };
  }
  | {
    ok: true;
    mode: 'incremental';
    new_rows: number;
    total: number;
    latest_date: string;
    cached_at: string;
    alerts: { events: number; deliveries: number };
    strategies: { strategies: number; events: number; deliveries: number };
  };

async function loadCachedSignals(): Promise<CachedSignalsPayload | null> {
  const store = signalsStore();
  return store.get('signals_latest', { type: 'json' }).catch(() => null) as Promise<CachedSignalsPayload | null>;
}

export async function seedSignalCache(signals: SignalRow[]): Promise<SignalRefreshResult> {
  const store = signalsStore();
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: signals.length,
    data: signals,
  });

  console.log(`[signal-refresh] Bulk-seeded ${signals.length} rows.`);

  return {
    ok: true,
    mode: 'seed',
    count: signals.length,
    cached_at: new Date().toISOString(),
  };
}

/**
 * Fast targeted operation: patch BTCUSD in every existing cache row using
 * the authoritative local JSON history + a CryptoCompare tail for newer dates.
 *
 * Why this exists: a full `rebuild` re-fetches 13 FRED series with no date
 * filter, which takes 20–30 seconds and hits Netlify's function timeout (502).
 * This patch only makes two fast calls (local file read + one CryptoCompare
 * request) and completes in ~2 seconds.
 */
export async function patchBtcusdInCache(): Promise<SignalRefreshResult> {
  const store = signalsStore();
  const cached = await loadCachedSignals();
  const cachedData = cached?.data ?? [];

  if (cachedData.length === 0) {
    throw new Error('Cache is empty — seed the cache first before patching BTCUSD.');
  }

  const btcSeries = await loadMergedBtcSeries();
  const btcByDate = new Map(btcSeries.map((p) => [p.date, p.value]));

  let patched = 0;
  const rows = cachedData.map((row) => {
    const btcVal = btcByDate.get(row.Date);
    if (btcVal !== undefined && Number.isFinite(btcVal) && btcVal > 0) {
      if (row.BTCUSD !== btcVal) {
        patched += 1;
        return { ...row, BTCUSD: btcVal };
      }
    }
    return row;
  });

  const cachedAt = new Date().toISOString();
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: rows.length,
    data: rows,
  });

  console.log(`[signal-refresh] BTCUSD patch complete — updated ${patched} of ${rows.length} rows.`);

  return {
    ok: true,
    mode: 'patch_btcusd',
    patched,
    total: rows.length,
    cached_at: cachedAt,
  };
}

export async function runSignalRefresh(mode: 'incremental' | 'rebuild'): Promise<SignalRefreshResult> {
  const store = signalsStore();
  const cached = await loadCachedSignals();
  const cachedData = cached?.data ?? [];

  if (cachedData.length === 0) {
    throw new Error(
      'Cache is empty — cannot run refresh from existing history. Seed the cache first via seed-cache.sh.',
    );
  }

  if (mode === 'rebuild') {
    console.log(
      `[signal-refresh] Full rebuild from ${cachedData[0]?.Date} (${cachedData.length} cached rows)…`,
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
      ok: true,
      mode: 'rebuild',
      count: rebuilt.length,
      latest_date: rebuilt[rebuilt.length - 1]?.Date ?? null,
      cached_at: new Date().toISOString(),
      alerts: { events: 0, deliveries: 0 },
      strategies: strategySummary,
    };
  }

  const lastDate = cachedData[cachedData.length - 1]?.Date;
  console.log(
    `[signal-refresh] Incremental refresh from ${lastDate} (${cachedData.length} cached rows)…`,
  );

  const newRows = await refreshSignals(cachedData);

  if (newRows.length === 0) {
    return {
      ok: true,
      mode: 'incremental',
      new_rows: 0,
      message: 'Cache is already up-to-date.',
      cached_at: cached?.timestamp
        ? new Date(cached.timestamp).toISOString()
        : null,
      alerts: { events: 0, deliveries: 0 },
      strategies: { strategies: 0, events: 0, deliveries: 0 },
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
    ? await persistSignalAlertChanges(alertChanges)
    : { events: 0, deliveries: 0 };
  const strategySummary = await evaluateActiveStrategies(combined, newRows.map((row) => row.Date));

  console.log(
    `[signal-refresh] Appended ${newRows.length} new rows (${combined.length} total).`,
  );

  return {
    ok: true,
    mode: 'incremental',
    new_rows: newRows.length,
    total: combined.length,
    latest_date: newRows[newRows.length - 1].Date,
    cached_at: cachedAt,
    alerts: alertSummary,
    strategies: strategySummary,
  };
}
