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

/**
 * Prefer the server-maintained signal cache (single request). Fall back to
 * client-side recomputation when the cache is unavailable (local dev, cold start).
 */
export async function loadChartSignals(): Promise<SignalData[]> {
  try {
    return await loadCachedChartData();
  } catch (err) {
    console.warn('[chartData] Cache load failed, falling back to live compute:', err);
    return computeAllSignals();
  }
}
