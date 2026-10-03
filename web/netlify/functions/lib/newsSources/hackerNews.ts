import { fetchWithTimeout } from '../newsFetch';
import { canonicalizeUrl, toIsoDate } from './dates';
import type { SourceItem } from './types';

const TIMEOUT_MS = 8000;
const MIN_POINTS = 10;

interface AlgoliaHit {
  title?: string;
  url?: string | null;
  points?: number;
  created_at?: string;
  created_at_i?: number;
  objectID?: string;
  story_text?: string;
}

export async function fetchHackerNews(): Promise<SourceItem[]> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent('bitcoin OR lightning')}&tags=story&numericFilters=${encodeURIComponent(`points>${MIN_POINTS}`)}&hitsPerPage=50`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { 'User-Agent': 'CoinStrat Newsletter Bot/1.0' },
  }, TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Hacker News fetch failed: HTTP ${response.status}`);
  }
  const json = await response.json() as { hits?: AlgoliaHit[] };
  return (json.hits ?? [])
    .filter((hit) => hit.title)
    .map((hit): SourceItem => {
      const storyUrl = hit.url
        || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : '');
      const publishedAt = toIsoDate(hit.created_at)
        ?? (typeof hit.created_at_i === 'number' ? new Date(hit.created_at_i * 1000).toISOString() : null);
      return {
        url: canonicalizeUrl(storyUrl),
        title: hit.title!.trim(),
        source: 'Hacker News',
        section: 'development',
        publishedAt,
        trust: 'secondary',
        excerpt: hit.story_text?.replace(/\s+/g, ' ').trim().slice(0, 700) || undefined,
      };
    })
    .filter((item) => item.url);
}
