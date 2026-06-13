/**
 * Precompute and persist the walk-forward CQM risk map in the Netlify Blobs
 * signal cache.
 *
 * The walk-forward map (causal expanding-window refits, no look-ahead) is
 * identical for every user and only extends by one point per day, so it is
 * wasteful to recompute it in each browser session. We compute it server-side
 * (in a background function, since the full pass takes ~1–2 min) and store it
 * under its own blob key. The `/api/v1/signals/cqm-walkforward` endpoint serves
 * it; the backtest Lab reads it and only falls back to the in-browser worker
 * when the cache is unavailable.
 *
 * Refit cadence is fixed at 90 days to match the Lab's local computation.
 */

import {
  buildWalkForwardRiskMap,
  WALK_FORWARD_DEFAULT_FROM_DATE,
  type CqmPricePoint,
} from '../../../src/utils/cqmWalkForward';
import type { SignalRow } from './compute';
import { signalsStore } from './store';

export const WALKFORWARD_CACHE_KEY = 'cqm_walkforward';
export const WALKFORWARD_REFIT_DAYS = 90;

export interface WalkForwardEntry {
  date: string;
  risk: number;
}

export interface WalkForwardPayload {
  timestamp: number;
  refit_every_days: number;
  from_date: string;
  latest_date: string | null;
  count: number;
  data: WalkForwardEntry[];
}

function pointsFromRows(rows: SignalRow[]): CqmPricePoint[] {
  const points: CqmPricePoint[] = [];
  for (const row of rows) {
    const date = row.Date;
    const price = Number(row.BTCUSD);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const ts = new Date(`${date}T00:00:00Z`).getTime();
    if (!Number.isFinite(ts)) continue;
    points.push({ date, ts, price });
  }
  // buildWalkForwardRiskMap assumes chronological order.
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadCachedRows(): Promise<SignalRow[]> {
  const store = signalsStore();
  const cached = (await store
    .get('signals_latest', { type: 'json' })
    .catch(() => null)) as { data?: SignalRow[] } | null;
  return cached?.data ?? [];
}

export interface WalkForwardResult {
  ok: true;
  mode: 'full' | 'incremental' | 'noop';
  count: number;
  added: number;
  from_date: string;
  latest_date: string | null;
  cached_at: string;
}

async function loadPoints(): Promise<CqmPricePoint[]> {
  const rows = await loadCachedRows();
  if (rows.length === 0) {
    throw new Error('Cache is empty — seed the signal cache before computing walk-forward risk.');
  }

  const points = pointsFromRows(rows);
  if (points.length < 365) {
    throw new Error(`Walk-forward risk requires ≥365 days of BTC history; got ${points.length}.`);
  }
  return points;
}

function persist(data: WalkForwardEntry[]): WalkForwardPayload {
  return {
    timestamp: Date.now(),
    refit_every_days: WALKFORWARD_REFIT_DAYS,
    from_date: WALK_FORWARD_DEFAULT_FROM_DATE,
    latest_date: data.at(-1)?.date ?? null,
    count: data.length,
    data,
  };
}

/**
 * Full walk-forward recompute over the entire cached signal history.
 *
 * This is the expensive seed pass (~3 min of single-threaded CPU over ~11
 * years). It can exceed the Lambda budget on slow runtimes, so prefer
 * {@link extendAndStoreWalkForward}; only use this to (re)seed from scratch.
 */
export async function computeAndStoreWalkForward(): Promise<WalkForwardResult> {
  const points = await loadPoints();

  const riskMap = buildWalkForwardRiskMap(points, {
    refitEveryDays: WALKFORWARD_REFIT_DAYS,
  });

  const data: WalkForwardEntry[] = Array.from(riskMap.entries())
    .map(([date, risk]) => ({ date, risk }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const payload = persist(data);
  await signalsStore().setJSON(WALKFORWARD_CACHE_KEY, payload);

  console.log(`[cqm-walkforward] full rebuild: stored ${data.length} points through ${payload.latest_date}.`);

  return {
    ok: true,
    mode: 'full',
    count: data.length,
    added: data.length,
    from_date: payload.from_date,
    latest_date: payload.latest_date,
    cached_at: new Date(payload.timestamp).toISOString(),
  };
}

/**
 * Extend the cached walk-forward map by only the days newer than the last
 * cached date, reusing the existing history. `buildWalkForwardRiskMap` always
 * fits on the full prior history regardless of `fromDate`, so a tail extension
 * costs one causal refit plus a handful of scorings — seconds, not minutes —
 * and stays within any function budget.
 *
 * Falls back to a full rebuild when no cache exists yet (the seed).
 */
export async function extendAndStoreWalkForward(): Promise<WalkForwardResult> {
  const existing = await readWalkForwardCache();
  if (!existing?.data?.length || !existing.latest_date) {
    return computeAndStoreWalkForward();
  }

  const points = await loadPoints();
  const lastCached = existing.latest_date;

  if (!points.some((p) => p.date > lastCached)) {
    // Nothing new — keep the existing map but refresh the timestamp so the
    // edge cache and `stale` flag stay accurate.
    const payload = persist(existing.data);
    await signalsStore().setJSON(WALKFORWARD_CACHE_KEY, payload);
    console.log(`[cqm-walkforward] up to date through ${lastCached}; refreshed timestamp.`);
    return {
      ok: true,
      mode: 'noop',
      count: payload.count,
      added: 0,
      from_date: payload.from_date,
      latest_date: payload.latest_date,
      cached_at: new Date(payload.timestamp).toISOString(),
    };
  }

  // Recompute only dates >= lastCached (the lastCached entry is recomputed
  // identically and overwritten — cheap and keeps the refit clock honest).
  const tailMap = buildWalkForwardRiskMap(points, {
    fromDate: lastCached,
    refitEveryDays: WALKFORWARD_REFIT_DAYS,
  });

  const merged = new Map<string, number>();
  for (const e of existing.data) {
    if (e.date < lastCached) merged.set(e.date, e.risk);
  }
  for (const [date, risk] of tailMap.entries()) merged.set(date, risk);

  const data: WalkForwardEntry[] = Array.from(merged.entries())
    .map(([date, risk]) => ({ date, risk }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const added = data.length - existing.data.length;
  const payload = persist(data);
  await signalsStore().setJSON(WALKFORWARD_CACHE_KEY, payload);

  console.log(
    `[cqm-walkforward] incremental: +${added} day(s), now ${data.length} points through ${payload.latest_date}.`,
  );

  return {
    ok: true,
    mode: 'incremental',
    count: data.length,
    added,
    from_date: payload.from_date,
    latest_date: payload.latest_date,
    cached_at: new Date(payload.timestamp).toISOString(),
  };
}

export async function readWalkForwardCache(): Promise<WalkForwardPayload | null> {
  const store = signalsStore();
  return (await store
    .get(WALKFORWARD_CACHE_KEY, { type: 'json' })
    .catch(() => null)) as WalkForwardPayload | null;
}

/**
 * Fire-and-forget invocation of the background recompute. Called after a signal
 * refresh appends new rows so the precomputed map stays current. Swallows all
 * errors — a failed trigger must never break the refresh itself.
 */
export async function triggerWalkForwardRecompute(): Promise<void> {
  const base =
    process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.VITE_APP_URL || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (!base || !cronSecret) {
    console.warn('[cqm-walkforward] missing site URL or CRON_SECRET; skipping recompute trigger.');
    return;
  }

  try {
    const res = await fetch(`${base}/.netlify/functions/signal-cqm-walkforward-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ trigger: 'signal-refresh' }),
    });
    console.log('[cqm-walkforward] recompute triggered', res.status);
  } catch (err) {
    console.warn('[cqm-walkforward] recompute trigger failed', err);
  }
}
