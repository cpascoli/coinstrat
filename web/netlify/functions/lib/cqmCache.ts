/**
 * Persist CQM model outputs in the Netlify Blobs signal cache.
 *
 * Runs `fitCQM()` once per refresh and writes global fair-value risk + QR band levels
 * onto each signal row so newsletter compose and API consumers avoid an inline
 * refit (which exceeds Netlify's function timeout).
 */

import { fitCQM, type CQMFit } from '../../../src/utils/cqm';
import type { SignalRow } from './compute';
import { priceLadderFromFit, writeCqmPriceLadderBlob } from './cqmSnapshot';
import { signalsStore } from './store';

export const CQM_CACHE_FIELDS = [
  'CQM_RISK',
  'CQM_SCORE',
  'CQM_QR_MEDIAN',
  'CQM_SOLID_MEDIAN',
] as const;

export type CqmCacheField = (typeof CQM_CACHE_FIELDS)[number];

export interface CqmCachePatchResult {
  rows: SignalRow[];
  patched: number;
  latest_date: string | null;
}

function btcPointsFromRows(rows: SignalRow[]): { date: string; ts: number; price: number }[] {
  const points: { date: string; ts: number; price: number }[] = [];
  for (const row of rows) {
    const date = row.Date;
    const price = Number(row.BTCUSD);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const ts = new Date(`${date}T00:00:00Z`).getTime();
    if (!Number.isFinite(ts)) continue;
    points.push({ date, ts, price });
  }
  return points;
}

export function buildCqmFieldMap(fit: CQMFit): Map<string, Record<CqmCacheField, number>> {
  const byDate = new Map<string, Record<CqmCacheField, number>>();
  for (const signal of fit.signals) {
    byDate.set(signal.date, {
      CQM_RISK: Number(signal.risk),
      CQM_SCORE: Number(signal.score),
      CQM_QR_MEDIAN: Number(signal.qrDashedMedian),
      CQM_SOLID_MEDIAN: Number(signal.solidMedian),
    });
  }
  return byDate;
}

export function applyCqmFieldsToRows(
  rows: SignalRow[],
  fit: CQMFit,
  options: {
    fromDate?: string | null;
    onlyMissing?: boolean;
  } = {},
): CqmCachePatchResult {
  const byDate = buildCqmFieldMap(fit);
  let patched = 0;

  const nextRows = rows.map((row) => {
    if (options.fromDate && row.Date < options.fromDate) {
      return row;
    }
    if (options.onlyMissing && Number.isFinite(Number(row.CQM_RISK))) {
      return row;
    }

    const fields = byDate.get(row.Date);
    if (!fields) return row;

    const changed = CQM_CACHE_FIELDS.some((key) => row[key] !== fields[key]);
    if (changed) patched += 1;

    return {
      ...row,
      ...fields,
    };
  });

  return {
    rows: nextRows,
    patched,
    latest_date: nextRows.at(-1)?.Date ?? null,
  };
}

export async function patchCqmFieldsInCache(
  rows: SignalRow[],
  options: {
    fromDate?: string | null;
    onlyMissing?: boolean;
  } = {},
): Promise<CqmCachePatchResult> {
  if (rows.length === 0) {
    throw new Error('Cannot patch CQM fields on an empty signal cache.');
  }

  const points = btcPointsFromRows(rows);
  if (points.length < 365) {
    throw new Error(`CQM fit requires ≥365 days of BTC history; got ${points.length}.`);
  }

  const fit = fitCQM(points);

  // Persist the "price map" ladder from this same fit so newsletter compose can
  // read it without paying for an inline refit (which risks the function timeout).
  await writeCqmPriceLadderBlob(priceLadderFromFit(fit)).catch((err) => {
    console.error('[cqm-cache] Failed to write price-ladder blob:', err);
  });

  return applyCqmFieldsToRows(rows, fit, options);
}

export async function patchCqmFieldsInStoredCache(
  options: {
    fromDate?: string | null;
    onlyMissing?: boolean;
  } = {},
): Promise<CqmCachePatchResult & { total: number; cached_at: string }> {
  const store = signalsStore();
  const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as
    | { data?: SignalRow[] }
    | null;

  const rows = cached?.data ?? [];
  if (rows.length === 0) {
    throw new Error('Cache is empty — seed the cache first before patching CQM fields.');
  }

  const result = await patchCqmFieldsInCache(rows, options);
  const cachedAt = new Date().toISOString();

  await store.setJSON('signals_latest', {
    timestamp: Date.now(),
    count: result.rows.length,
    data: result.rows,
  });

  return {
    ...result,
    total: result.rows.length,
    cached_at: cachedAt,
  };
}
