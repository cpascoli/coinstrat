/**
 * Shared FRED client for server-side signal refresh and the /api/fred proxy.
 *
 * FRED rate-limits aggressively when many series are fetched in parallel (as
 * refreshSignals used to do). This module adds:
 *   - in-memory caching (1 h TTL, shared within a warm Lambda instance)
 *   - retry with backoff on HTTP 429
 *   - stale-cache fallback when a live fetch fails
 */

import fetch from 'node-fetch';
import { signalsStore } from './store';

const FRED_CACHE_TTL_MS = 60 * 60 * 1000;
const FRED_RETRY_DELAYS_MS = [800];
const FRED_INTER_SERIES_DELAY_MS = 50;
const FRED_BLOB_KEY_PREFIX = 'fred_cache/';

interface CacheEntry {
  expiresAt: number;
  body: string;
}

const fredCache = new Map<string, CacheEntry>();

export interface FredObservation {
  date: string;
  value: number;
}

function cacheKey(seriesId: string, observationStart: string | null): string {
  return `${seriesId.toUpperCase()}|${observationStart ?? 'all'}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseObservations(json: { observations?: Array<{ date: string; value: string }> }): FredObservation[] {
  return (json.observations ?? [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .filter((o) => Number.isFinite(o.value));
}

function observationsFromEntry(entry: CacheEntry): FredObservation[] {
  return parseObservations(JSON.parse(entry.body));
}

async function loadPersistedFredCache(key: string): Promise<CacheEntry | null> {
  try {
    const store = signalsStore();
    const data = await store.get(`${FRED_BLOB_KEY_PREFIX}${key}`, { type: 'json' }) as CacheEntry | null;
    if (!data?.body) return null;
    return data;
  } catch {
    return null;
  }
}

async function persistFredCache(key: string, entry: CacheEntry): Promise<void> {
  try {
    const store = signalsStore();
    await store.setJSON(`${FRED_BLOB_KEY_PREFIX}${key}`, entry);
  } catch (error) {
    console.warn('[fredClient] Failed to persist blob cache:', error);
  }
}

function freshFredCache(entry: CacheEntry | undefined): CacheEntry | null {
  if (entry && entry.expiresAt > Date.now()) {
    return entry;
  }
  return null;
}

export async function fetchFredObservations(
  seriesId: string,
  options: { observationStart?: string | null } = {},
): Promise<FredObservation[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY not configured');

  const observationStart = options.observationStart ?? null;
  const key = cacheKey(seriesId, observationStart);
  let memoryEntry = fredCache.get(key);
  const freshMemory = freshFredCache(memoryEntry);

  if (freshMemory) {
    return observationsFromEntry(freshMemory);
  }

  if (!memoryEntry) {
    const persisted = await loadPersistedFredCache(key);
    if (persisted) {
      fredCache.set(key, persisted);
      memoryEntry = persisted;
      const freshPersisted = freshFredCache(persisted);
      if (freshPersisted) {
        return observationsFromEntry(freshPersisted);
      }
    }
  }

  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json` +
    (observationStart ? `&observation_start=${encodeURIComponent(observationStart)}` : '');

  let lastStatus = 0;
  for (let attempt = 0; attempt <= FRED_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(FRED_RETRY_DELAYS_MS[attempt - 1]);
    }

    const res = await fetch(url);
    lastStatus = res.status;

    if (res.ok) {
      const body = await res.text();
      const entry: CacheEntry = { expiresAt: Date.now() + FRED_CACHE_TTL_MS, body };
      fredCache.set(key, entry);
      void persistFredCache(key, entry);
      return observationsFromEntry(entry);
    }

    if (res.status === 429) {
      lastStatus = 429;
      if (memoryEntry) {
        console.warn(
          `[fredClient] ${seriesId}: HTTP 429; serving stale cache (${observationStart ?? 'all'}).`,
        );
        return observationsFromEntry(memoryEntry);
      }
      break;
    }

    break;
  }

  if (memoryEntry) {
    console.warn(
      `[fredClient] ${seriesId}: HTTP ${lastStatus}; serving stale cache (${observationStart ?? 'all'}).`,
    );
    return observationsFromEntry(memoryEntry);
  }

  throw new Error(`FRED ${seriesId}: HTTP ${lastStatus}`);
}

/**
 * Fetch multiple FRED series sequentially with a small delay between calls.
 * Returns an empty array for any series that fails after retries (does not throw).
 */
export async function fetchFredSeriesBatch(
  seriesIds: string[],
  options: { observationStart?: string | null } = {},
): Promise<Map<string, FredObservation[]>> {
  const out = new Map<string, FredObservation[]>();

  for (let i = 0; i < seriesIds.length; i += 1) {
    const seriesId = seriesIds[i];
    try {
      out.set(seriesId, await fetchFredObservations(seriesId, options));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[fredClient] ${seriesId} fetch failed; continuing without fresh data. ${message}`);
      out.set(seriesId, []);
    }
    if (i < seriesIds.length - 1) {
      await sleep(FRED_INTER_SERIES_DELAY_MS);
    }
  }

  return out;
}

/** Return cached JSON body for the fred.ts HTTP proxy (full history, no start date). */
export async function fetchFredJsonBody(seriesId: string): Promise<string> {
  const key = cacheKey(seriesId, null);
  const cached = fredCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.body;
  }

  try {
    await fetchFredObservations(seriesId, { observationStart: null });
    const fresh = fredCache.get(key);
    if (fresh) return fresh.body;
  } catch {
    if (cached) return cached.body;
    throw new Error(`FRED ${seriesId}: fetch failed and no cache available`);
  }

  throw new Error(`FRED ${seriesId}: fetch succeeded but cache missing`);
}

export function hasFredCacheEntry(seriesId: string, observationStart: string | null = null): boolean {
  return fredCache.has(cacheKey(seriesId, observationStart));
}
