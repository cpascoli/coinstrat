import { generateAndStoreImage, removeStoredImage } from './aiImage';
import { serviceSupabase } from './auth';
import { sendTransactionalEmail } from './emailDelivery';
import {
  editFrontPage,
  isCreditsExhaustedError,
  writeSectionArticle,
  type DailyFacts,
  type NewsSourcePacket,
  type SectionDraft,
} from './newsLlm';
import { enrichSource, gatherCatalogSources } from './newsSources/catalog';
import { canonicalizeUrl } from './newsSources/dates';
import { daysSince, selectSectionCandidates } from './newsSources/select';
import { NEWS_SECTIONS, type NewsSection, type SourceItem } from './newsSources/types';
import { signalsStore } from './store';

const imageEnabled = (process.env.DAILY_NEWS_IMAGE ?? 'true').toLowerCase() !== 'false';
const alertEmail = (process.env.NEWS_ALERT_EMAIL ?? '').trim();

export type SectionStatus = 'published' | 'kept' | 'failed';

export interface SectionOutcome {
  section: NewsSection;
  status: SectionStatus;
  reason: string;
  slug: string | null;
  headline: string | null;
}

export interface FrontPageResult {
  ok: boolean;
  date: string;
  runId: string | null;
  sections: Record<NewsSection, SectionOutcome>;
  error: string | null;
  creditsExhausted: boolean;
}

interface PreviousArticle {
  slug: string;
  headline: string;
  published_at: string;
  image_url: string | null;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sectionSlug(section: NewsSection, date: Date): string {
  return `bitcoin-${section}-${utcDateKey(date)}`;
}

function emptyOutcomes(): Record<NewsSection, SectionOutcome> {
  const outcomes = {} as Record<NewsSection, SectionOutcome>;
  for (const section of NEWS_SECTIONS) {
    outcomes[section] = { section, status: 'failed', reason: 'Not started', slug: null, headline: null };
  }
  return outcomes;
}

async function loadUsedUrls(): Promise<Set<string>> {
  const { data, error } = await serviceSupabase
    .from('news_source_usage')
    .select('url')
    .order('used_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.warn('[frontPage] failed to load used URLs', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => canonicalizeUrl(row.url as string)));
}

async function loadPreviousArticles(): Promise<Record<NewsSection, PreviousArticle | null>> {
  const previous = {
    market: null,
    development: null,
    culture: null,
    opinion: null,
  } as Record<NewsSection, PreviousArticle | null>;

  const results = await Promise.all(
    NEWS_SECTIONS.map((section) =>
      serviceSupabase
        .from('news_articles')
        .select('slug, headline, published_at, image_url')
        .eq('section', section)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((result) => ({ section, row: result.data })),
    ),
  );

  for (const { section, row } of results) {
    if (!row) continue;
    previous[section] = {
      slug: row.slug,
      headline: row.headline,
      published_at: row.published_at,
      image_url: row.image_url ?? null,
    };
  }
  return previous;
}

async function buildDailyFacts(now: Date): Promise<DailyFacts> {
  const date = utcDateKey(now);
  const facts: DailyFacts = {
    date,
    btcUsd: null,
    btcChange24hPct: null,
    cqmRiskPct: null,
    valScore: null,
    liqScore: null,
    dxyScore: null,
    bizCycleScore: null,
    bottomAccumScore: null,
    mempoolFastestFee: null,
  };

  try {
    const cached = await signalsStore().get('signals_latest', { type: 'json' }).catch(() => null) as
      | { data?: Array<Record<string, unknown>> }
      | null;
    const rows = cached?.data ?? [];
    const latest = rows.at(-1);
    const previous = rows.at(-2);
    if (latest) {
      const price = Number(latest.BTCUSD);
      facts.btcUsd = Number.isFinite(price) ? price : null;
      const prevPrice = Number(previous?.BTCUSD);
      if (facts.btcUsd != null && Number.isFinite(prevPrice) && prevPrice > 0) {
        facts.btcChange24hPct = Number((((facts.btcUsd - prevPrice) / prevPrice) * 100).toFixed(2));
      }
      const risk = Number(latest.CQM_RISK);
      facts.cqmRiskPct = Number.isFinite(risk) ? Number((risk <= 1 ? risk * 100 : risk).toFixed(1)) : null;
      facts.valScore = typeof latest.VAL_SCORE === 'number' ? latest.VAL_SCORE : null;
      facts.liqScore = typeof latest.LIQ_SCORE === 'number' ? latest.LIQ_SCORE : null;
      facts.dxyScore = typeof latest.DXY_SCORE === 'number' ? latest.DXY_SCORE : null;
      facts.bizCycleScore = typeof latest.BIZ_CYCLE_SCORE === 'number' ? latest.BIZ_CYCLE_SCORE : null;
      facts.bottomAccumScore = typeof latest.BOTTOM_ACCUM_SCORE === 'number' ? latest.BOTTOM_ACCUM_SCORE : null;
    }
  } catch (error) {
    console.warn('[frontPage] facts sheet signals failed', error);
  }

  try {
    const response = await fetch('https://mempool.space/api/v1/fees/recommended', {
      headers: { 'User-Agent': 'CoinStrat Newsletter Bot/1.0' },
    });
    if (response.ok) {
      const fees = await response.json() as { fastestFee?: number };
      if (typeof fees.fastestFee === 'number') facts.mempoolFastestFee = fees.fastestFee;
    }
  } catch (error) {
    console.warn('[frontPage] mempool facts failed', error);
  }

  return facts;
}

function toPackets(items: SourceItem[]): NewsSourcePacket[] {
  return items
    .map((item) => ({
      title: item.title,
      source: item.source,
      url: item.url,
      excerpt: (item.excerpt ?? '').trim(),
    }))
    .filter((packet) => packet.title && packet.url && packet.excerpt.length >= 60)
    .slice(0, 8);
}

async function upsertSectionArticle(args: {
  slug: string;
  section: NewsSection;
  draft: SectionDraft;
  sources: Array<{ title: string; url: string; source: string }>;
  publishedAt: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const row = {
    slug: args.slug,
    section: args.section,
    headline: args.draft.headline,
    summary: args.draft.summary,
    body: args.draft.body,
    labels: args.draft.labels,
    source_links: [] as string[],
    sources: args.sources,
    published_at: args.publishedAt,
    updated_at: now,
    ...(args.imageUrl ? { image_url: args.imageUrl, image_alt: args.imageAlt ?? null } : {}),
  };

  const { data: existing, error: selectError } = await serviceSupabase
    .from('news_articles')
    .select('id')
    .eq('slug', args.slug)
    .maybeSingle();
  if (selectError) throw new Error(`Front page publish failed: ${selectError.message}`);

  if (existing?.id) {
    const { error } = await serviceSupabase.from('news_articles').update(row).eq('id', existing.id);
    if (error) throw new Error(`Front page publish failed: ${error.message}`);
    return;
  }

  const { error } = await serviceSupabase.from('news_articles').insert({ ...row, created_at: now });
  if (error) throw new Error(`Front page publish failed: ${error.message}`);
}

async function recordSourceUsage(section: NewsSection, slug: string, items: SourceItem[]): Promise<void> {
  const rows = items.map((item) => ({
    url: canonicalizeUrl(item.url),
    section,
    article_slug: slug,
    used_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await serviceSupabase
    .from('news_source_usage')
    .upsert(rows, { onConflict: 'url' });
  if (error) console.warn('[frontPage] source usage upsert failed', error.message);
}

async function insertRun(date: string, trigger: string): Promise<string | null> {
  const { data, error } = await serviceSupabase
    .from('news_runs')
    .insert({ run_date: date, trigger, status: 'running', sections: {} })
    .select('id')
    .single();
  if (error) {
    console.warn('[frontPage] failed to insert news_run', error.message);
    return null;
  }
  return data.id as string;
}

async function finishRun(
  runId: string | null,
  status: 'finished' | 'failed',
  sections: Record<NewsSection, SectionOutcome>,
  error: string | null,
): Promise<void> {
  if (!runId) return;
  const { error: updateError } = await serviceSupabase
    .from('news_runs')
    .update({
      status,
      sections,
      error,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (updateError) console.warn('[frontPage] failed to finish news_run', updateError.message);
}

async function sendNewsAlert(subject: string, text: string): Promise<void> {
  if (!alertEmail) {
    console.warn('[frontPage] NEWS_ALERT_EMAIL is not set; skipping alert:', subject);
    return;
  }
  const result = await sendTransactionalEmail({
    to: alertEmail,
    subject,
    text,
    html: `<pre style="font-family:ui-monospace,monospace;white-space:pre-wrap">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`,
  });
  if (!result.ok) console.error('[frontPage] alert email failed', result.errorSummary);
}

function keptOutcome(section: NewsSection, previous: PreviousArticle | null, reason: string): SectionOutcome {
  return {
    section,
    status: 'kept',
    reason,
    slug: previous?.slug ?? null,
    headline: previous?.headline ?? null,
  };
}

export async function runFrontPageGeneration(opts?: {
  now?: Date;
  trigger?: string;
}): Promise<FrontPageResult> {
  const now = opts?.now ?? new Date();
  const date = utcDateKey(now);
  const trigger = opts?.trigger ?? 'scheduled';
  const outcomes = emptyOutcomes();
  const runId = await insertRun(date, trigger);
  let creditsExhausted = false;

  try {
    const [usedUrls, previous, gathered, facts] = await Promise.all([
      loadUsedUrls(),
      loadPreviousArticles(),
      gatherCatalogSources(WIDENED_LOOKBACK_MS),
      buildDailyFacts(now),
    ]);

    const toWrite: Array<{ section: NewsSection; items: SourceItem[] }> = [];

    for (const section of NEWS_SECTIONS) {
      const prev = previous[section];
      const daysUnchanged = prev ? daysSince(prev.published_at, now) : STALE_FALLBACK;
      const { fresh, clearsBar } = selectSectionCandidates(gathered, {
        now,
        usedUrls,
        daysSinceLastPublish: prev ? daysUnchanged : null,
        section,
      });

      if (!clearsBar) {
        outcomes[section] = keptOutcome(
          section,
          prev,
          `Not enough fresh ${section} sources (${fresh.length}); kept previous article.`,
        );
        continue;
      }
      toWrite.push({ section, items: fresh });
    }

    const enrichedBySection = new Map<NewsSection, SourceItem[]>();
    await Promise.all(
      toWrite.map(async ({ section, items }) => {
        const enriched = await Promise.all(items.slice(0, 10).map((item) => enrichSource(item)));
        enrichedBySection.set(section, enriched);
      }),
    );

    const writerResults = await Promise.allSettled(
      toWrite.map(async ({ section }) => {
        const packets = toPackets(enrichedBySection.get(section) ?? []);
        if (packets.length < 2) {
          throw new Error(`Only ${packets.length} usable excerpt(s) after enrichment.`);
        }
        const draft = await writeSectionArticle({ section, dateLabel: date, facts, packets });
        return { section, draft, packets, items: enrichedBySection.get(section) ?? [] };
      }),
    );

    const drafts: SectionDraft[] = [];
    const draftMeta = new Map<NewsSection, { packets: NewsSourcePacket[]; items: SourceItem[] }>();
    writerResults.forEach((result, index) => {
      const section = toWrite[index].section;
      if (result.status === 'rejected') {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        if (isCreditsExhaustedError(result.reason)) creditsExhausted = true;
        outcomes[section] = {
          section,
          status: 'failed',
          reason: message,
          slug: previous[section]?.slug ?? null,
          headline: previous[section]?.headline ?? null,
        };
        return;
      }
      drafts.push(result.value.draft);
      draftMeta.set(section, { packets: result.value.packets, items: result.value.items });
    });

    let editedDrafts = drafts;
    let heroImagePrompt = drafts.find((draft) => draft.section === 'market')?.imagePrompt ?? '';
    let heroImageAlt = drafts.find((draft) => draft.section === 'market')?.imageAlt ?? '';
    if (drafts.length > 0) {
      try {
        const edited = await editFrontPage({ dateLabel: date, drafts });
        editedDrafts = edited.drafts;
        heroImagePrompt = edited.heroImagePrompt || heroImagePrompt;
        heroImageAlt = edited.heroImageAlt || heroImageAlt;
      } catch (error) {
        if (isCreditsExhaustedError(error)) creditsExhausted = true;
        console.warn('[frontPage] editor pass failed; publishing writer drafts', error);
      }
    }

    const publishedAt = now.toISOString();
    for (const draft of editedDrafts) {
      const slug = sectionSlug(draft.section, now);
      const meta = draftMeta.get(draft.section);
      const sources = (meta?.packets ?? []).map((packet) => ({
        title: packet.title,
        url: packet.url,
        source: packet.source,
      }));

      let imageUrl: string | null = null;
      let imageAlt: string | null = null;
      if (draft.section === 'market' && imageEnabled) {
        const previousImageUrl = previous.market?.image_url ?? null;
        const image = await generateAndStoreImage({
          pathPrefix: slug,
          prompt: heroImagePrompt || draft.imagePrompt,
          alt: heroImageAlt || draft.imageAlt,
          fallbackSubject: `this Bitcoin market story: ${draft.headline}`,
        });
        if (image) {
          imageUrl = image.url;
          imageAlt = image.alt;
          await removeStoredImage(previousImageUrl, image.path);
        }
      }

      await upsertSectionArticle({
        slug,
        section: draft.section,
        draft,
        sources,
        publishedAt,
        imageUrl,
        imageAlt,
      });
      await recordSourceUsage(draft.section, slug, meta?.items ?? []);
      outcomes[draft.section] = {
        section: draft.section,
        status: 'published',
        reason: `Published "${draft.headline}" with ${sources.length} sources.`,
        slug,
        headline: draft.headline,
      };
    }

    const failedHard = NEWS_SECTIONS.some((section) => outcomes[section].status === 'failed');
    await finishRun(runId, failedHard ? 'failed' : 'finished', outcomes, failedHard ? summarizeFailures(outcomes) : null);
    await maybeAlert(outcomes, null, creditsExhausted, date);

    return {
      ok: !failedHard,
      date,
      runId,
      sections: outcomes,
      error: failedHard ? summarizeFailures(outcomes) : null,
      creditsExhausted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCreditsExhaustedError(error)) creditsExhausted = true;
    await finishRun(runId, 'failed', outcomes, message);
    await maybeAlert(outcomes, message, creditsExhausted, date);
    return {
      ok: false,
      date,
      runId,
      sections: outcomes,
      error: message,
      creditsExhausted,
    };
  }
}

const WIDENED_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const STALE_FALLBACK = 7;

function summarizeFailures(outcomes: Record<NewsSection, SectionOutcome>): string {
  return NEWS_SECTIONS
    .filter((section) => outcomes[section].status === 'failed')
    .map((section) => `${section}: ${outcomes[section].reason}`)
    .join('; ');
}

async function maybeAlert(
  outcomes: Record<NewsSection, SectionOutcome>,
  runError: string | null,
  creditsExhausted: boolean,
  date: string,
): Promise<void> {
  const marketFailed = outcomes.market.status === 'failed';
  const opinionFailed = outcomes.opinion.status === 'failed';
  if (!runError && !marketFailed && !opinionFailed && !creditsExhausted) return;

  const subject = creditsExhausted
    ? `CoinStrat news: OpenAI credits exhausted (${date})`
    : `CoinStrat news: front page failed (${date})`;
  const lines = [
    runError ? `Run error: ${runError}` : 'A required section failed to publish.',
    '',
    ...NEWS_SECTIONS.map((section) => {
      const row = outcomes[section];
      return `${section}: ${row.status} — ${row.reason}`;
    }),
  ];
  await sendNewsAlert(subject, lines.join('\n'));
}

