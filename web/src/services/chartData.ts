import type { SignalData } from '../App';
import { computeAllSignals } from './engine';

const rollingMean = (arr: number[], window: number) => {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    const slice = arr.slice(i - window + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / window);
  }
  return result;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Derived display fields that may be absent from older cached rows. */
export function enrichChartRows(rows: SignalData[]): SignalData[] {
  if (!rows.length) return rows;

  const dxyVals = rows.map((d) => num(d.DXY));
  const dxyMA50 = rollingMean(dxyVals, 50);
  const dxyMA200 = rollingMean(dxyVals, 200);
  const dxyFavorableRaw = rows.map((d) => (num(d.DXY_SCORE) >= 1 ? 1 : 0));
  const dxyPersistence = rollingMean(dxyFavorableRaw, 30);

  return rows.map((row, i) => {
    const d: SignalData = { ...row };

    if (!Number.isFinite(num(d.DXY_MA50))) d.DXY_MA50 = dxyMA50[i];
    if (!Number.isFinite(num(d.DXY_MA200))) d.DXY_MA200 = dxyMA200[i];
    if (!Number.isFinite(num(d.DXY_PERSIST))) {
      d.DXY_PERSIST = dxyPersistence[i] >= 20 / 30 ? 1 : 0;
    }

    const fed = num(d.WALCL);
    if (!Number.isFinite(num(d.FED_USD)) && Number.isFinite(fed)) d.FED_USD = fed;

    const ecb = num(d.ECB_RAW);
    const eur = num(d.EURUSD);
    if (!Number.isFinite(num(d.ECB_USD)) && Number.isFinite(ecb) && Number.isFinite(eur) && eur > 0) {
      d.ECB_USD = ecb * eur;
    }

    const boj = num(d.BOJ_RAW);
    const jpy = num(d.JPYUSD);
    if (!Number.isFinite(num(d.BOJ_USD)) && Number.isFinite(boj) && Number.isFinite(jpy) && jpy > 0) {
      d.BOJ_USD = boj * 100 / jpy;
    }

    const mvrv = num(d.MVRV);
    if (!Number.isFinite(num(d.NUPL)) && Number.isFinite(mvrv) && mvrv !== 0) {
      d.NUPL = 1 - 1 / mvrv;
    }

    return d;
  });
}

async function loadCachedChartData(): Promise<SignalData[]> {
  const response = await fetch('/api/v1/signals/chart-data');
  if (!response.ok) {
    throw new Error(`Chart cache unavailable (${response.status})`);
  }

  const payload = await response.json() as { data?: SignalData[] };
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error('Chart cache returned no rows');
  }

  return enrichChartRows(payload.data);
}

interface BtcSeriesPoint {
  Date: string;
  BTCUSD: number;
}

/** Authoritative BTC daily price series (slim, dedicated blob — see signal-btc-series). */
async function loadBtcSeries(): Promise<BtcSeriesPoint[]> {
  const response = await fetch('/api/v1/signals/btc-series');
  if (!response.ok) {
    throw new Error(`BTC series unavailable (${response.status})`);
  }
  const payload = await response.json() as { data?: BtcSeriesPoint[] };
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error('BTC series returned no rows');
  }
  return payload.data;
}

/**
 * Overlay the authoritative BTC price onto the base rows by Date, appending any
 * dates the base payload is missing. This keeps the CQM fit (and price charts)
 * anchored to the same series the bot uses, even if the heavier chart-data
 * payload had to fall back to client-side recompute.
 */
function overlayBtcSeries(baseRows: SignalData[], btc: BtcSeriesPoint[]): SignalData[] {
  const byDate = new Map<string, SignalData>();
  for (const row of baseRows) byDate.set(row.Date, row);
  for (const point of btc) {
    const existing = byDate.get(point.Date);
    if (existing) {
      existing.BTCUSD = point.BTCUSD;
    } else {
      byDate.set(point.Date, { Date: point.Date, BTCUSD: point.BTCUSD } as SignalData);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
}

/**
 * Prefer the server-maintained signal cache (single request). Fall back to
 * client-side recomputation when the cache is unavailable (local dev, cold start).
 * Either way, overlay the dedicated authoritative BTC series so the price/CQM
 * line stays correct and in sync with the bot.
 */
export async function loadChartSignals(): Promise<SignalData[]> {
  const [baseRows, btc] = await Promise.all([
    loadCachedChartData().catch((err) => {
      console.warn('[chartData] Cache load failed, falling back to live compute:', err);
      return computeAllSignals();
    }),
    loadBtcSeries().catch((err) => {
      console.warn('[chartData] BTC series load failed; using base prices:', err);
      return null;
    }),
  ]);

  if (!btc) return baseRows;
  return overlayBtcSeries(baseRows, btc);
}
