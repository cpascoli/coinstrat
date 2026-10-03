import { isNearDuplicateTitle } from '../newsletter';
import {
  FRESH_WINDOW_MS,
  MIN_FRESH_ITEMS,
  MIN_PRIMARY_ITEMS,
  STALE_DAYS_BEFORE_WIDEN,
  WIDENED_WINDOW_MS,
} from './catalog';
import { canonicalizeUrl } from './dates';
import type { NewsSection, SourceItem } from './types';
import { NEWS_SECTIONS } from './types';

export function freshnessWindowMs(daysSinceLastPublish: number | null): number {
  if (daysSinceLastPublish != null && daysSinceLastPublish >= STALE_DAYS_BEFORE_WIDEN) {
    return WIDENED_WINDOW_MS;
  }
  return FRESH_WINDOW_MS;
}

export function daysSince(publishedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(publishedAt)) / (24 * 60 * 60 * 1000);
}

export function isFresh(publishedAt: string | null, nowMs: number, windowMs: number): boolean {
  if (!publishedAt) return false;
  const ms = Date.parse(publishedAt);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms <= windowMs && ms <= nowMs + 60 * 60 * 1000;
}

export function excludeUsedUrls(items: SourceItem[], usedUrls: Iterable<string>): SourceItem[] {
  const used = new Set([...usedUrls].map((url) => canonicalizeUrl(url)));
  return items.filter((item) => !used.has(canonicalizeUrl(item.url)));
}

/** One story, one section: first occurrence wins after URL / title dedupe. */
export function assignSingleSection(items: SourceItem[]): SourceItem[] {
  const byUrl = new Map<string, SourceItem>();
  for (const item of items) {
    const key = canonicalizeUrl(item.url);
    if (!byUrl.has(key)) byUrl.set(key, item);
  }

  const unique = [...byUrl.values()];
  const kept: SourceItem[] = [];
  for (const item of unique) {
    if (kept.some((existing) => isNearDuplicateTitle(existing.title, item.title))) continue;
    kept.push(item);
  }
  return kept;
}

export function partitionBySection(items: SourceItem[]): Record<NewsSection, SourceItem[]> {
  const buckets: Record<NewsSection, SourceItem[]> = {
    market: [],
    development: [],
    culture: [],
    opinion: [],
  };
  for (const item of items) {
    buckets[item.section].push(item);
  }
  return buckets;
}

export function passesFreshnessBar(items: SourceItem[]): boolean {
  const primary = items.filter((item) => item.trust === 'primary').length;
  return items.length >= MIN_FRESH_ITEMS && primary >= MIN_PRIMARY_ITEMS;
}

export function selectSectionCandidates(
  items: SourceItem[],
  opts: {
    now: Date;
    usedUrls: Iterable<string>;
    daysSinceLastPublish: number | null;
    section: NewsSection;
  },
): { fresh: SourceItem[]; windowMs: number; clearsBar: boolean } {
  const windowMs = freshnessWindowMs(opts.daysSinceLastPublish);
  const nowMs = opts.now.getTime();
  const unused = excludeUsedUrls(items, opts.usedUrls);
  const assigned = assignSingleSection(unused).filter((item) => item.section === opts.section);
  const fresh = assigned.filter((item) => isFresh(item.publishedAt, nowMs, windowMs));
  return { fresh, windowMs, clearsBar: passesFreshnessBar(fresh) };
}

export function emptySectionBuckets(): Record<NewsSection, SourceItem[]> {
  return {
    market: [],
    development: [],
    culture: [],
    opinion: [],
  };
}

export { NEWS_SECTIONS };
