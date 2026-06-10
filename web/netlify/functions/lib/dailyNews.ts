import { serviceSupabase } from './auth';
import {
  fetchArticleExcerpt,
  fetchNewsCandidates,
  normalizeWhitespace,
  scoreNewsCandidate,
  type NewsCandidate,
} from './newsletter';

/**
 * Daily Bitcoin news article generator.
 *
 * Sources Bitcoin/crypto headlines published in the prior ~24h (Google News
 * RSS), enriches the strongest stories with article excerpts, then asks the LLM
 * to write one original, cohesive news story that stitches the threads
 * together. The result is published to the public `news_articles` table along
 * with an attributed list of source links (title + source + url), mirroring the
 * weekly newsletter's "Weekly Bitcoin Headlines" format.
 */

const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_NEWS_MODEL || process.env.OPENAI_NEWSLETTER_MODEL || 'gpt-4.1-mini';

const imageEnabled = (process.env.DAILY_NEWS_IMAGE ?? 'true').toLowerCase() !== 'false';
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const imageQuality = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const IMAGE_SIZE = '1536x1024';
const IMAGE_BUCKET = process.env.NEWS_IMAGE_BUCKET || 'news-images';
const IMAGE_TIMEOUT_MS = 45000;
// Brand-consistent style guard. Image models render text/logos/people poorly and
// fabricated charts look misleading for news, so we explicitly exclude them.
const IMAGE_STYLE =
  'Bold pop art style: vivid saturated colors, halftone dots, strong outlines, high-contrast comic-book aesthetic. The image must be a single sophisticated visual metaphor for the one key takeaway of the article. No Bitcoin or cryptocurrency coin logos or coin symbols. No text, no words, no letters, no numbers, no brand logos, no charts, no graphs, no identifiable real people.';

const NEWS_QUERIES = [
  'Bitcoin OR BTC (ETF OR treasury OR adoption OR mining OR regulation OR Lightning OR mempool OR macro) when:1d',
  '(Bitcoin OR BTC) (site:coindesk.com OR site:bitcoinmagazine.com OR site:cointelegraph.com OR site:decrypt.co OR site:theblock.co) when:1d',
  '(bitcoin OR btc) (market OR treasury OR mining OR policy OR adoption OR lightning OR custody) when:1d',
];

const RECENCY_WINDOW_MS = 30 * 60 * 60 * 1000; // 30h grace over the 24h window for RSS pubDate jitter
const MAX_SOURCES = 8;
const MAX_ENRICHED_STORIES = 6;
const PROMPT_EXCERPT_MAX_CHARS = 700;
const OPENAI_TIMEOUT_MS = 45000;
const MIN_SOURCES_TO_PUBLISH = 3;

const MAX_HEADLINE = 200;
const MAX_SUMMARY = 600;
const MAX_LABELS = 5;

export interface DailyNewsSource {
  title: string;
  url: string;
  source: string;
}

interface SourcePacket {
  title: string;
  source: string;
  url: string;
  excerpt: string;
}

interface GeneratedArticle {
  headline: string;
  summary: string;
  body: string;
  labels: string[];
  imagePrompt: string;
  imageAlt: string;
}

export interface DailyNewsResult {
  ok: boolean;
  skipped: boolean;
  reason: string;
  slug: string | null;
  date: string;
  sourceCount: number;
  article?: {
    headline: string;
    summary: string;
    body: string;
    labels: string[];
    sources: DailyNewsSource[];
    publishedAt: string;
    imageUrl: string | null;
    imageAlt: string | null;
  };
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dailySlug(date: Date): string {
  return `bitcoin-news-${utcDateKey(date)}`;
}

/**
 * Google News RSS titles usually end with " - Source Name". Strip that trailing
 * source attribution so the link text isn't redundant with the source label.
 */
function cleanSourceTitle(title: string, source: string): string {
  const cleaned = title.trim();
  const src = source.trim();
  if (!src) return cleaned;
  const suffix = new RegExp(`\\s*[-–—|]\\s*${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const stripped = cleaned.replace(suffix, '').trim();
  return stripped || cleaned;
}

function parsePublishedAt(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function dedupeCandidates(candidates: NewsCandidate[]): NewsCandidate[] {
  const deduped = new Map<string, NewsCandidate>();
  for (const candidate of candidates) {
    const key = (candidate.url || candidate.title).toLowerCase();
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return Array.from(deduped.values());
}

/** Keep stories within the recency window; if none carry a usable pubDate, fall back to all. */
function filterRecent(candidates: NewsCandidate[], now: number): NewsCandidate[] {
  const recent = candidates.filter((candidate) => {
    const ms = parsePublishedAt(candidate.publishedAt);
    return ms != null && now - ms <= RECENCY_WINDOW_MS && ms <= now + 60 * 60 * 1000;
  });
  return recent.length > 0 ? recent : candidates;
}

async function sourceDailyStories(now: number): Promise<{ sources: DailyNewsSource[]; packets: SourcePacket[] }> {
  const candidateResults = await Promise.allSettled(
    NEWS_QUERIES.map((query) => fetchNewsCandidates(query)),
  );

  const allCandidates = candidateResults.flatMap((result) => (
    result.status === 'fulfilled' ? result.value : []
  ));

  const recent = filterRecent(dedupeCandidates(allCandidates), now);

  const selected = recent
    .sort((a, b) => scoreNewsCandidate(b) - scoreNewsCandidate(a))
    .slice(0, MAX_SOURCES);

  const enrichedResults = await Promise.allSettled(
    selected.slice(0, MAX_ENRICHED_STORIES).map((candidate) => fetchArticleExcerpt(candidate)),
  );

  const excerptByTitle = new Map<string, { url: string; excerpt: string }>();
  enrichedResults.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    const candidate = selected[index];
    if (candidate) excerptByTitle.set(candidate.title, result.value);
  });

  const sources: DailyNewsSource[] = selected.map((candidate) => {
    const source = candidate.source || 'News';
    return {
      title: cleanSourceTitle(candidate.title, source),
      url: excerptByTitle.get(candidate.title)?.url ?? candidate.url,
      source,
    };
  });

  const packets: SourcePacket[] = selected
    .map((candidate) => {
      const enriched = excerptByTitle.get(candidate.title);
      const excerpt = normalizeWhitespace(enriched?.excerpt ?? candidate.summary ?? '').slice(0, PROMPT_EXCERPT_MAX_CHARS);
      return {
        title: candidate.title,
        source: candidate.source || 'News',
        url: enriched?.url ?? candidate.url,
        excerpt,
      };
    })
    .filter((packet) => packet.title && packet.url && packet.excerpt.length >= 60);

  return { sources, packets };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, 40);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean)
    .join('\n\n');
}

async function generateDailyArticle(packets: SourcePacket[], dateLabel: string): Promise<GeneratedArticle> {
  if (!openAiApiKey) {
    throw new Error('Daily news generation failed: OPENAI_API_KEY is not configured.');
  }
  if (packets.length === 0) {
    throw new Error('Daily news generation failed: no article excerpts were available.');
  }

  const payload = {
    model: openAiModel,
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a senior Bitcoin markets journalist writing the daily Bitcoin news brief for CoinStrat. You will receive a set of source packets (title, source, url, and cleaned excerpts) covering Bitcoin and related developments from the last 24 hours. Write ONE original, cohesive news story that organically stitches these threads together — connect the dots between flows, macro, policy, mining, treasuries, and on-chain developments rather than listing items separately. Ground every claim in the supplied excerpts; do not invent facts, numbers, or quotes that are not present. Maintain a calm, professional, analytical voice and avoid hype. Return valid JSON with exactly these keys: `headline`, `summary`, `body`, `labels`, `imagePrompt`, `imageAlt`. `headline` is a specific, compelling title under 120 characters. `summary` is one or two sentences (max ~50 words) that work as a card teaser. `body` is the full article: 450-750 words of PLAIN TEXT only (no markdown, no headings, no hyperlinks, no bullet lists), split into 4-6 short paragraphs separated by a single blank line. Do not include a sources list in the body — sources are attached separately. `labels` is an array of 2-4 short topic tags (e.g. "ETF Flows", "Macro", "Mining", "Regulation"). `imagePrompt` is a single vivid sentence describing a sophisticated visual metaphor for ONE key takeaway concept from today\'s story, rendered in a bold pop art style (describe the metaphorical scene, symbolic objects, mood, and composition — never request any text, words, Bitcoin or cryptocurrency coin logos/symbols, brand logos, charts, or real people). `imageAlt` is a short, literal alt-text description of that image for accessibility.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          brandVoice: 'Concise analytical Bitcoin news for accumulators. Professional, calm, specific, no hype.',
          dateUtc: dateLabel,
          instruction: 'Write today\'s Bitcoin news story from these source packets, weaving them into one narrative.',
          sourcePackets: packets,
        }),
      },
    ],
  };

  let response: Response;
  try {
    response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(payload),
    }, OPENAI_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Daily news generation failed: OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms using model ${openAiModel}.`);
    }
    throw error;
  }

  if (!response.ok) {
    const bodyText = normalizeWhitespace(await response.text()).slice(0, 400);
    throw new Error(`Daily news generation failed: OpenAI HTTP ${response.status}${bodyText ? ` - ${bodyText}` : ''}`);
  }

  const json = await response.json() as any;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Daily news generation failed: OpenAI returned an empty response.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Daily news generation failed: OpenAI returned invalid JSON - ${normalizeWhitespace(content).slice(0, 300)}`);
  }

  const headline = typeof parsed?.headline === 'string' ? parsed.headline.trim().slice(0, MAX_HEADLINE) : '';
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, MAX_SUMMARY) : '';
  const body = typeof parsed?.body === 'string' ? normalizeBody(parsed.body) : '';
  const labels = normalizeLabels(parsed?.labels);
  const imagePrompt = typeof parsed?.imagePrompt === 'string' ? parsed.imagePrompt.trim().slice(0, 600) : '';
  const imageAlt = typeof parsed?.imageAlt === 'string' ? parsed.imageAlt.trim().slice(0, 300) : '';

  if (!headline || !summary || body.length < 200) {
    throw new Error('Daily news generation failed: OpenAI response was missing a usable headline, summary, or body.');
  }

  return { headline, summary, body, labels: labels.length > 0 ? labels : ['Bitcoin'], imagePrompt, imageAlt };
}

/**
 * Best-effort: generate an illustration for the article and store it in the
 * public Supabase Storage bucket. Returns the public URL + alt text, or null on
 * any failure (never throws — the article still publishes without an image).
 */
function storagePathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${IMAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const rest = url.slice(idx + marker.length).split('?')[0];
  return rest || null;
}

async function generateArticleImage(
  slug: string,
  imagePrompt: string,
  imageAlt: string,
  headline: string,
): Promise<{ url: string; alt: string; path: string } | null> {
  if (!imageEnabled || !openAiApiKey) return null;

  const prompt = (imagePrompt || `A sophisticated visual metaphor for the key takeaway of this Bitcoin news story: ${headline}`).trim();

  // gpt-image-1 always returns b64 and rejects `response_format`; dall-e-3 needs
  // `response_format: 'b64_json'` and a different size/quality vocabulary.
  const isDallE = imageModel.includes('dall-e');
  const requestBody = isDallE
    ? {
        model: imageModel,
        prompt: `${prompt}\n\nStyle: ${IMAGE_STYLE}`,
        size: '1792x1024',
        quality: imageQuality === 'high' ? 'hd' : 'standard',
        response_format: 'b64_json',
        n: 1,
      }
    : {
        model: imageModel,
        prompt: `${prompt}\n\nStyle: ${IMAGE_STYLE}`,
        size: IMAGE_SIZE,
        quality: imageQuality,
        n: 1,
      };

  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    }, IMAGE_TIMEOUT_MS);

    if (!response.ok) {
      console.error('[dailyNews/image] OpenAI HTTP', response.status, normalizeWhitespace(await response.text()).slice(0, 300));
      return null;
    }

    const json = await response.json() as any;
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || !b64) {
      console.error('[dailyNews/image] no image data returned');
      return null;
    }

    const bytes = Buffer.from(b64, 'base64');
    // Unique path per generation so the storage CDN can never serve a stale
    // version of a regenerated image; the previous file is cleaned up by caller.
    const path = `${slug}-${Date.now()}.png`;

    const { error: uploadError } = await serviceSupabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: 'image/png', upsert: true, cacheControl: '31536000' });

    if (uploadError) {
      console.error('[dailyNews/image] upload failed', uploadError.message);
      return null;
    }

    const { data } = serviceSupabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    const url = data?.publicUrl;
    if (!url) return null;

    return { url, alt: imageAlt || headline, path };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[dailyNews/image] timed out after ${IMAGE_TIMEOUT_MS}ms`);
    } else {
      console.error('[dailyNews/image]', error);
    }
    return null;
  }
}

async function upsertArticle(args: {
  slug: string;
  article: GeneratedArticle;
  sources: DailyNewsSource[];
  publishedAt: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const row = {
    slug: args.slug,
    headline: args.article.headline,
    summary: args.article.summary,
    body: args.article.body,
    labels: args.article.labels,
    source_links: [] as string[],
    sources: args.sources,
    published_at: args.publishedAt,
    updated_at: now,
  };

  const { data: existing, error: selectError } = await serviceSupabase
    .from('news_articles')
    .select('id')
    .eq('slug', args.slug)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Daily news publish failed: ${selectError.message}`);
  }

  if (existing?.id) {
    const { error } = await serviceSupabase
      .from('news_articles')
      .update(row)
      .eq('id', existing.id);
    if (error) throw new Error(`Daily news publish failed: ${error.message}`);
    return;
  }

  const { error } = await serviceSupabase
    .from('news_articles')
    .insert({ ...row, created_at: now });
  if (error) throw new Error(`Daily news publish failed: ${error.message}`);
}

async function updateArticleImage(slug: string, imageUrl: string, imageAlt: string): Promise<void> {
  const { error } = await serviceSupabase
    .from('news_articles')
    .update({ image_url: imageUrl, image_alt: imageAlt, updated_at: new Date().toISOString() })
    .eq('slug', slug);
  if (error) console.error('[dailyNews] failed to attach image', error.message);
}

/**
 * Generate and publish today's daily Bitcoin news article. Idempotent for a
 * given UTC day: re-running overwrites the same `bitcoin-news-YYYY-MM-DD` slug.
 */
export async function runDailyNewsGeneration(referenceDate?: Date): Promise<DailyNewsResult> {
  const now = referenceDate ?? new Date();
  const slug = dailySlug(now);
  const dateKey = utcDateKey(now);

  const { sources, packets } = await sourceDailyStories(now.getTime());

  if (packets.length < MIN_SOURCES_TO_PUBLISH) {
    return {
      ok: true,
      skipped: true,
      reason: `Only ${packets.length} usable source(s) found in the last 24h (need ${MIN_SOURCES_TO_PUBLISH}); skipped publishing.`,
      slug: null,
      date: dateKey,
      sourceCount: packets.length,
    };
  }

  const article = await generateDailyArticle(packets, dateKey);
  const publishedAt = now.toISOString();
  const finalSources = sources.slice(0, MAX_SOURCES);

  // Remember the previous image (if regenerating) so we can clean it up.
  const { data: prevRow } = await serviceSupabase
    .from('news_articles')
    .select('image_url')
    .eq('slug', slug)
    .maybeSingle();
  const previousImageUrl: string | null = prevRow?.image_url ?? null;

  // Publish the text first so a slow/failed image step never blocks the article.
  await upsertArticle({ slug, article, sources: finalSources, publishedAt });

  const image = await generateArticleImage(slug, article.imagePrompt, article.imageAlt, article.headline);
  if (image) {
    await updateArticleImage(slug, image.url, image.alt);

    const previousPath = storagePathFromPublicUrl(previousImageUrl);
    if (previousPath && previousPath !== image.path) {
      const { error: removeError } = await serviceSupabase.storage.from(IMAGE_BUCKET).remove([previousPath]);
      if (removeError) console.warn('[dailyNews] previous image cleanup failed', removeError.message);
    }
  }

  return {
    ok: true,
    skipped: false,
    reason: `Published "${article.headline}" with ${finalSources.length} sources${image ? ' and an illustration' : ''}.`,
    slug,
    date: dateKey,
    sourceCount: finalSources.length,
    article: {
      headline: article.headline,
      summary: article.summary,
      body: article.body,
      labels: article.labels,
      sources: finalSources,
      publishedAt,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
    },
  };
}
