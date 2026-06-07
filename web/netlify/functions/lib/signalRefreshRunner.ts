import {
  refreshSignals,
  loadMergedBtcSeries,
  fetchMVRVFullHistory,
  fetchBGeometrics,
  type SignalRow,
} from './compute';
import { patchCqmFieldsInCache } from './cqmCache';
import { persistSignalAlertChanges, detectAlertChanges } from './signalAlerts';
import { signalsStore } from './store';
import { evaluateActiveStrategies } from './strategyAlerts';
import { refreshDerivativesCache } from './derivativesCache';

interface CachedSignalsPayload {
  timestamp: number;
  count: number;
  data: SignalRow[];
}

const INCREMENTAL_REPLACE_TAIL_DAYS = 14;
/** Must cover 365-day YoY liquidity scores plus replace tail. */
const SCORE_LOOKBACK_BUFFER_DAYS = 400;

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
    mode: 'patch_mvrv';
    patched: number;
    total: number;
    cached_at: string;
  }
  | {
    ok: true;
    mode: 'patch_sth_lth_rp';
    patched: number;
    total: number;
    cached_at: string;
  }
  | {
    ok: true;
    mode: 'patch_bottom_scores';
    patched: number;
    total: number;
    latest_date: string | null;
    cached_at: string;
  }
  | {
    ok: true;
    mode: 'patch_cqm';
    patched: number;
    total: number;
    latest_date: string | null;
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

/**
 * Fast targeted operation: fill null MVRV values in every existing cache row
 * using blockchain.info's full history (timespan=all, sparse ~1 point/3–4 days).
 *
 * The sparse points are forward-filled so every cached date gets a value based
 * on the most recent known reading.  Only rows where MVRV is currently null or
 * non-finite are updated.
 */
export async function patchMVRVInCache(): Promise<SignalRefreshResult> {
  const store = signalsStore();
  const cached = await loadCachedSignals();
  const cachedData = cached?.data ?? [];

  if (cachedData.length === 0) {
    throw new Error('Cache is empty — seed the cache first before patching MVRV.');
  }

  // Fetch sparse full-history MVRV points (already sorted by date).
  const mvrvSeries = await fetchMVRVFullHistory();
  const pointMap = new Map(mvrvSeries.map((p) => [p.date, p.value]));

  // Build a forward-filled map keyed by every cached date.
  let lastKnown = NaN;
  const filledByDate = new Map<string, number>();
  for (const row of cachedData) {
    const v = pointMap.get(row.Date);
    if (v !== undefined && Number.isFinite(v)) lastKnown = v;
    if (Number.isFinite(lastKnown)) filledByDate.set(row.Date, lastKnown);
  }

  let patched = 0;
  const rows = cachedData.map((row) => {
    if (typeof row.MVRV === 'number' && Number.isFinite(row.MVRV)) return row; // already valid
    const filled = filledByDate.get(row.Date);
    if (filled !== undefined) {
      patched += 1;
      return { ...row, MVRV: filled };
    }
    return row;
  });

  const cachedAt = new Date().toISOString();
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: rows.length,
    data: rows,
  });

  console.log(`[signal-refresh] MVRV patch complete — updated ${patched} of ${rows.length} rows.`);

  return {
    ok: true,
    mode: 'patch_mvrv',
    patched,
    total: rows.length,
    cached_at: cachedAt,
  };
}

/**
 * Back-fill STH / LTH / aggregate realized price for every cached row from
 * BGeometrics full JSON (same source as incremental refresh), forward-filled
 * along the cache timeline.
 *
 * Why this exists: incremental `refreshSignals` only *appends* new dates; it never
 * rewrites older rows. When realized-price fields were added after the cache was
 * seeded, historical dates stay null in the blob — Strategy Builder reads
 * `signals_latest` via series-detail and charts look truncated.
 * This patch is the fast fix (three HTTP fetches), analogous to `patchMVRVInCache`.
 */
export async function patchSthLthRealizedPriceInCache(): Promise<SignalRefreshResult> {
  const store = signalsStore();
  const cached = await loadCachedSignals();
  const cachedData = cached?.data ?? [];

  if (cachedData.length === 0) {
    throw new Error(
      'Cache is empty — seed the cache first before patching STH/LTH realized price.',
    );
  }

  const [sthSeries, lthSeries, allSeries] = await Promise.all([
    fetchBGeometrics('sth_realized_price'),
    fetchBGeometrics('lth_realized_price'),
    fetchBGeometrics('realized_price'),
  ]);

  const dates = cachedData.map((r) => r.Date);

  const forwardFill = (
    orderedDates: string[],
    series: { date: string; value: number }[],
  ): Map<string, number> => {
    const pointMap = new Map(series.map((p) => [p.date, p.value]));
    let last = NaN;
    const out = new Map<string, number>();
    for (const d of orderedDates) {
      const v = pointMap.get(d);
      if (v !== undefined && Number.isFinite(v)) last = v;
      if (Number.isFinite(last)) out.set(d, last);
    }
    return out;
  };

  const sthFilled = forwardFill(dates, sthSeries);
  const lthFilled = forwardFill(dates, lthSeries);
  const allFilled = forwardFill(dates, allSeries);

  let patched = 0;
  const rows = cachedData.map((row) => {
    const sth = sthFilled.get(row.Date);
    const lth = lthFilled.get(row.Date);
    const allRp = allFilled.get(row.Date);
    const sthOk =
      typeof row.STH_REALIZED_PRICE === 'number' && Number.isFinite(row.STH_REALIZED_PRICE);
    const lthOk =
      typeof row.LTH_REALIZED_PRICE === 'number' && Number.isFinite(row.LTH_REALIZED_PRICE);
    const allOk =
      typeof row.REALIZED_PRICE === 'number' && Number.isFinite(row.REALIZED_PRICE);

    let next = row;
    let changed = false;
    if (sth !== undefined && !sthOk) {
      next = { ...next, STH_REALIZED_PRICE: sth };
      changed = true;
    }
    if (lth !== undefined && !lthOk) {
      next = { ...next, LTH_REALIZED_PRICE: lth };
      changed = true;
    }
    if (allRp !== undefined && !allOk) {
      next = { ...next, REALIZED_PRICE: allRp };
      changed = true;
    }
    if (changed) patched += 1;
    return next;
  });

  const cachedAt = new Date().toISOString();
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: rows.length,
    data: rows,
  });

  console.log(
    `[signal-refresh] Holder realized price patch complete — updated ${patched} of ${rows.length} rows.`,
  );

  return {
    ok: true,
    mode: 'patch_sth_lth_rp',
    patched,
    total: rows.length,
    cached_at: cachedAt,
  };
}

/**
 * Back-fill Bottom Accumulation Score fields across the existing cache range.
 *
 * This intentionally avoids `fullHistory: true`: historical raw values already
 * live in the signal cache, and the refresh overlays recent API tails plus full
 * on-chain/ISM series before recomputing derived BTC structure fields.
 */
export async function patchBottomScoresInCache(): Promise<SignalRefreshResult> {
  const store = signalsStore();
  const cached = await loadCachedSignals();
  const cachedData = cached?.data ?? [];

  if (cachedData.length === 0) {
    throw new Error('Cache is empty — cannot patch Bottom Accumulation Score fields.');
  }

  const lastDate = cachedData[cachedData.length - 1]?.Date ?? null;
  const derivativesRefresh = await refreshDerivativesCache();
  if (!derivativesRefresh.ok) {
    console.warn('[signal-refresh] Bottom score patch continuing with partial derivatives refresh:', derivativesRefresh);
  }

  const rebuilt = await refreshSignals(cachedData, {
    returnFullDataset: true,
    fullHistory: false,
  });
  const rows = lastDate
    ? rebuilt.filter((row) => row.Date <= lastDate)
    : rebuilt;

  let patched = 0;
  for (const row of rows) {
    if (Number.isFinite(Number(row.BOTTOM_ACCUM_SCORE))) patched += 1;
  }

  const cachedAt = new Date().toISOString();
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: rows.length,
    data: rows,
  });

  console.log(
    `[signal-refresh] Bottom score patch complete — populated ${patched} of ${rows.length} rows through ${lastDate}.`,
  );

  return {
    ok: true,
    mode: 'patch_bottom_scores',
    patched,
    total: rows.length,
    latest_date: rows[rows.length - 1]?.Date ?? null,
    cached_at: cachedAt,
  };
}

/**
 * Back-fill CQM Risk / Score / QR band fields across the signal cache.
 *
 * Runs one `fitCQM()` pass and writes values onto each row. On incremental
 * refreshes we only rewrite the recent tail; use `fromDate: null` for a full
 * back-fill (manual `patch_cqm` mode).
 */
export async function patchCqmInCache(fromDate: string | null = null): Promise<SignalRefreshResult> {
  const cached = await loadCachedSignals();
  const cachedData = cached?.data ?? [];

  if (cachedData.length === 0) {
    throw new Error('Cache is empty — cannot patch CQM fields.');
  }

  const result = await patchCqmFieldsInCache(cachedData, {
    fromDate,
    onlyMissing: fromDate == null,
  });

  const cachedAt = new Date().toISOString();
  const store = signalsStore();
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: result.rows.length,
    data: result.rows,
  });

  console.log(
    `[signal-refresh] CQM patch complete — updated ${result.patched} of ${result.rows.length} rows through ${result.latest_date}.`,
  );

  return {
    ok: true,
    mode: 'patch_cqm',
    patched: result.patched,
    total: result.rows.length,
    latest_date: result.latest_date,
    cached_at: cachedAt,
  };
}

async function persistCacheWithCqmPatch(
  rows: SignalRow[],
  fromDate: string | null,
): Promise<{ rows: SignalRow[]; cqm_patched: number }> {
  const store = signalsStore();
  const cqmPatch = await patchCqmFieldsInCache(rows, { fromDate });
  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: cqmPatch.rows.length,
    data: cqmPatch.rows,
  });
  console.log(
    `[signal-refresh] CQM patch complete — updated ${cqmPatch.patched} of ${cqmPatch.rows.length} rows.`,
  );
  return { rows: cqmPatch.rows, cqm_patched: cqmPatch.patched };
}

export async function runSignalRefresh(mode: 'incremental' | 'rebuild'): Promise<SignalRefreshResult> {
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

    const { rows: patchedRows } = await persistCacheWithCqmPatch(rebuilt, null);

    const strategySummary = await evaluateActiveStrategies(patchedRows, []);

    console.log(`[signal-refresh] Rebuilt full cache with ${patchedRows.length} rows.`);

    return {
      ok: true,
      mode: 'rebuild',
      count: patchedRows.length,
      latest_date: patchedRows[patchedRows.length - 1]?.Date ?? null,
      cached_at: new Date().toISOString(),
      alerts: { events: 0, deliveries: 0 },
      strategies: strategySummary,
    };
  }

  const lastDate = cachedData[cachedData.length - 1]?.Date;
  const replaceFromDate = dateDaysBefore(lastDate, INCREMENTAL_REPLACE_TAIL_DAYS);
  const windowStartDate = dateDaysBefore(replaceFromDate, SCORE_LOOKBACK_BUFFER_DAYS);
  console.log(
    `[signal-refresh] Incremental refresh from ${lastDate} (${cachedData.length} cached rows)…`,
  );

  const refreshedRows = await refreshSignals(cachedData, {
    returnFullDataset: true,
    fullHistory: false,
    windowStartDate,
  });
  const newRows = refreshedRows.filter((row) => row.Date > lastDate);

  const combined = [
    ...cachedData.filter((row) => row.Date < replaceFromDate),
    ...refreshedRows.filter((row) => row.Date >= replaceFromDate),
  ];
  const { rows: patchedRows } = await persistCacheWithCqmPatch(combined, replaceFromDate);
  const cachedAt = new Date().toISOString();

  if (newRows.length === 0) {
    console.log(
      `[signal-refresh] Cache up-to-date on calendar days; refreshed macro tail from ${replaceFromDate} (${patchedRows.length} total).`,
    );
    return {
      ok: true,
      mode: 'incremental',
      new_rows: 0,
      total: patchedRows.length,
      latest_date: lastDate,
      message: 'Cache is already up-to-date; macro tail and CQM refreshed.',
      cached_at: cachedAt,
      alerts: { events: 0, deliveries: 0 },
      strategies: { strategies: 0, events: 0, deliveries: 0 },
    };
  }

  const alertWindow = [cachedData[cachedData.length - 1], ...newRows];
  const alertChanges = detectAlertChanges(alertWindow);
  const alertSummary = alertChanges.length > 0
    ? await persistSignalAlertChanges(alertChanges)
    : { events: 0, deliveries: 0 };
  const changedDates = patchedRows
    .filter((row) => row.Date >= replaceFromDate)
    .map((row) => row.Date);
  const strategySummary = await evaluateActiveStrategies(patchedRows, changedDates);

  console.log(
    `[signal-refresh] Replaced tail from ${replaceFromDate}, appended ${newRows.length} new rows (${patchedRows.length} total).`,
  );

  return {
    ok: true,
    mode: 'incremental',
    new_rows: newRows.length,
    total: patchedRows.length,
    latest_date: newRows[newRows.length - 1]?.Date ?? patchedRows[patchedRows.length - 1]?.Date ?? lastDate,
    cached_at: cachedAt,
    alerts: alertSummary,
    strategies: strategySummary,
  };
}

function dateDaysBefore(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().split('T')[0];
}
