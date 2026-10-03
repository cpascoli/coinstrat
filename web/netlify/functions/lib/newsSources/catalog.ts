import { buildNewsQuerySets, classifyNewsTopic, type NewsTopic } from '../newsletter';
import { fetchArticleExcerpt, fetchNewsCandidates } from '../newsFetch';
import { canonicalizeUrl, hostOf, mentionsBitcoin } from './dates';
import { fetchGithubDevelopment } from './github';
import { fetchHackerNews } from './hackerNews';
import { fetchNostrLongform } from './nostr';
import { fetchRssFeed } from './rss';
import type { NewsSection, SourceItem, SourceTrust } from './types';

/** Aggregators and promotional sites we never treat as primary reporting. */
export const DOMAIN_DENYLIST = new Set([
  'pluang.com',
  'techbullion.com',
  'news.google.com',
  'news.bitcoin.com',
]);

export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WIDENED_WINDOW_MS = 72 * 60 * 60 * 1000;
export const STALE_DAYS_BEFORE_WIDEN = 7;
export const MIN_FRESH_ITEMS = 2;
export const MIN_PRIMARY_ITEMS = 1;

interface RssSource {
  url: string;
  source: string;
  section: NewsSection;
  trust: SourceTrust;
  bitcoinOnly?: boolean;
}

const RSS_SOURCES: RssSource[] = [
  { url: 'https://delvingbitcoin.org/latest.rss', source: 'Delving Bitcoin', section: 'development', trust: 'primary' },
  { url: 'https://bitcoinops.org/feed.xml', source: 'Bitcoin Optech', section: 'development', trust: 'primary' },
  { url: 'https://stacker.news/~bitcoin/rss', source: 'Stacker News', section: 'development', trust: 'secondary' },
  { url: 'https://stacker.news/~tech/rss', source: 'Stacker News', section: 'development', trust: 'secondary' },
  { url: 'https://bitcoinmagazine.com/.rss/full/', source: 'Bitcoin Magazine', section: 'culture', trust: 'primary' },
  { url: 'https://stacker.news/~bitcoin/rss', source: 'Stacker News', section: 'culture', trust: 'secondary' },
  { url: 'https://www.therage.co/rss/', source: 'The Rage', section: 'culture', trust: 'primary' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', section: 'market', trust: 'primary', bitcoinOnly: true },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block', section: 'market', trust: 'primary', bitcoinOnly: true },
  { url: 'https://decrypt.co/feed', source: 'Decrypt', section: 'market', trust: 'primary', bitcoinOnly: true },
  { url: 'https://www.tftc.io/rss/', source: 'TFTC', section: 'opinion', trust: 'primary' },
];

const CULTURE_KEYWORDS = [
  'conference', 'community', 'meetup', 'education', 'human rights', 'circular economy',
  'nostr', 'documentary', 'film', 'book', 'podcast', 'grassroots', 'culture',
  'el salvador', 'remittance', 'unbanked', 'university', 'adoption',
];
const MACRO_KEYWORDS = [
  'fed', 'federal reserve', 'inflation', 'rates', 'geopolit', 'imf', 'treasury',
  'dollar', 'macro', 'war', 'sanction', 'jobs report', 'unemployment',
];
const DEV_KEYWORDS = [
  'bitcoin core', 'bip', 'soft fork', 'lightning', 'mempool', 'wallet', 'protocol',
  'release', 'node', 'covenant', 'taproot',
];

export function deniedHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  for (const denied of DOMAIN_DENYLIST) {
    if (host === denied || host.endsWith(`.${denied}`)) return true;
  }
  return false;
}

export function classifyOutletSection(title: string, summary: string, fallback: NewsSection): NewsSection {
  const haystack = `${title} ${summary}`.toLowerCase();
  const hits = (keywords: string[]) => keywords.reduce((n, word) => n + (haystack.includes(word) ? 1 : 0), 0);
  const development = hits(DEV_KEYWORDS);
  const culture = hits(CULTURE_KEYWORDS);
  const opinion = hits(MACRO_KEYWORDS);
  const ranked: Array<{ section: NewsSection; score: number }> = [
    { section: 'development' as const, score: development },
    { section: 'culture' as const, score: culture },
    { section: 'opinion' as const, score: opinion },
  ];
  ranked.sort((a, b) => b.score - a.score);
  if (ranked[0].score > 0 && ranked[0].score > ranked[1].score) return ranked[0].section;
  return fallback;
}

function topicToSection(topic: NewsTopic): NewsSection {
  switch (topic) {
    case 'markets':
      return 'market';
    case 'development':
      return 'development';
    case 'culture':
      return 'culture';
    default: {
      const _exhaustive: never = topic;
      return _exhaustive;
    }
  }
}

async function fetchGoogleSection(section: NewsSection, lookbackDays: number): Promise<SourceItem[]> {
  const topic: NewsTopic = section === 'development' ? 'development' : section === 'culture' ? 'culture' : 'markets';
  const queries = buildNewsQuerySets(lookbackDays).filter((set) => set.topic === topic);
  const results = await Promise.allSettled(queries.map((set) => fetchNewsCandidates(set.query)));
  const items: SourceItem[] = [];
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const fallback = queries[index]?.topic ?? topic;
    for (const candidate of result.value) {
      if (deniedHost(candidate.url)) continue;
      const classified = classifyNewsTopic(candidate, fallback);
      items.push({
        url: canonicalizeUrl(candidate.url),
        title: candidate.title,
        source: candidate.source || 'Google News',
        section: topicToSection(classified),
        publishedAt: candidate.publishedAt,
        trust: 'secondary',
        excerpt: candidate.summary || undefined,
      });
    }
  });
  return items;
}

async function fetchListedRss(): Promise<SourceItem[]> {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(async (source) => {
      const items = await fetchRssFeed(source);
      return items
        .filter((item) => !deniedHost(item.url))
        .filter((item) => !source.bitcoinOnly || mentionsBitcoin(`${item.title} ${item.excerpt ?? ''}`))
        .map((item) => {
          if (source.source === 'Bitcoin Magazine' || source.source === 'TFTC' || source.source === 'Stacker News') {
            return { ...item, section: classifyOutletSection(item.title, item.excerpt ?? '', source.section) };
          }
          return item;
        });
    }),
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

export async function gatherCatalogSources(lookbackMs: number): Promise<SourceItem[]> {
  const lookbackDays = Math.max(1, Math.ceil(lookbackMs / (24 * 60 * 60 * 1000)));
  const settled = await Promise.allSettled([
    fetchListedRss(),
    fetchGithubDevelopment(),
    fetchHackerNews(),
    fetchNostrLongform(lookbackMs),
    fetchGoogleSection('market', lookbackDays),
    fetchGoogleSection('development', lookbackDays),
    fetchGoogleSection('culture', lookbackDays),
  ]);
  const items: SourceItem[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') items.push(...result.value);
    else console.warn('[newsSources] fetcher failed', result.reason);
  }
  return items.filter((item) => !deniedHost(item.url));
}

export async function enrichSource(item: SourceItem): Promise<SourceItem> {
  if (item.excerpt && item.excerpt.length >= 80 && item.publishedAt) return item;
  const excerpt = await fetchArticleExcerpt({
    title: item.title,
    url: item.url,
    source: item.source,
    summary: item.excerpt ?? '',
    publishedAt: item.publishedAt,
  });
  if (!excerpt) return item;
  return {
    ...item,
    url: canonicalizeUrl(excerpt.url || item.url),
    excerpt: excerpt.excerpt || item.excerpt,
    publishedAt: excerpt.publishedAt ?? item.publishedAt,
  };
}
