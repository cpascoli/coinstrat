import { fetchWithTimeout, decodeXml, stripTags } from '../newsFetch';
import { canonicalizeUrl, pickPublishedAt, toIsoDate } from './dates';
import type { NewsSection, SourceItem, SourceTrust } from './types';

const FEED_TIMEOUT_MS = 8000;
const USER_AGENT = 'CoinStrat Newsletter Bot/1.0';

export interface ParsedFeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  updatedAt: string | null;
  summary: string;
}

function readTag(block: string, names: string[]): string {
  for (const name of names) {
    const cdata = block.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>`, 'i'));
    if (cdata?.[1]) return cdata[1].trim();
    const plain = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (plain?.[1]) return plain[1].trim();
  }
  return '';
}

function readLink(block: string): string {
  const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (href?.[1]) return decodeXml(href[1].trim());
  const rss = readTag(block, ['link']);
  return decodeXml(rss);
}

/**
 * Parse RSS 2.0 and Atom items. `published` / `pubDate` is the publish date;
 * `updated` is recorded but never used as the publish date.
 */
export function parseFeedItems(xml: string): ParsedFeedItem[] {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return blocks.map((block) => {
    const title = stripTags(readTag(block, ['title']));
    const url = readLink(block);
    const publishedRaw = readTag(block, ['published', 'pubDate', 'dc:date', 'date']);
    const updatedRaw = readTag(block, ['updated']);
    const summary = stripTags(readTag(block, ['summary', 'description', 'content']));
    return {
      title,
      url,
      publishedAt: pickPublishedAt(publishedRaw, updatedRaw),
      updatedAt: toIsoDate(updatedRaw),
      summary,
    };
  }).filter((item) => item.title && item.url);
}

export async function fetchRssFeed(opts: {
  url: string;
  source: string;
  section: NewsSection;
  trust: SourceTrust;
}): Promise<SourceItem[]> {
  const response = await fetchWithTimeout(opts.url, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  }, FEED_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`RSS fetch failed (${opts.source}): HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseFeedItems(xml).map((item) => ({
    url: canonicalizeUrl(item.url),
    title: item.title,
    source: opts.source,
    section: opts.section,
    publishedAt: item.publishedAt,
    trust: opts.trust,
    excerpt: item.summary || undefined,
  }));
}
