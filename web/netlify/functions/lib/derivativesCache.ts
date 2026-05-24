import fetch from 'node-fetch';
import { derivativesStore } from './store';

export interface DerivativesPoint {
  date: string;
  value: number;
}

interface OpenInterestCachePayload {
  timestamp: number;
  count: number;
  source: 'binance-futures';
  data: DerivativesPoint[];
}

const OPEN_INTEREST_CACHE_KEY = 'btc_open_interest_usd';
const FUNDING_RATE_CACHE_KEY = 'btc_funding_rate';
const DAY_MS = 24 * 60 * 60 * 1000;
const BINANCE_FUTURES_HOSTS = [
  'https://fapi.binance.com',
  'https://www.binance.com',
];

function toDate(ms: number) {
  return new Date(ms).toISOString().split('T')[0];
}

export async function fetchBinanceOpenInterestHistory(): Promise<DerivativesPoint[]> {
  const params = new URLSearchParams({
    symbol: 'BTCUSDT',
    period: '1d',
    limit: '500',
  });

  const rows = await fetchBinanceJson(`/futures/data/openInterestHist?${params}`);
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const ts = Number(row.timestamp);
      const value = Number(row.sumOpenInterestValue ?? row.sumOpenInterest);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) return null;
      return { date: toDate(ts), value };
    })
    .filter((row): row is DerivativesPoint => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchBinanceFundingRateHistory(fullHistory = false): Promise<DerivativesPoint[]> {
  const limit = 1000;
  const endMs = Date.now();
  let currentStartMs = fullHistory ? Date.UTC(2019, 8, 1) : endMs - (500 * DAY_MS);
  const daily = new Map<string, { sum: number; count: number }>();

  try {
    while (currentStartMs < endMs) {
      const params = new URLSearchParams({
        symbol: 'BTCUSDT',
        startTime: currentStartMs.toString(),
        endTime: endMs.toString(),
        limit: limit.toString(),
      });

      const rows = await fetchBinanceJson(`/fapi/v1/fundingRate?${params}`);
      if (!Array.isArray(rows) || rows.length === 0) break;

      addFundingRowsToDailyMap(daily, rows, 'fundingTime', 'fundingRate');

      const lastTs = Number(rows[rows.length - 1]?.fundingTime);
      if (!Number.isFinite(lastTs) || lastTs <= currentStartMs) break;
      currentStartMs = lastTs + 1;
      if (rows.length < limit) break;
    }
  } catch (error) {
    console.warn('[derivatives-cache] Binance funding GET failed; falling back to web funding API.', error);
    try {
      return await fetchBinanceFundingRateHistoryFromWeb(fullHistory);
    } catch (webError) {
      console.warn('[derivatives-cache] Binance funding web API failed; falling back to OKX funding API.', webError);
      try {
        return await fetchOkxFundingRateHistory(fullHistory);
      } catch (okxError) {
        console.warn('[derivatives-cache] OKX funding API failed; falling back to Bybit funding API.', okxError);
        return fetchBybitFundingRateHistory(fullHistory);
      }
    }
  }

  return dailyMapToSeries(daily);
}

async function fetchBinanceFundingRateHistoryFromWeb(fullHistory = false): Promise<DerivativesPoint[]> {
  const startMs = fullHistory ? Date.UTC(2019, 8, 1) : Date.now() - (500 * DAY_MS);
  const daily = new Map<string, { sum: number; count: number }>();
  const rowsPerPage = 1000;
  let page = 1;

  while (true) {
    const res = await fetch('https://www.binance.com/bapi/futures/v1/public/future/common/get-funding-rate-history', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        page,
        rows: rowsPerPage,
      }),
    });

    if (!res.ok) throw new Error(`Binance funding web API: HTTP ${res.status}`);
    const json = (await res.json()) as any;
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) break;

    addFundingRowsToDailyMap(daily, rows, 'calcTime', 'lastFundingRate');

    const oldestTs = Math.min(
      ...rows.map((row: any) => Number(row.calcTime)).filter((ts: number) => Number.isFinite(ts)),
    );
    if (!Number.isFinite(oldestTs) || oldestTs < startMs || rows.length < rowsPerPage) break;
    page += 1;
  }

  return dailyMapToSeries(daily).filter((row) => new Date(`${row.date}T00:00:00Z`).getTime() >= startMs);
}

async function fetchOkxFundingRateHistory(fullHistory = false): Promise<DerivativesPoint[]> {
  const startMs = fullHistory ? Date.UTC(2019, 8, 1) : Date.now() - (500 * DAY_MS);
  const daily = new Map<string, { sum: number; count: number }>();
  const rowsPerPage = 100;
  let after: string | null = null;

  while (true) {
    const params = new URLSearchParams({
      instId: 'BTC-USDT-SWAP',
      limit: rowsPerPage.toString(),
    });
    if (after) params.set('after', after);

    const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate-history?${params}`, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (!res.ok) throw new Error(`OKX funding API: HTTP ${res.status}`);
    const json = (await res.json()) as any;
    if (json?.code !== '0') throw new Error(`OKX funding API: ${json?.msg ?? 'unknown error'}`);
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) break;

    addFundingRowsToDailyMap(daily, rows, 'fundingTime', 'fundingRate');

    const oldestTs = Math.min(
      ...rows
        .map((row: any) => Number(row.fundingTime))
        .filter((ts: number) => Number.isFinite(ts)),
    );
    if (!Number.isFinite(oldestTs) || oldestTs <= startMs || rows.length < rowsPerPage) break;
    after = String(oldestTs);
  }

  return dailyMapToSeries(daily).filter((row) => new Date(`${row.date}T00:00:00Z`).getTime() >= startMs);
}

async function fetchBybitFundingRateHistory(fullHistory = false): Promise<DerivativesPoint[]> {
  const startMs = fullHistory ? Date.UTC(2019, 8, 1) : Date.now() - (500 * DAY_MS);
  const daily = new Map<string, { sum: number; count: number }>();
  const rowsPerPage = 200;
  let endMs = Date.now();

  while (endMs > startMs) {
    const params = new URLSearchParams({
      category: 'linear',
      symbol: 'BTCUSDT',
      endTime: endMs.toString(),
      limit: rowsPerPage.toString(),
    });

    const res = await fetch(`https://api.bybit.com/v5/market/funding/history?${params}`, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (!res.ok) throw new Error(`Bybit funding API: HTTP ${res.status}`);
    const json = (await res.json()) as any;
    if (json?.retCode !== 0) throw new Error(`Bybit funding API: ${json?.retMsg ?? 'unknown error'}`);
    const rows = Array.isArray(json?.result?.list) ? json.result.list : [];
    if (rows.length === 0) break;

    addFundingRowsToDailyMap(daily, rows, 'fundingRateTimestamp', 'fundingRate');

    const oldestTs = Math.min(
      ...rows
        .map((row: any) => Number(row.fundingRateTimestamp))
        .filter((ts: number) => Number.isFinite(ts)),
    );
    if (!Number.isFinite(oldestTs) || oldestTs <= startMs || rows.length < rowsPerPage) break;
    endMs = oldestTs - 1;
  }

  return dailyMapToSeries(daily).filter((row) => new Date(`${row.date}T00:00:00Z`).getTime() >= startMs);
}

export async function loadOpenInterestCache(): Promise<OpenInterestCachePayload | null> {
  const store = derivativesStore();
  return store.get(OPEN_INTEREST_CACHE_KEY, { type: 'json' }).catch(() => null) as Promise<OpenInterestCachePayload | null>;
}

export async function loadFundingRateCache(): Promise<OpenInterestCachePayload | null> {
  const store = derivativesStore();
  return store.get(FUNDING_RATE_CACHE_KEY, { type: 'json' }).catch(() => null) as Promise<OpenInterestCachePayload | null>;
}

export async function getCachedOpenInterestSeries(): Promise<DerivativesPoint[]> {
  const cached = await loadOpenInterestCache();
  const cachedRows = Array.isArray(cached?.data) ? cached.data : [];
  const liveRows = await fetchBinanceOpenInterestHistory().catch((error) => {
    console.error('[derivatives-cache] Binance OI live fetch failed:', error);
    return [] as DerivativesPoint[];
  });

  const byDate = new Map<string, DerivativesPoint>();
  for (const row of cachedRows) {
    if (row?.date && Number.isFinite(row.value)) byDate.set(row.date, row);
  }
  for (const row of liveRows) {
    if (row?.date && Number.isFinite(row.value)) byDate.set(row.date, row);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getCachedFundingRateSeries(fullHistory = false): Promise<DerivativesPoint[]> {
  const cached = await loadFundingRateCache();
  const cachedRows = Array.isArray(cached?.data) ? cached.data : [];
  const liveRows = await fetchBinanceFundingRateHistory(fullHistory).catch((error) => {
    console.error('[derivatives-cache] Binance funding live fetch failed:', error);
    return [] as DerivativesPoint[];
  });

  return mergeByDate(cachedRows, liveRows);
}

export async function refreshOpenInterestCache() {
  const store = derivativesStore();
  const existing = await loadOpenInterestCache();
  const existingRows = Array.isArray(existing?.data) ? existing.data : [];
  const liveRows = await fetchBinanceOpenInterestHistory();

  const data = mergeByDate(existingRows, liveRows);
  const payload: OpenInterestCachePayload = {
    timestamp: Date.now(),
    count: data.length,
    source: 'binance-futures',
    data,
  };

  await store.setJSON(OPEN_INTEREST_CACHE_KEY, payload);

  return {
    ok: true,
    cached_at: new Date(payload.timestamp).toISOString(),
    count: payload.count,
    added_or_updated: liveRows.length,
    first_date: data[0]?.date ?? null,
    latest_date: data[data.length - 1]?.date ?? null,
  };
}

export async function refreshFundingRateCache() {
  const store = derivativesStore();
  const existing = await loadFundingRateCache();
  const existingRows = Array.isArray(existing?.data) ? existing.data : [];
  const liveRows = await fetchBinanceFundingRateHistory(false);

  const data = mergeByDate(existingRows, liveRows);
  const payload: OpenInterestCachePayload = {
    timestamp: Date.now(),
    count: data.length,
    source: 'binance-futures',
    data,
  };

  await store.setJSON(FUNDING_RATE_CACHE_KEY, payload);

  return {
    ok: true,
    cached_at: new Date(payload.timestamp).toISOString(),
    count: payload.count,
    added_or_updated: liveRows.length,
    first_date: data[0]?.date ?? null,
    latest_date: data[data.length - 1]?.date ?? null,
  };
}

export async function refreshDerivativesCache() {
  const [funding, openInterest] = await Promise.allSettled([
    refreshFundingRateCache(),
    refreshOpenInterestCache(),
  ]);

  return {
    ok: funding.status === 'fulfilled' && openInterest.status === 'fulfilled',
    funding: funding.status === 'fulfilled'
      ? funding.value
      : { ok: false, error: funding.reason instanceof Error ? funding.reason.message : String(funding.reason) },
    open_interest: openInterest.status === 'fulfilled'
      ? openInterest.value
      : { ok: false, error: openInterest.reason instanceof Error ? openInterest.reason.message : String(openInterest.reason) },
  };
}

async function fetchBinanceJson(path: string): Promise<any[]> {
  let lastError: Error | null = null;
  for (const host of BINANCE_FUTURES_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`);
      if (res.status === 200) {
        const text = await res.text();
        if (!text.trim()) {
          lastError = new Error(`Binance ${host}${path}: empty response`);
          continue;
        }
        const json = JSON.parse(text);
        if (Array.isArray(json)) return json;
        lastError = new Error(`Binance ${host}${path}: non-array response`);
        continue;
      }
      lastError = new Error(`Binance ${host}${path}: HTTP ${res.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`Binance request failed: ${path}`);
}

function mergeByDate(existingRows: DerivativesPoint[], liveRows: DerivativesPoint[]) {
  const byDate = new Map<string, DerivativesPoint>();
  for (const row of existingRows) {
    if (row?.date && Number.isFinite(row.value)) byDate.set(row.date, row);
  }
  for (const row of liveRows) {
    if (row?.date && Number.isFinite(row.value)) byDate.set(row.date, row);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function addFundingRowsToDailyMap(
  daily: Map<string, { sum: number; count: number }>,
  rows: any[],
  timestampKey: string,
  rateKey: string,
) {
  for (const row of rows) {
    const ts = Number(row[timestampKey]);
    const rate = Number(row[rateKey]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    const date = toDate(ts);
    const prev = daily.get(date) ?? { sum: 0, count: 0 };
    prev.sum += rate;
    prev.count += 1;
    daily.set(date, prev);
  }
}

function dailyMapToSeries(daily: Map<string, { sum: number; count: number }>) {
  return Array.from(daily.entries())
    .map(([date, v]) => ({ date, value: v.sum / v.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
