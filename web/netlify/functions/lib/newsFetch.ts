/**
 * Shared news sourcing helpers used by the weekly newsletter and the daily
 * news front page: Google News RSS search, article page fetching (excerpt +
 * the page's own publish date) and small text utilities.
 */

export interface NewsCandidate {
  title: string;
  url: string;
  source: string;
  summary: string;
  publishedAt: string | null;
}

export interface ArticleExcerpt {
  url: string;
  excerpt: string;
  /** Publish date extracted from the article page's own metadata, if found. */
  publishedAt: string | null;
}

const ARTICLE_FETCH_TIMEOUT_MS = 3500;
const ARTICLE_EXCERPT_MAX_CHARS = 1800;
const BOT_USER_AGENT = 'CoinStrat Newsletter Bot/1.0';

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export function stripTags(value: string): string {
  const decoded = decodeXml(value);
  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanNewsSummary(title: string, summary: string, source: string): string {
  const normalizedTitle = stripTags(title).trim();
  const normalizedSource = stripTags(source).trim();
  let cleaned = stripTags(summary)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const loweredTitle = normalizedTitle.toLowerCase();
  const loweredSource = normalizedSource.toLowerCase();
  const loweredCleaned = cleaned.toLowerCase();

  if (
    loweredCleaned === loweredTitle ||
    loweredCleaned === `${loweredTitle} - ${loweredSource}` ||
    loweredCleaned.includes(`${loweredTitle} ${loweredSource}`) ||
    loweredCleaned.includes(`${loweredTitle} - ${loweredSource}`)
  ) {
    return '';
  }

  cleaned = cleaned
    .replace(new RegExp(`^${escapeRegExp(normalizedTitle)}\\s*[-–—]?\\s*`, 'i'), '')
    .replace(new RegExp(`\\s*[-–—]?\\s*${escapeRegExp(normalizedSource)}$`, 'i'), '')
    .trim();

  return cleaned;
}

function dedupeTextParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = normalizeWhitespace(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractMetaContent(html: string, pattern: RegExp): string {
  const match = html.match(pattern);
  return normalizeWhitespace(decodeXml(match?.[1] ?? ''));
}

function extractArticleParagraphs(html: string): string[] {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const paragraphs = withoutScripts.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];

  return dedupeTextParts(
    paragraphs
      .map((paragraph) => stripTags(paragraph))
      .map((paragraph) => normalizeWhitespace(paragraph))
      .filter((paragraph) => paragraph.length >= 80)
      .filter((paragraph) => !/cookie|privacy|sign up|subscribe|advertis/i.test(paragraph)),
  ).slice(0, 4);
}

/**
 * The true publish date from the article page itself. Google News RSS
 * `pubDate` reflects when Google (re)indexed an item, not when it was written,
 * so months-old stories occasionally resurface with a fresh feed date. The
 * page's own metadata is authoritative: OpenGraph `article:published_time`,
 * JSON-LD `datePublished`, or a `datePublished` itemprop/time attribute.
 */
export function extractPagePublishedAt(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+itemprop=["']datePublished["'][^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return null;
}

const GOOGLE_NEWS_HOST_RX = /^https?:\/\/news\.google\.com\//;

/**
 * Google News RSS links no longer redirect server-side: fetching them returns
 * a Google interstitial that resolves the publisher URL with JavaScript. The
 * interstitial embeds a signature (`data-n-a-sg`) and timestamp
 * (`data-n-a-ts`) that Google's `batchexecute` endpoint exchanges for the real
 * article URL — the same call the interstitial itself makes. Best effort: any
 * failure returns null and the caller keeps the Google link.
 */
async function resolveGoogleNewsUrl(articleUrl: string, interstitialHtml: string): Promise<string | null> {
  try {
    const id = articleUrl.split('/articles/')[1]?.split('?')[0];
    const sg = interstitialHtml.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = interstitialHtml.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!id || !sg || !ts || !/^\d+$/.test(ts)) return null;

    const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],${JSON.stringify(id)},${ts},${JSON.stringify(sg)}]`;
    const body = `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner]]]))}`;

    const response = await fetchWithTimeout('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': BOT_USER_AGENT,
      },
      body,
    }, ARTICLE_FETCH_TIMEOUT_MS);
    if (!response.ok) return null;

    const text = await response.text();
    const idx = text.indexOf('garturlres');
    if (idx < 0) return null;
    const match = text.slice(idx).match(/https?:\/\/[^\\"]+/);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function fetchArticleExcerpt(candidate: NewsCandidate): Promise<ArticleExcerpt | null> {
  try {
    const response = await fetchWithTimeout(candidate.url, {
      method: 'GET',
      headers: {
        'User-Agent': BOT_USER_AGENT,
      },
    }, ARTICLE_FETCH_TIMEOUT_MS);

    if (!response.ok) return null;

    let html = await response.text();
    let finalUrl = response.url || candidate.url;

    // Google News links land on an interstitial, not the article. Resolve the
    // publisher URL and fetch the real page for the excerpt and page date.
    if (GOOGLE_NEWS_HOST_RX.test(finalUrl)) {
      const publisherUrl = await resolveGoogleNewsUrl(candidate.url, html);
      if (!publisherUrl) return null;
      const publisherResponse = await fetchWithTimeout(publisherUrl, {
        method: 'GET',
        headers: {
          'User-Agent': BOT_USER_AGENT,
        },
      }, ARTICLE_FETCH_TIMEOUT_MS);
      if (!publisherResponse.ok) return null;
      html = await publisherResponse.text();
      finalUrl = publisherResponse.url || publisherUrl;
    }

    const metaDescription = extractMetaContent(
      html,
      /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    );
    const paragraphs = extractArticleParagraphs(html);
    const excerpt = dedupeTextParts([metaDescription, ...paragraphs])
      .join(' ')
      .slice(0, ARTICLE_EXCERPT_MAX_CHARS);

    return excerpt ? { url: finalUrl, excerpt, publishedAt: extractPagePublishedAt(html) } : null;
  } catch {
    return null;
  }
}

function parseGoogleNewsItems(xml: string): NewsCandidate[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];

  return items.map((item) => {
    const read = (pattern: RegExp) => {
      const match = item.match(pattern);
      return (match?.[1] ?? match?.[2] ?? '').trim();
    };
    const title = stripTags(read(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/));
    const link = decodeXml(read(/<link>([\s\S]*?)<\/link>/));
    const description = stripTags(read(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/));
    const source = stripTags(read(/<source[^>]*>([\s\S]*?)<\/source>/)) || 'News';
    const publishedAt = read(/<pubDate>([\s\S]*?)<\/pubDate>/) || null;

    return {
      title,
      url: link,
      source,
      summary: cleanNewsSummary(title, description, source),
      publishedAt,
    };
  }).filter((item) => item.title && item.url);
}

export async function fetchNewsCandidates(query: string): Promise<NewsCandidate[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'User-Agent': BOT_USER_AGENT,
    },
  }, 4500);
  if (!response.ok) {
    throw new Error(`News RSS fetch failed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseGoogleNewsItems(xml);
}
