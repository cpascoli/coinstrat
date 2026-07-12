/**
 * Dedicated BTC daily price-series cache.
 *
 * The full chart payload (`signals_latest`) carries ~50 macro/on-chain fields
 * and brushes against Netlify's 6 MB function-body cap. The BTC price series,
 * by contrast, is the single most widely consumed series (price charts + the
 * CQM fit on every model page) and is tiny on its own. Materializing it into
 * its own blob lets the CQM pages source an authoritative price independent of
 * the heavier payload, so the CQM risk line can never silently diverge from the
 * bot just because the big payload failed to load.
 */

import { signalsStore } from './store';

export const BTC_SERIES_BLOB_KEY = 'btc_series';

export interface BtcSeriesPoint {
  Date: string;
  BTCUSD: number;
}

export interface BtcSeriesPayload {
  timestamp: number;
  count: number;
  data: BtcSeriesPoint[];
}

/** Extract a clean, ascending {Date, BTCUSD} series from full cache rows. */
export function projectBtcSeries(rows: Array<Record<string, unknown>>): BtcSeriesPoint[] {
  const out: BtcSeriesPoint[] = [];
  for (const row of rows) {
    const date = typeof row.Date === 'string' ? row.Date : null;
    const price = Number(row.BTCUSD);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    out.push({ Date: date, BTCUSD: price });
  }
  return out;
}

/** Materialize the BTC price series into its own blob. */
export async function writeBtcSeriesBlob(
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  const data = projectBtcSeries(rows);
  const store = signalsStore();
  await store.setJSON(BTC_SERIES_BLOB_KEY, {
    timestamp: Date.now(),
    count: data.length,
    data,
  } satisfies BtcSeriesPayload);
  return data.length;
}

/** Read the dedicated BTC series blob (null when it has not been written yet). */
export async function readBtcSeriesBlob(): Promise<BtcSeriesPayload | null> {
  const store = signalsStore();
  return store
    .get(BTC_SERIES_BLOB_KEY, { type: 'json' })
    .catch(() => null) as Promise<BtcSeriesPayload | null>;
}
