import { randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { signalsStore } from './store';
import { serviceSupabase } from './auth';

export type NewsletterIssueStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type NewsletterAudienceMode = 'all' | 'newsletter_only' | 'paid_only';

export interface CuratedLinkInput {
  id?: string;
  title: string;
  url: string;
  source: string;
  note?: string | null;
  sort_order?: number;
}

export interface NewsletterSettings {
  enabled: boolean;
  send_weekday: number;
  send_hour_utc: number;
  audience_mode: NewsletterAudienceMode;
  from_name: string;
  reply_to: string | null;
}

export interface NewsletterSection {
  title: string;
  body: string;
  bullets: string[];
}

export interface NewsletterDraft {
  subject: string;
  previewText: string;
  headline: string;
  summary: string;
  signalSections: NewsletterSection[];
  headlinesNarrative: string;
  curatedLinks: Array<CuratedLinkInput & { commentary?: string }>;
  cta: {
    label: string;
    href: string;
  };
  complianceFooter: string;
}

export interface NewsletterIssueRecord {
  id: string;
  slug: string;
  status: NewsletterIssueStatus;
  week_of: string;
  scheduled_for: string | null;
  sent_at: string | null;
  subject: string | null;
  preview_text: string | null;
  structured_context_json: WeeklyContext | Record<string, never>;
  draft_json: NewsletterDraft | Record<string, never>;
  html: string | null;
  text: string | null;
  editor_note: string | null;
  cta_label: string | null;
  cta_href: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  curated_links: CuratedLinkInput[];
  latest_send_log: NewsletterSendLog | null;
}

export interface NewsletterSendLog {
  id: string;
  issue_id: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  provider: string;
  provider_batch_id: string | null;
  delivery_mode: 'broadcast' | 'test';
  error_summary: string | null;
  sent_at: string;
}

export interface AutomaticNewsletterStatus {
  ok: true;
  skipped: boolean;
  wouldSend: boolean;
  reason: string;
  now: string;
  weekOf: string;
  scheduledFor: string | null;
  issueId: string | null;
  alreadySent: boolean;
}

export interface NewsletterSubscriptionPreference {
  email: string;
  subscribed: boolean;
  subscribedAt: string | null;
}

export interface WeeklyContext {
  weekOf: string;
  referenceDate: string;
  current: Record<string, number | string | null>;
  previousWeek: Record<string, number | string | null>;
  deltas: Record<string, number | null>;
  stateChanges: string[];
  highlights: string[];
}

interface NewsCandidate {
  title: string;
  url: string;
  source: string;
  summary: string;
  publishedAt: string | null;
}

interface ArticleExcerpt {
  url: string;
  excerpt: string;
}

interface NewsSourcePacket {
  title: string;
  source: string;
  url: string;
  excerpt: string;
}

interface ComposeIssueInput {
  actorId?: string | null;
  weekOf: string;
  editorNote?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
}

interface SendIssueInput {
  issue: NewsletterIssueRecord;
  settings: NewsletterSettings;
  mode: 'broadcast' | 'test';
  testRecipient?: string | null;
}

const resend = new Resend(process.env.RESEND_API_KEY);
const fromEmail = process.env.RESEND_FROM_EMAIL || 'digest@coinstrat.xyz';
const appUrl = process.env.VITE_APP_URL || 'https://coinstrat.xyz';
const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_NEWSLETTER_MODEL || process.env.OPENAI_NEWS_MODEL || 'gpt-4.1-mini';
const newsLookbackDays = Number(process.env.NEWS_LOOKBACK_DAYS || 7);

const NEWS_QUERIES = [
  `Bitcoin OR BTC (ETF OR treasury OR adoption OR mining OR regulation OR Lightning OR mempool OR macro) when:${newsLookbackDays}d`,
  `(Bitcoin OR BTC) (site:coindesk.com OR site:bitcoinmagazine.com OR site:cointelegraph.com OR site:decrypt.co) when:${newsLookbackDays}d`,
  `(bitcoin OR btc) (market OR treasury OR mining OR policy OR adoption OR lightning) when:${newsLookbackDays}d`,
];
const MAX_ENRICHED_STORIES = 4;
const ARTICLE_FETCH_TIMEOUT_MS = 3500;
const ARTICLE_EXCERPT_MAX_CHARS = 1800;
const PROMPT_EXCERPT_MAX_CHARS = 700;
const OPENAI_TIMEOUT_MS = 30000;

interface SignalRow {
  Date: string;
  BTCUSD?: number;
  BTC_MA200?: number;
  BTC_MA40W?: number;
  CORE_ON?: number;
  MACRO_ON?: number;
  ACCUM_ON?: number;
  PRICE_REGIME_ON?: number;
  VAL_SCORE?: number;
  LIQ_SCORE?: number;
  DXY_SCORE?: number;
  CYCLE_SCORE?: number;
  MVRV?: number;
  LTH_SOPR?: number;
  US_LIQ_YOY?: number;
  US_LIQ_13W_DELTA?: number;
  G3_YOY?: number;
  DXY?: number;
  SAHM?: number;
  YC_M?: number;
  NO_YOY?: number;
  SIP?: number;
  SIP_EUPHORIA_FLAG?: number;
  SIP_EXHAUSTED?: number;
  AB_SCORE?: number;
  ABCD_SCORE?: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(input?: string | Date): string {
  const date = typeof input === 'string'
    ? new Date(`${input}T00:00:00Z`)
    : input ?? new Date();

  const utcDay = date.getUTCDay();
  const delta = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() + delta);
  return isoDate(monday);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatNumber(value?: number | null, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
  });
}

function formatPercent(value?: number | null, digits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return `${value.toFixed(digits)}%`;
}

function formatDelta(value?: number | null, digits = 1, suffix = ''): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}${suffix}`;
}

function scoreLabel(value?: number): string {
  if (typeof value !== 'number') return 'n/a';
  if (value >= 2) return 'supportive';
  if (value === 1) return 'neutral';
  return 'headwind';
}

function signalStatusLabel(value?: number | string | null): string {
  return value === 1 ? 'ON' : 'OFF';
}

function dynamicCoreSentence(value?: number | string | null): string {
  return `Core Accumulation: ${signalStatusLabel(value)} — ${value === 1
    ? 'Long-term valuation and trend conditions still support steady accumulation.'
    : 'Accumulation is paused this week because the model does not have enough value-and-trend confirmation.'}`;
}

function dynamicMacroSentence(value?: number | string | null): string {
  return `Macro Accelerator: ${signalStatusLabel(value)} — ${value === 1
    ? 'Liquidity and macro conditions are supportive enough to justify a faster accumulation pace.'
    : 'The macro accelerator is on hold because liquidity, cycle, or dollar conditions are not supportive enough yet.'}`;
}

function dynamicValuationSentence(value?: number | string | null): string {
  switch (value) {
    case 3:
      return 'Valuation score: 3 — Bitcoin looks like extreme deep value, with both valuation and holder behavior pointing to capitulation.';
    case 2:
      return 'Valuation score: 2 — Bitcoin still looks attractively priced, with meaningful value support but not a full washout.';
    case 1:
      return 'Valuation score: 1 — Bitcoin looks broadly fair this week, but not yet in a deep-value zone.';
    case 0:
      return 'Valuation score: 0 — Bitcoin looks overheated relative to on-chain value, which argues for caution rather than fresh aggression.';
    default:
      return `Valuation score: ${value ?? 'n/a'} — Current valuation context is unavailable.`;
  }
}

function dynamicLiquiditySentence(value?: number | string | null): string {
  switch (value) {
    case 2:
      return 'Liquidity score: 2 — Liquidity is expanding and acting as a clear tailwind for risk assets.';
    case 1:
      return 'Liquidity score: 1 — Liquidity is improving at the margin, but the tailwind is still early rather than fully established.';
    case 0:
      return 'Liquidity score: 0 — Liquidity remains a headwind, so the backdrop is still tighter than ideal for aggressive accumulation.';
    default:
      return `Liquidity score: ${value ?? 'n/a'} — Current liquidity context is unavailable.`;
  }
}

function dynamicDollarSentence(value?: number | string | null): string {
  switch (value) {
    case 2:
      return 'Dollar score: 2 — The dollar is weakening enough to be a supportive backdrop for Bitcoin this week.';
    case 1:
      return 'Dollar score: 1 — The dollar is not a major obstacle right now, but it is not providing a strong tailwind either.';
    case 0:
      return 'Dollar score: 0 — Dollar conditions are still a headwind, which keeps overall risk conditions less supportive.';
    default:
      return `Dollar score: ${value ?? 'n/a'} — Current dollar-regime context is unavailable.`;
  }
}

function dynamicCycleSentence(value?: number | string | null): string {
  switch (value) {
    case 2:
      return 'Business Cycle score: 2 — The macro backdrop still looks expansionary, with growth conditions supportive of risk-taking.';
    case 1:
      return 'Business Cycle score: 1 — The economy looks mixed or stabilizing, so the backdrop is neither clearly bullish nor clearly recessionary.';
    case 0:
      return 'Business Cycle score: 0 — Recession-risk signals are elevated, which argues for a more defensive stance.';
    default:
      return `Business Cycle score: ${value ?? 'n/a'} — Current macro-cycle context is unavailable.`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function stripTags(value: string): string {
  const decoded = decodeXml(value);
  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeParagraphs(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);
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

async function fetchArticleExcerpt(candidate: NewsCandidate): Promise<ArticleExcerpt | null> {
  try {
    const response = await fetchWithTimeout(candidate.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'CoinStrat Newsletter Bot/1.0',
      },
    }, ARTICLE_FETCH_TIMEOUT_MS);

    if (!response.ok) return null;

    const html = await response.text();
    const finalUrl = response.url || candidate.url;
    const metaDescription = extractMetaContent(
      html,
      /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    );
    const paragraphs = extractArticleParagraphs(html);
    const excerpt = dedupeTextParts([metaDescription, ...paragraphs])
      .join(' ')
      .slice(0, ARTICLE_EXCERPT_MAX_CHARS);

    return excerpt ? { url: finalUrl, excerpt } : null;
  } catch {
    return null;
  }
}

function buildUnsubscribeUrl(email?: string | null): string {
  if (!email) return `${appUrl}/unsubscribe`;
  return `${appUrl}/unsubscribe?email=${encodeURIComponent(email)}`;
}

function buildNewsletterConfirmUrl(token: string): string {
  return `${appUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

function personalizeTemplate(value: string, email?: string | null): string {
  return value.replaceAll('__UNSUBSCRIBE_URL__', buildUnsubscribeUrl(email));
}

function fallbackHeadlinesNarrative(
  curatedLinks: CuratedLinkInput[],
  referenceDate: string,
): string {
  const topSources = Array.from(new Set(curatedLinks.map((link) => link.source).filter(Boolean))).slice(0, 3);
  const combinedContext = curatedLinks
    .map((link) => `${link.title} ${link.note ?? ''}`.toLowerCase())
    .join(' ');
  const themeSnippets: string[] = [];

  if (/etf|inflow|fund/i.test(combinedContext)) {
    themeSnippets.push('ETF demand and capital flows remain an important part of the market narrative');
  }
  if (/treasury|holdings|reserve|balance sheet|mining/i.test(combinedContext)) {
    themeSnippets.push('corporate and treasury-style Bitcoin accumulation is still shaping sentiment');
  }
  if (/fed|yield|macro|oil|rate|policy/i.test(combinedContext)) {
    themeSnippets.push('macro conditions remain tightly linked to short-term price direction');
  }
  if (/developer|lightning|open-source|adoption/i.test(combinedContext)) {
    themeSnippets.push('longer-term adoption and ecosystem investment continue in the background');
  }

  if (themeSnippets.length === 0) {
    return `This week’s headlines point to a familiar mix of Bitcoin market structure, institutional flows, and macro positioning as of ${referenceDate}.`;
  }

  const sourceText = topSources.length > 0
    ? `Across ${topSources.join(', ')}, the dominant themes this week were`
    : 'The dominant themes this week were';

  return `${sourceText} ${themeSnippets.join(', ')}. Taken together, the selected stories suggest that Bitcoin is still being driven by a blend of institutional positioning, balance-sheet adoption, and macro-sensitive risk appetite rather than by a single isolated catalyst. The backdrop still looks constructive, but it remains highly sensitive to liquidity, rates, and positioning shifts.`;
}

function buildSignupConfirmationEmail(email: string, token: string): { subject: string; html: string; text: string } {
  const confirmUrl = buildNewsletterConfirmUrl(token);
  const unsubscribeUrl = buildUnsubscribeUrl(email);

  const subject = 'Confirm your CoinStrat Weekly subscription';
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="margin:0;padding:0;background:#020617;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#020617;">
          <tr>
            <td align="center" style="padding:4px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:760px;border-collapse:separate;background:linear-gradient(135deg,#0b1220 0%,#111827 100%);border:1px solid #1e293b;border-radius:12px;">
                <tr>
                  <td style="padding:14px;color:#e2e8f0;">
                    <div style="margin-bottom:16px;">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#60a5fa;font-weight:800;">CoinStrat Weekly</div>
              <h1 style="margin:10px 0 8px;font-size:24px;line-height:1.2;color:#f8fafc;">Welcome to the Weekly Signal Report</h1>
              <p style="margin:0;color:#94a3b8;font-size:14px;">One click confirms your email address and activates your newsletter subscription.</p>
                    </div>

                    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px;margin-bottom:12px;">
              <p style="margin:0 0 12px;color:#cbd5e1;line-height:1.75;">
                Thanks for signing up for CoinStrat. Each week you will receive a concise read on the latest accumulation signal, macro and liquidity regime shifts, and the most relevant Bitcoin headlines behind the move.
              </p>
              <ul style="margin:0;padding-left:18px;color:#cbd5e1;line-height:1.7;">
                <li>The latest CoinStrat signal state and what changed during the week</li>
                <li>Key valuation, liquidity, dollar, and business-cycle context</li>
                <li>A short roundup of the most relevant Bitcoin market and industry developments</li>
              </ul>
                    </div>

                    <div style="text-align:center;margin:16px 0 8px;">
                      <a href="${escapeHtml(confirmUrl)}" style="display:block;background:#60a5fa;color:#08111f;padding:14px 16px;border-radius:10px;text-decoration:none;font-weight:800;">
                Confirm my email
              </a>
                    </div>

                    <p style="margin:16px 0 8px;color:#64748b;font-size:12px;line-height:1.6;text-align:center;">
              If you did not intend to subscribe, you can cancel below and your address will be removed from the newsletter list.
                    </p>
                    <p style="margin:0;color:#64748b;font-size:12px;text-align:center;">
              <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;">Cancel subscription</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const text = [
    'CoinStrat Weekly',
    '',
    'Welcome to the Weekly Signal Report.',
    'Confirm your email address to activate your newsletter subscription:',
    confirmUrl,
    '',
    'What to expect each week:',
    '- The latest CoinStrat signal state and what changed during the week',
    '- Key valuation, liquidity, dollar, and business-cycle context',
    '- A short roundup of the most relevant Bitcoin market and industry developments',
    '',
    'If you did not intend to subscribe, cancel here:',
    unsubscribeUrl,
  ].join('\n');

  return { subject, html, text };
}

function issueSlug(weekOf: string): string {
  return `newsletter-${weekOf}`;
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

function nextScheduledAt(settings: NewsletterSettings, weekOf: string): string | null {
  if (!settings.enabled) return null;
  const scheduled = new Date(`${weekOf}T00:00:00Z`);
  const daysFromMonday = settings.send_weekday === 0 ? 6 : settings.send_weekday - 1;
  scheduled.setUTCDate(scheduled.getUTCDate() + daysFromMonday);
  scheduled.setUTCHours(settings.send_hour_utc, 0, 0, 0);
  return scheduled.toISOString();
}

function latestRowOnOrBefore(rows: SignalRow[], date: string): SignalRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].Date <= date) return rows[i];
  }
  return rows.at(-1) ?? null;
}

function numericDelta(current?: number, previous?: number): number | null {
  if (typeof current !== 'number' || typeof previous !== 'number') return null;
  return current - previous;
}

export async function getNewsletterSettings(): Promise<NewsletterSettings> {
  let { data } = await serviceSupabase
    .from('newsletter_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle();

  if (!data) {
    const inserted = await serviceSupabase
      .from('newsletter_settings')
      .insert({ id: true })
      .select('*')
      .single();
    data = inserted.data ?? null;
  }

  return {
    enabled: data?.enabled ?? false,
    send_weekday: data?.send_weekday ?? 1,
    send_hour_utc: data?.send_hour_utc ?? 14,
    audience_mode: (data?.audience_mode ?? 'all') as NewsletterAudienceMode,
    from_name: data?.from_name ?? 'CoinStrat',
    reply_to: data?.reply_to ?? null,
  };
}

export async function updateNewsletterSettings(input: Partial<NewsletterSettings>) {
  const update = {
    id: true,
    ...input,
  };

  const { error } = await serviceSupabase
    .from('newsletter_settings')
    .upsert(update, { onConflict: 'id' });

  if (error) throw new Error(error.message);

  return getNewsletterSettings();
}

async function loadIssueLinks(issueId: string): Promise<CuratedLinkInput[]> {
  const { data, error } = await serviceSupabase
    .from('newsletter_curated_links')
    .select('id, title, url, source, note, sort_order')
    .eq('issue_id', issueId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CuratedLinkInput[];
}

function parseRssItems(xml: string): NewsCandidate[] {
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

async function fetchNewsCandidates(query: string): Promise<NewsCandidate[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'CoinStrat Newsletter Bot/1.0',
    },
  }, 4500);
  if (!response.ok) {
    throw new Error(`News RSS fetch failed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseRssItems(xml);
}

function buildNewsSourcePackets(curatedLinks: CuratedLinkInput[]): NewsSourcePacket[] {
  return curatedLinks
    .map((link) => ({
      title: link.title.trim(),
      source: link.source.trim() || 'Source',
      url: link.url.trim(),
      excerpt: normalizeWhitespace(link.note ?? '').slice(0, PROMPT_EXCERPT_MAX_CHARS),
    }))
    .filter((packet) => packet.title && packet.url && packet.excerpt.length >= 80)
    .slice(0, MAX_ENRICHED_STORIES);
}

function scoreNewsCandidate(candidate: NewsCandidate): number {
  const haystack = `${candidate.title} ${candidate.summary}`.toLowerCase();
  let score = 0;

  const bitcoinTerms = ['bitcoin', 'btc'];
  const highSignalTerms = [
    'etf', 'treasury', 'adoption', 'mining', 'regulation', 'policy',
    'lightning', 'macro', 'market', 'institution', 'custody', 'reserve',
  ];
  const lowSignalTerms = ['memecoin', 'nft', 'airdrop', 'dogecoin', 'solana'];
  const preferredSources = ['coindesk', 'bitcoin magazine', 'cointelegraph', 'decrypt', 'the block'];

  for (const term of bitcoinTerms) {
    if (haystack.includes(term)) score += 4;
  }
  for (const term of highSignalTerms) {
    if (haystack.includes(term)) score += 2;
  }
  for (const term of lowSignalTerms) {
    if (haystack.includes(term)) score -= 4;
  }
  if (preferredSources.some((source) => candidate.source.toLowerCase().includes(source))) {
    score += 2;
  }

  return score;
}

async function sourceWeeklyStories(
  context: WeeklyContext,
  existingLinks: CuratedLinkInput[],
): Promise<CuratedLinkInput[]> {
  try {
    const candidateResults = await Promise.allSettled(
      NEWS_QUERIES.map((query) => fetchNewsCandidates(query)),
    );

    const allCandidates = candidateResults.flatMap((result) => (
      result.status === 'fulfilled' ? result.value : []
    ));

    const deduped = new Map<string, NewsCandidate>();
    for (const candidate of allCandidates) {
      const key = candidate.url || candidate.title.toLowerCase();
      if (!deduped.has(key)) deduped.set(key, candidate);
    }

    const selected = Array.from(deduped.values())
      .sort((a, b) => scoreNewsCandidate(b) - scoreNewsCandidate(a))
      .slice(0, 8);

    const enrichedResults = await Promise.allSettled(
      selected.slice(0, MAX_ENRICHED_STORIES).map((candidate) => fetchArticleExcerpt(candidate)),
    );
    const enrichedByTitle = new Map<string, ArticleExcerpt>();

    enrichedResults.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const candidate = selected[index];
      if (!candidate) return;
      enrichedByTitle.set(candidate.title, result.value);
    });

    const mapped = selected.map((candidate, index) => {
      const enriched = enrichedByTitle.get(candidate.title);
      return {
        title: candidate.title,
        url: enriched?.url ?? candidate.url,
        source: candidate.source,
        note: enriched?.excerpt ?? candidate.summary ?? null,
        sort_order: index,
      };
    });

    return mapped.length > 0 ? mapped : existingLinks;
  } catch (error) {
    console.error('[newsletter/sourceWeeklyStories]', error);
    return existingLinks;
  }
}

async function loadLatestSendLog(issueId: string): Promise<NewsletterSendLog | null> {
  const { data, error } = await serviceSupabase
    .from('newsletter_send_logs')
    .select('*')
    .eq('issue_id', issueId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as NewsletterSendLog | null) ?? null;
}

function mapIssueRow(row: any, curatedLinks: CuratedLinkInput[], latestSendLog: NewsletterSendLog | null): NewsletterIssueRecord {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    week_of: row.week_of,
    scheduled_for: row.scheduled_for,
    sent_at: row.sent_at,
    subject: row.subject,
    preview_text: row.preview_text,
    structured_context_json: row.structured_context_json ?? {},
    draft_json: row.draft_json ?? {},
    html: row.html,
    text: row.text,
    editor_note: row.editor_note,
    cta_label: row.cta_label,
    cta_href: row.cta_href,
    llm_provider: row.llm_provider,
    llm_model: row.llm_model,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    curated_links: curatedLinks,
    latest_send_log: latestSendLog,
  };
}

export async function getIssueByWeek(weekOf: string): Promise<NewsletterIssueRecord | null> {
  const { data, error } = await serviceSupabase
    .from('newsletter_issues')
    .select('*')
    .eq('week_of', weekOf)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const [curatedLinks, latestSendLog] = await Promise.all([
    loadIssueLinks(data.id),
    loadLatestSendLog(data.id),
  ]);

  return mapIssueRow(data, curatedLinks, latestSendLog);
}

export async function getIssueById(issueId: string): Promise<NewsletterIssueRecord | null> {
  const { data, error } = await serviceSupabase
    .from('newsletter_issues')
    .select('*')
    .eq('id', issueId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const [curatedLinks, latestSendLog] = await Promise.all([
    loadIssueLinks(data.id),
    loadLatestSendLog(data.id),
  ]);

  return mapIssueRow(data, curatedLinks, latestSendLog);
}

export async function listRecentIssues(limit = 8): Promise<NewsletterIssueRecord[]> {
  const { data, error } = await serviceSupabase
    .from('newsletter_issues')
    .select('*')
    .order('week_of', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const issueIds = rows.map((row) => row.id);

  const [linksResult, logsResult] = await Promise.all([
    issueIds.length === 0
      ? Promise.resolve([])
      : serviceSupabase
        .from('newsletter_curated_links')
        .select('id, issue_id, title, url, source, note, sort_order')
        .in('issue_id', issueIds)
        .order('sort_order', { ascending: true })
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data ?? [];
        }),
    issueIds.length === 0
      ? Promise.resolve([])
      : serviceSupabase
        .from('newsletter_send_logs')
        .select('*')
        .in('issue_id', issueIds)
        .order('sent_at', { ascending: false })
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data ?? [];
        }),
  ]);

  const linksByIssue = new Map<string, CuratedLinkInput[]>();
  for (const link of linksResult as any[]) {
    const list = linksByIssue.get(link.issue_id) ?? [];
    list.push(link as CuratedLinkInput);
    linksByIssue.set(link.issue_id, list);
  }

  const latestLogByIssue = new Map<string, NewsletterSendLog>();
  for (const log of logsResult as NewsletterSendLog[]) {
    if (!latestLogByIssue.has(log.issue_id)) {
      latestLogByIssue.set(log.issue_id, log);
    }
  }

  return rows.map((row) => mapIssueRow(
    row,
    linksByIssue.get(row.id) ?? [],
    latestLogByIssue.get(row.id) ?? null,
  ));
}

export async function getRecipientCount(mode: NewsletterAudienceMode): Promise<number> {
  const recipients = await collectRecipients(mode);
  return recipients.length;
}

async function saveCuratedLinks(issueId: string, curatedLinks: CuratedLinkInput[]) {
  const { error: deleteError } = await serviceSupabase
    .from('newsletter_curated_links')
    .delete()
    .eq('issue_id', issueId);

  if (deleteError) throw new Error(deleteError.message);

  const validLinks = curatedLinks
    .map((link, index) => ({
      issue_id: issueId,
      title: link.title.trim(),
      url: link.url.trim(),
      source: link.source.trim() || 'Source',
      note: link.note?.trim() || null,
      sort_order: link.sort_order ?? index,
    }))
    .filter((link) => link.title && link.url);

  if (validLinks.length === 0) return;

  const { error: insertError } = await serviceSupabase
    .from('newsletter_curated_links')
    .insert(validLinks);

  if (insertError) throw new Error(insertError.message);
}

async function loadSignals(): Promise<SignalRow[]> {
  const store = signalsStore();
  const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;
  const data = (cached?.data ?? []) as SignalRow[];
  if (data.length === 0) {
    throw new Error('Signal cache not yet populated.');
  }
  return data;
}

async function fetchSeriesValueOnOrBefore(file: string, date: string): Promise<number | null> {
  try {
    const response = await fetch(`https://charts.bgeometrics.com/files/${file}.json`);
    if (!response.ok) return null;

    const rows = await response.json() as [number, number | null][];
    let lastValue: number | null = null;

    for (const [timestamp, value] of rows) {
      if (value == null || !Number.isFinite(value)) continue;
      const rowDate = new Date(timestamp).toISOString().slice(0, 10);
      if (rowDate <= date) {
        lastValue = value;
      } else {
        break;
      }
    }

    return lastValue;
  } catch {
    return null;
  }
}

export async function buildWeeklyContext(weekOf: string): Promise<WeeklyContext> {
  const rows = await loadSignals();
  const endOfIssueWindow = addDays(weekOf, 6);
  const currentRow = latestRowOnOrBefore(rows, endOfIssueWindow);
  if (!currentRow) {
    throw new Error('No signal data available for newsletter context.');
  }

  const previousRow = latestRowOnOrBefore(rows, addDays(currentRow.Date, -7));
  const current = currentRow;
  const previous = previousRow ?? {};
  const [currentLthSopr, previousLthSopr] = await Promise.all([
    typeof current.LTH_SOPR === 'number'
      ? Promise.resolve(current.LTH_SOPR)
      : fetchSeriesValueOnOrBefore('lth_sopr', current.Date),
    typeof previousRow?.LTH_SOPR === 'number'
      ? Promise.resolve(previousRow.LTH_SOPR)
      : previousRow?.Date
        ? fetchSeriesValueOnOrBefore('lth_sopr', previousRow.Date)
        : Promise.resolve(null),
  ]);

  const stateChanges: string[] = [];
  if (current.CORE_ON !== previousRow?.CORE_ON) {
    stateChanges.push(`CORE switched ${current.CORE_ON === 1 ? 'ON' : 'OFF'} this week.`);
  }
  if (current.MACRO_ON !== previousRow?.MACRO_ON) {
    stateChanges.push(`MACRO switched ${current.MACRO_ON === 1 ? 'ON' : 'OFF'} this week.`);
  }
  if (current.PRICE_REGIME_ON !== previousRow?.PRICE_REGIME_ON) {
    stateChanges.push(`Price regime turned ${current.PRICE_REGIME_ON === 1 ? 'supportive' : 'cautious'}.`);
  }
  if (current.SIP_EXHAUSTED === 1 && previousRow?.SIP_EXHAUSTED !== 1) {
    stateChanges.push('Supply-in-profit exhaustion was triggered.');
  }

  const highlights = [
    `BTC closed the week at ${formatCurrency(current.BTCUSD)} (${formatDelta(numericDelta(current.BTCUSD, previousRow?.BTCUSD), 0)} vs. last week).`,
    `Liquidity score is ${current.LIQ_SCORE ?? 'n/a'} (${scoreLabel(current.LIQ_SCORE)}).`,
    `Valuation score is ${current.VAL_SCORE ?? 'n/a'} with NUPL at ${formatNumber((current as any).NUPL, 3)} (MVRV: ${formatNumber(current.MVRV)}).`,
    `Dollar regime score is ${current.DXY_SCORE ?? 'n/a'} and cycle score is ${current.CYCLE_SCORE ?? 'n/a'}.`,
  ];

  return {
    weekOf,
    referenceDate: current.Date,
    current: {
      Date: current.Date,
      BTCUSD: current.BTCUSD ?? null,
      CORE_ON: current.CORE_ON ?? null,
      MACRO_ON: current.MACRO_ON ?? null,
      ACCUM_ON: current.ACCUM_ON ?? null,
      PRICE_REGIME_ON: current.PRICE_REGIME_ON ?? null,
      BTC_MA200: current.BTC_MA200 ?? null,
      BTC_MA40W: current.BTC_MA40W ?? null,
      VAL_SCORE: current.VAL_SCORE ?? null,
      LIQ_SCORE: current.LIQ_SCORE ?? null,
      DXY_SCORE: current.DXY_SCORE ?? null,
      CYCLE_SCORE: current.CYCLE_SCORE ?? null,
      MVRV: current.MVRV ?? null,
      LTH_SOPR: currentLthSopr,
      DXY: current.DXY ?? null,
      SAHM: current.SAHM ?? null,
      YC_M: current.YC_M ?? null,
      NO_YOY: current.NO_YOY ?? null,
      US_LIQ_YOY: current.US_LIQ_YOY ?? null,
      US_LIQ_13W_DELTA: current.US_LIQ_13W_DELTA ?? null,
      G3_YOY: current.G3_YOY ?? null,
      SIP: current.SIP ?? null,
      SIP_EUPHORIA_FLAG: current.SIP_EUPHORIA_FLAG ?? null,
      SIP_EXHAUSTED: current.SIP_EXHAUSTED ?? null,
    },
    previousWeek: {
      Date: previousRow?.Date ?? null,
      BTCUSD: previousRow?.BTCUSD ?? null,
      CORE_ON: previousRow?.CORE_ON ?? null,
      MACRO_ON: previousRow?.MACRO_ON ?? null,
      ACCUM_ON: previousRow?.ACCUM_ON ?? null,
      PRICE_REGIME_ON: previousRow?.PRICE_REGIME_ON ?? null,
      VAL_SCORE: previousRow?.VAL_SCORE ?? null,
      LIQ_SCORE: previousRow?.LIQ_SCORE ?? null,
      DXY_SCORE: previousRow?.DXY_SCORE ?? null,
      CYCLE_SCORE: previousRow?.CYCLE_SCORE ?? null,
      MVRV: previousRow?.MVRV ?? null,
      LTH_SOPR: previousLthSopr,
      SIP: previousRow?.SIP ?? null,
      BTC_MA40W: previousRow?.BTC_MA40W ?? null,
      US_LIQ_YOY: previousRow?.US_LIQ_YOY ?? null,
      G3_YOY: previousRow?.G3_YOY ?? null,
    },
    deltas: {
      BTCUSD: numericDelta(current.BTCUSD, previousRow?.BTCUSD),
      VAL_SCORE: numericDelta(current.VAL_SCORE, previousRow?.VAL_SCORE),
      LIQ_SCORE: numericDelta(current.LIQ_SCORE, previousRow?.LIQ_SCORE),
      DXY_SCORE: numericDelta(current.DXY_SCORE, previousRow?.DXY_SCORE),
      CYCLE_SCORE: numericDelta(current.CYCLE_SCORE, previousRow?.CYCLE_SCORE),
      MVRV: numericDelta(current.MVRV, previousRow?.MVRV),
      LTH_SOPR: numericDelta(currentLthSopr ?? undefined, previousLthSopr ?? undefined),
      SIP: numericDelta(current.SIP, previousRow?.SIP),
      BTC_MA40W: numericDelta(current.BTC_MA40W, previousRow?.BTC_MA40W),
      US_LIQ_YOY: numericDelta(current.US_LIQ_YOY, previousRow?.US_LIQ_YOY),
      G3_YOY: numericDelta(current.G3_YOY, previousRow?.G3_YOY),
    },
    stateChanges,
    highlights,
  };
}

function fallbackDraft(
  context: WeeklyContext,
  curatedLinks: CuratedLinkInput[],
  editorNote: string | null,
  ctaLabel: string | null,
  ctaHref: string | null,
): NewsletterDraft {
  const current = context.current;
  const coreStatus = current.CORE_ON === 1 ? 'ON' : 'OFF';
  const macroStatus = current.MACRO_ON === 1 ? 'ON' : 'OFF';
  const changedThisWeek = [
    `MVRV: ${formatNumber(current.MVRV as number | null)} (${formatDelta(context.deltas.MVRV, 2)} vs. last week)`,
    `LTH SOPR: ${formatNumber(current.LTH_SOPR as number | null, 3)} (${formatDelta(context.deltas.LTH_SOPR, 3)} vs. last week)`,
    `Supply in Profit: ${formatPercent(current.SIP as number | null)} (${formatDelta(context.deltas.SIP, 1, ' pts')} vs. last week)`,
    `40-week SMA: ${formatCurrency(current.BTC_MA40W as number | null)} (${formatDelta(context.deltas.BTC_MA40W, 0)} vs. last week)`,
  ];
  const stableState = [
    dynamicCoreSentence(current.CORE_ON),
    dynamicMacroSentence(current.MACRO_ON),
    dynamicValuationSentence(current.VAL_SCORE),
    dynamicLiquiditySentence(current.LIQ_SCORE),
    dynamicDollarSentence(current.DXY_SCORE),
    dynamicCycleSentence(current.CYCLE_SCORE),
  ];
  const headlinesNarrative = fallbackHeadlinesNarrative(curatedLinks, context.referenceDate);

  return {
    subject: `CoinStrat Weekly — CORE ${coreStatus} | BTC ${formatCurrency(current.BTCUSD as number | null)}`,
    previewText: `Weekly signal snapshot for ${context.referenceDate}: CORE ${coreStatus}, MACRO ${macroStatus}, BTC ${formatCurrency(current.BTCUSD as number | null)}.`,
    headline: `Weekly signal check-in: CORE ${coreStatus}, MACRO ${macroStatus}`,
    summary: `CoinStrat closes the week with BTC at ${formatCurrency(current.BTCUSD as number | null)}. The model is reading valuation as ${scoreLabel(current.VAL_SCORE as number | undefined)}, liquidity as ${scoreLabel(current.LIQ_SCORE as number | undefined)}, and the macro backdrop as ${scoreLabel(current.CYCLE_SCORE as number | undefined)}.`,
    signalSections: [
      {
        title: 'What changed this week',
        body: `BTC finished the week at ${formatCurrency(current.BTCUSD as number | null)}. The most useful week-over-week changes are in valuation, trend, and on-chain positioning rather than in the headline regime signals.`,
        bullets: changedThisWeek,
      },
      {
        title: 'What did not change',
        body: `The model’s higher-level posture is still being driven by the same broad mix of valuation, liquidity, dollar, and business-cycle inputs.`,
        bullets: stableState,
      },
      {
        title: 'Why It Matters',
        body: editorNote?.trim() || 'This week’s read is best used as a portfolio sizing and pacing signal, not a short-term price prediction. Watch for changes in valuation, LTH SOPR, supply in profit, and the 40-week trend line to see whether the regime is strengthening or deteriorating.',
        bullets: [
          ...context.highlights,
          ...(context.stateChanges.length > 0 ? context.stateChanges : []),
        ],
      },
    ],
    headlinesNarrative,
    curatedLinks: curatedLinks.map((link) => ({
      ...link,
      commentary: link.note?.trim() || 'Relevant Bitcoin context selected for this week’s digest.',
    })),
    cta: {
      label: ctaLabel?.trim() || 'Open Dashboard',
      href: ctaHref?.trim() || `${appUrl}/dashboard`,
    },
    complianceFooter: 'You are receiving this because you subscribed to CoinStrat updates. This email is informational and not investment advice.',
  };
}

function normalizeDraft(raw: any, fallback: NewsletterDraft): NewsletterDraft {
  const signalSections = Array.isArray(raw?.signalSections)
    ? raw.signalSections
      .map((section: any) => ({
        title: typeof section?.title === 'string' && section.title.trim() ? section.title.trim() : 'Section',
        body: typeof section?.body === 'string' && section.body.trim() ? section.body.trim() : '',
        bullets: Array.isArray(section?.bullets)
          ? section.bullets.filter((bullet: unknown) => typeof bullet === 'string' && bullet.trim())
          : [],
      }))
      .filter((section: NewsletterSection) => section.body || section.bullets.length > 0)
    : fallback.signalSections;

  const curatedLinks = Array.isArray(raw?.curatedLinks)
    ? raw.curatedLinks
      .map((link: any, index: number) => ({
        title: typeof link?.title === 'string' && link.title.trim() ? link.title.trim() : fallback.curatedLinks[index]?.title ?? 'Link',
        url: typeof link?.url === 'string' && link.url.trim() ? link.url.trim() : fallback.curatedLinks[index]?.url ?? appUrl,
        source: typeof link?.source === 'string' && link.source.trim() ? link.source.trim() : fallback.curatedLinks[index]?.source ?? 'Source',
        note: typeof link?.note === 'string' ? link.note.trim() : fallback.curatedLinks[index]?.note ?? null,
        commentary: typeof link?.commentary === 'string' && link.commentary.trim()
          ? link.commentary.trim()
          : fallback.curatedLinks[index]?.commentary ?? 'Relevant additional context for this week.',
      }))
    : fallback.curatedLinks;

  return {
    subject: typeof raw?.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : fallback.subject,
    previewText: typeof raw?.previewText === 'string' && raw.previewText.trim()
      ? raw.previewText.trim()
      : fallback.previewText,
    headline: typeof raw?.headline === 'string' && raw.headline.trim() ? raw.headline.trim() : fallback.headline,
    summary: typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : fallback.summary,
    headlinesNarrative: typeof raw?.headlinesNarrative === 'string' && raw.headlinesNarrative.trim()
      ? raw.headlinesNarrative.trim()
      : fallback.headlinesNarrative,
    signalSections: signalSections.length > 0 ? signalSections : fallback.signalSections,
    curatedLinks,
    cta: {
      label: typeof raw?.cta?.label === 'string' && raw.cta.label.trim()
        ? raw.cta.label.trim()
        : fallback.cta.label,
      href: typeof raw?.cta?.href === 'string' && raw.cta.href.trim()
        ? raw.cta.href.trim()
        : fallback.cta.href,
    },
    complianceFooter: typeof raw?.complianceFooter === 'string' && raw.complianceFooter.trim()
      ? raw.complianceFooter.trim()
      : fallback.complianceFooter,
  };
}

async function generateNewsletterDraft(
  context: WeeklyContext,
  curatedLinks: CuratedLinkInput[],
  editorNote: string | null,
  ctaLabel: string | null,
  ctaHref: string | null,
): Promise<{ draft: NewsletterDraft; provider: string; model: string }> {
  const fallback = fallbackDraft(context, curatedLinks, editorNote, ctaLabel, ctaHref);
  const newsSourcePackets = buildNewsSourcePackets(curatedLinks);

  if (!openAiApiKey) {
    throw new Error('Newsletter generation failed: OPENAI_API_KEY is not configured.');
  }

  if (newsSourcePackets.length === 0) {
    throw new Error('Newsletter generation failed: no article excerpts were available for the selected headlines.');
  }

  const payload = {
    model: openAiModel,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are writing only the Weekly Bitcoin Headlines section of the CoinStrat newsletter. You will receive a small set of article source packets containing title, source, url, and cleaned excerpts. Use those excerpts to write a compelling, engaging and specific market narrative that stitches the stories together. Focus on actual developments, firms, events, macro drivers, and risks mentioned in the excerpts. Avoid generic crypto-market boilerplate. Do not repeat the headlines verbatim and do not output a list of headlines. Return valid JSON with exactly these keys: `headlinesNarrative` and `curatedLinks`. `headlinesNarrative` must be 160-240 words split into 2 or 3 short paragraphs separated by blank lines. `curatedLinks` must be an array in the same order as the supplied links, where each item has `url` and `commentary`. Each `commentary` must be one short sentence explaining why that link mattered this week.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          brandVoice: 'Concise analytical newsletter for bitcoin accumulators. Professional, calm, persuasive, and specific. Avoid hype.',
          weekOf: context.weekOf,
          referenceDate: context.referenceDate,
          currentMarket: {
            BTCUSD: context.current.BTCUSD,
            VAL_SCORE: context.current.VAL_SCORE,
            LIQ_SCORE: context.current.LIQ_SCORE,
            CYCLE_SCORE: context.current.CYCLE_SCORE,
            DXY_SCORE: context.current.DXY_SCORE,
            CORE_ON: context.current.CORE_ON,
            MACRO_ON: context.current.MACRO_ON,
          },
          highlights: context.highlights.slice(0, 4),
          links: curatedLinks.map((link) => ({
            title: link.title,
            source: link.source,
            url: link.url,
          })),
          newsSourcePackets,
        }),
      },
    ],
  };

  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(payload),
    }, OPENAI_TIMEOUT_MS);

    if (!response.ok) {
      const bodyText = await response.text();
      const compactBody = normalizeWhitespace(bodyText).slice(0, 400);
      throw new Error(
        `Newsletter generation failed: OpenAI HTTP ${response.status}${compactBody ? ` - ${compactBody}` : ''}`,
      );
    }

    const json = await response.json() as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Newsletter generation failed: OpenAI returned an empty draft.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(
        `Newsletter generation failed: OpenAI returned invalid JSON - ${normalizeWhitespace(content).slice(0, 400)}`,
      );
    }

    const headlinesNarrative = typeof (parsed as any)?.headlinesNarrative === 'string'
      ? (parsed as any).headlinesNarrative.trim()
      : '';

    if (!headlinesNarrative) {
      throw new Error('Newsletter generation failed: OpenAI response did not include `headlinesNarrative`.');
    }

    const commentaryByUrl = new Map<string, string>();
    if (Array.isArray((parsed as any)?.curatedLinks)) {
      for (const link of (parsed as any).curatedLinks) {
        if (typeof link?.url !== 'string') continue;
        const commentary = typeof link?.commentary === 'string' ? link.commentary.trim() : '';
        if (commentary) commentaryByUrl.set(link.url.trim(), commentary);
      }
    }

    return {
      draft: {
        ...fallback,
        headlinesNarrative,
        curatedLinks: fallback.curatedLinks.map((link) => ({
          ...link,
          commentary: commentaryByUrl.get(link.url) ?? link.commentary,
        })),
      },
      provider: 'openai',
      model: openAiModel,
    };
  } catch (error) {
    console.error('[newsletter/openai]', error);
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Newsletter generation failed: OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms using model ${openAiModel}.`);
      }
      throw error;
    }
    throw new Error('Newsletter generation failed: unknown OpenAI error.');
  }
}

function renderNewsletterContent(issue: {
  weekOf: string;
  referenceDate: string;
  draft: NewsletterDraft;
}): { html: string; text: string } {
  const headlinesParagraphs = normalizeParagraphs(issue.draft.headlinesNarrative);
  const sectionsHtml = issue.draft.signalSections.map((section) => `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px;margin-bottom:14px;">
      <h2 style="margin:0 0 10px;font-size:16px;color:#f8fafc;">${escapeHtml(section.title)}</h2>
      <p style="margin:0 0 12px;color:#cbd5e1;line-height:1.7;">${escapeHtml(section.body)}</p>
      ${section.bullets.length > 0 ? `
        <ul style="margin:0;padding-left:18px;color:#cbd5e1;">
          ${section.bullets.map((bullet) => `<li style="margin:0 0 8px;">${escapeHtml(bullet)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `).join('');

  const curatedLinksHtml = issue.draft.curatedLinks.length > 0
    ? `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px;margin-bottom:14px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#f8fafc;">Weekly Bitcoin Headlines</h2>
        ${headlinesParagraphs.length > 0
          ? headlinesParagraphs.map((paragraph, index) => `<p style="margin:0 0 ${index === headlinesParagraphs.length - 1 ? 16 : 12}px;color:#cbd5e1;line-height:1.75;">${escapeHtml(paragraph)}</p>`).join('')
          : ''}
        ${issue.draft.curatedLinks.map((link) => `
          <div style="margin-bottom:14px;">
            <a href="${escapeHtml(link.url)}" style="color:#93c5fd;font-weight:700;text-decoration:none;">${escapeHtml(link.title)}</a>
            <div style="color:#94a3b8;font-size:12px;margin-top:2px;">${escapeHtml(link.source)}</div>
          </div>
        `).join('')}
      </div>
    `
    : '';

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="margin:0;padding:0;background:#020617;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#020617;">
          <tr>
            <td align="center" style="padding:4px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:760px;border-collapse:separate;background:linear-gradient(135deg,#0b1220 0%,#111827 100%);border:1px solid #1e293b;border-radius:12px;">
                <tr>
                  <td style="padding:14px;color:#e2e8f0;">
                    <div style="margin-bottom:16px;">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#60a5fa;font-weight:800;">CoinStrat Weekly</div>
              <h1 style="margin:10px 0 8px;font-size:24px;line-height:1.2;color:#f8fafc;">${escapeHtml(issue.draft.headline)}</h1>
              <p style="margin:0;color:#94a3b8;font-size:14px;">Week of ${escapeHtml(issue.weekOf)} · data through ${escapeHtml(issue.referenceDate)}</p>
                    </div>

                    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px;margin-bottom:12px;">
              <p style="margin:0;color:#cbd5e1;line-height:1.75;">${escapeHtml(issue.draft.summary)}</p>
                    </div>

                    ${sectionsHtml}
                    ${curatedLinksHtml}

                    <div style="text-align:center;margin:16px 0 8px;">
                      <a href="${escapeHtml(issue.draft.cta.href)}" style="display:block;background:#60a5fa;color:#08111f;padding:14px 16px;border-radius:10px;text-decoration:none;font-weight:800;">
                ${escapeHtml(issue.draft.cta.label)}
              </a>
                    </div>

                    <p style="margin:16px 0 8px;color:#64748b;font-size:12px;line-height:1.6;text-align:center;">
              ${escapeHtml(issue.draft.complianceFooter)}
                    </p>
                    <p style="margin:0;color:#64748b;font-size:12px;text-align:center;">
              <a href="__UNSUBSCRIBE_URL__" style="color:#94a3b8;">Unsubscribe</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const lines = [
    'CoinStrat Weekly',
    `Week of ${issue.weekOf} · data through ${issue.referenceDate}`,
    '',
    issue.draft.headline,
    issue.draft.summary,
    '',
    ...issue.draft.signalSections.flatMap((section) => [
      section.title,
      section.body,
      ...section.bullets.map((bullet) => `- ${bullet}`),
      '',
    ]),
    ...(issue.draft.curatedLinks.length > 0
      ? [
        'Weekly Bitcoin Headlines',
        ...headlinesParagraphs.flatMap((paragraph) => [paragraph, '']),
        '',
        ...issue.draft.curatedLinks.flatMap((link) => [
          `${link.title} (${link.source})`,
          link.url,
          '',
        ]),
      ]
      : []),
    `Open Dashboard: ${issue.draft.cta.href}`,
    '',
    issue.draft.complianceFooter,
    `Unsubscribe: __UNSUBSCRIBE_URL__`,
  ];

  return {
    html,
    text: lines.join('\n'),
  };
}

export async function composeNewsletterIssue(input: ComposeIssueInput): Promise<NewsletterIssueRecord> {
  const settings = await getNewsletterSettings();
  const weekOf = mondayOf(input.weekOf);
  const existing = await getIssueByWeek(weekOf);

  const basePayload = {
    slug: existing?.slug ?? issueSlug(weekOf),
    week_of: weekOf,
    editor_note: input.editorNote?.trim() || null,
    cta_label: input.ctaLabel?.trim() || null,
    cta_href: input.ctaHref?.trim() || null,
    updated_by: input.actorId ?? null,
    created_by: existing?.created_by ?? input.actorId ?? null,
  };

  let issueId = existing?.id ?? null;

  if (!issueId) {
    const { data, error } = await serviceSupabase
      .from('newsletter_issues')
      .insert(basePayload)
      .select('*')
      .single();

    if (error || !data) throw new Error(error?.message ?? 'Failed to create newsletter issue.');
    issueId = data.id;
  } else {
    const { error } = await serviceSupabase
      .from('newsletter_issues')
      .update(basePayload)
      .eq('id', issueId);

    if (error) throw new Error(error.message);
  }

  if (!issueId) {
    throw new Error('Failed to resolve newsletter issue id.');
  }

  const context = await buildWeeklyContext(weekOf);
  const sourcedLinks = await sourceWeeklyStories(context, existing?.curated_links ?? []);
  await saveCuratedLinks(issueId, sourcedLinks);
  const curatedLinks = await loadIssueLinks(issueId);

  const generation = await generateNewsletterDraft(
    context,
    curatedLinks,
    input.editorNote?.trim() || null,
    input.ctaLabel?.trim() || null,
    input.ctaHref?.trim() || null,
  );

  const rendered = renderNewsletterContent({
    weekOf,
    referenceDate: context.referenceDate,
    draft: generation.draft,
  });

  const status: NewsletterIssueStatus = existing?.sent_at
    ? 'sent'
    : settings.enabled
      ? 'scheduled'
      : 'draft';

  const { error: updateError } = await serviceSupabase
    .from('newsletter_issues')
    .update({
      status,
      subject: generation.draft.subject,
      preview_text: generation.draft.previewText,
      structured_context_json: context,
      draft_json: generation.draft,
      html: rendered.html,
      text: rendered.text,
      scheduled_for: nextScheduledAt(settings, weekOf),
      llm_provider: generation.provider,
      llm_model: generation.model,
      updated_by: input.actorId ?? null,
    })
    .eq('id', issueId);

  if (updateError) throw new Error(updateError.message);

  const issue = await getIssueById(issueId);
  if (!issue) throw new Error('Failed to load composed newsletter issue.');
  return issue;
}

async function collectRecipients(mode: NewsletterAudienceMode): Promise<string[]> {
  const [{ data: profiles, error: profilesError }, { data: subscribers, error: subscribersError }, { data: suppressions, error: suppressionsError }] = await Promise.all([
    serviceSupabase
      .from('profiles')
      .select('email, tier'),
    serviceSupabase
      .from('email_subscribers')
      .select('email')
      .not('confirmed_at', 'is', null)
      .is('unsubscribed_at', null),
    serviceSupabase
      .from('newsletter_suppressions')
      .select('email'),
  ]);

  if (profilesError) throw new Error(profilesError.message);
  if (subscribersError) throw new Error(subscribersError.message);
  if (suppressionsError) throw new Error(suppressionsError.message);

  const suppressed = new Set((suppressions ?? []).map((row) => normalizeEmail(row.email)));
  const recipients = new Set<string>();

  switch (mode) {
    case 'all':
      for (const profile of profiles ?? []) {
        if (profile.email) recipients.add(normalizeEmail(profile.email));
      }
      for (const subscriber of subscribers ?? []) {
        if (subscriber.email) recipients.add(normalizeEmail(subscriber.email));
      }
      break;
    case 'newsletter_only':
      for (const subscriber of subscribers ?? []) {
        if (subscriber.email) recipients.add(normalizeEmail(subscriber.email));
      }
      break;
    case 'paid_only':
      for (const profile of profiles ?? []) {
        if (!profile.email) continue;
        if (profile.tier === 'pro' || profile.tier === 'pro_plus' || profile.tier === 'lifetime') {
          recipients.add(normalizeEmail(profile.email));
        }
      }
      break;
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unhandled audience mode: ${exhaustive}`);
    }
  }

  return Array.from(recipients).filter((email) => !suppressed.has(email));
}

function formatFromAddress(settings: NewsletterSettings): string {
  if (fromEmail.includes('<')) return fromEmail;
  return `${settings.from_name} <${fromEmail}>`;
}

export async function sendNewsletterIssue(input: SendIssueInput) {
  const issue = input.issue;
  const deliveryMode = input.mode;

  const recipients = input.mode === 'test'
    ? [normalizeEmail(input.testRecipient ?? '')].filter(Boolean)
    : await collectRecipients(input.settings.audience_mode);

  if (recipients.length === 0) {
    await serviceSupabase.from('newsletter_send_logs').insert({
      issue_id: issue.id,
      recipient_count: 0,
      sent_count: 0,
      failed_count: 0,
      provider: 'resend',
      delivery_mode: deliveryMode,
      error_summary: 'No recipients matched the selected audience.',
    });
    return { sent: 0, total: 0, failed: 0 };
  }

  if (!issue.subject || !issue.html || !issue.text) {
    throw new Error('Issue has not been composed yet.');
  }

  if (input.mode === 'broadcast') {
    const { error } = await serviceSupabase
      .from('newsletter_issues')
      .update({ status: 'sending' })
      .eq('id', issue.id);
    if (error) throw new Error(error.message);
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < recipients.length; i += 25) {
    const batch = recipients.slice(i, i + 25);
    const results = await Promise.allSettled(
      batch.map((email) => resend.emails.send({
        from: formatFromAddress(input.settings),
        to: email,
        replyTo: input.settings.reply_to?.trim() || undefined,
        subject: issue.subject!,
        html: personalizeTemplate(issue.html!, email),
        text: personalizeTemplate(issue.text!, email),
      })),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sent += 1;
      } else {
        failed += 1;
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }
  }

  const { error: logError } = await serviceSupabase
    .from('newsletter_send_logs')
    .insert({
      issue_id: issue.id,
      recipient_count: recipients.length,
      sent_count: sent,
      failed_count: failed,
      provider: 'resend',
      delivery_mode: deliveryMode,
      error_summary: errors.length > 0 ? errors.slice(0, 3).join(' | ') : null,
    });

  if (logError) throw new Error(logError.message);

  if (input.mode === 'broadcast') {
    const nextStatus: NewsletterIssueStatus = failed > 0 && sent === 0 ? 'failed' : 'sent';
    const { error: updateError } = await serviceSupabase
      .from('newsletter_issues')
      .update({
        status: nextStatus,
        sent_at: sent > 0 ? new Date().toISOString() : null,
      })
      .eq('id', issue.id);

    if (updateError) throw new Error(updateError.message);
  }

  return {
    sent,
    total: recipients.length,
    failed,
  };
}

export async function getNewsletterDashboardData(weekOf?: string) {
  const selectedWeek = mondayOf(weekOf);
  const [settings, issue, recentIssues] = await Promise.all([
    getNewsletterSettings(),
    getIssueByWeek(selectedWeek),
    listRecentIssues(),
  ]);

  const recipientCount = await getRecipientCount(settings.audience_mode);

  return {
    selectedWeek,
    settings,
    issue,
    recentIssues,
    recipientCount,
  };
}

export async function requestNewsletterSubscription(email: string, source?: string | null): Promise<'pending_confirmation' | 'already_subscribed'> {
  const normalized = normalizeEmail(email);
  const token = randomBytes(24).toString('hex');
  const now = new Date().toISOString();

  const { data: existing, error: existingError } = await serviceSupabase
    .from('email_subscribers')
    .select('id, email, confirmed_at, unsubscribed_at, source')
    .eq('email', normalized)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (existing?.confirmed_at && !existing.unsubscribed_at) {
    return 'already_subscribed';
  }

  const payload = {
    email: normalized,
    source: source?.trim() || existing?.source || 'landing_page',
    subscribed_at: now,
    unsubscribed_at: null,
    confirmed_at: null,
    confirmation_token: token,
    confirmation_sent_at: now,
  };

  const { error: upsertError } = await serviceSupabase
    .from('email_subscribers')
    .upsert(payload, { onConflict: 'email' });

  if (upsertError) throw new Error(upsertError.message);

  const message = buildSignupConfirmationEmail(normalized, token);
  const emailResult = await resend.emails.send({
    from: formatFromAddress(await getNewsletterSettings()),
    to: normalized,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (emailResult.error) {
    throw new Error(emailResult.error.message);
  }

  return 'pending_confirmation';
}

export async function getNewsletterSubscriptionPreference(email: string): Promise<NewsletterSubscriptionPreference> {
  const normalized = normalizeEmail(email);
  const { data, error } = await serviceSupabase
    .from('email_subscribers')
    .select('email, subscribed_at, unsubscribed_at, confirmed_at')
    .eq('email', normalized)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    email: normalized,
    subscribed: Boolean(data && data.confirmed_at && !data.unsubscribed_at),
    subscribedAt: data?.subscribed_at ?? null,
  };
}

export async function setRegisteredUserNewsletterPreference(
  email: string,
  enabled: boolean,
): Promise<NewsletterSubscriptionPreference> {
  const normalized = normalizeEmail(email);

  if (!enabled) {
    await unsubscribeEmail(normalized);
    return {
      email: normalized,
      subscribed: false,
      subscribedAt: null,
    };
  }

  const now = new Date().toISOString();
  const [{ error: subscriberError }, { error: suppressionDeleteError }] = await Promise.all([
    serviceSupabase
      .from('email_subscribers')
      .upsert({
        email: normalized,
        source: 'profile_toggle',
        subscribed_at: now,
        unsubscribed_at: null,
        confirmed_at: now,
        confirmation_token: null,
        confirmation_sent_at: null,
      }, { onConflict: 'email' }),
    serviceSupabase
      .from('newsletter_suppressions')
      .delete()
      .eq('email', normalized),
  ]);

  if (subscriberError) throw new Error(subscriberError.message);
  if (suppressionDeleteError) throw new Error(suppressionDeleteError.message);

  return {
    email: normalized,
    subscribed: true,
    subscribedAt: now,
  };
}

export async function confirmNewsletterSubscription(token: string): Promise<string> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Missing confirmation token.');

  const { data: subscriber, error: subscriberError } = await serviceSupabase
    .from('email_subscribers')
    .select('email, unsubscribed_at')
    .eq('confirmation_token', trimmed)
    .maybeSingle();

  if (subscriberError) throw new Error(subscriberError.message);
  if (!subscriber || subscriber.unsubscribed_at) {
    throw new Error('Confirmation link is invalid or no longer active.');
  }

  const normalized = normalizeEmail(subscriber.email);
  const now = new Date().toISOString();

  const [{ error: subscriberUpdateError }, { error: suppressionDeleteError }] = await Promise.all([
    serviceSupabase
      .from('email_subscribers')
      .update({
        confirmed_at: now,
        unsubscribed_at: null,
        confirmation_token: null,
      })
      .eq('email', normalized),
    serviceSupabase
      .from('newsletter_suppressions')
      .delete()
      .eq('email', normalized),
  ]);

  if (subscriberUpdateError) throw new Error(subscriberUpdateError.message);
  if (suppressionDeleteError) throw new Error(suppressionDeleteError.message);

  return normalized;
}

export async function unsubscribeEmail(email: string) {
  const normalized = normalizeEmail(email);

  const [{ error: suppressError }, { error: subscriberError }] = await Promise.all([
    serviceSupabase
      .from('newsletter_suppressions')
      .upsert({ email: normalized, reason: 'unsubscribe' }, { onConflict: 'email' }),
    serviceSupabase
      .from('email_subscribers')
      .update({
        unsubscribed_at: new Date().toISOString(),
        confirmation_token: null,
      })
      .eq('email', normalized),
  ]);

  if (suppressError) throw new Error(suppressError.message);
  if (subscriberError) throw new Error(subscriberError.message);
}

export async function getAutomaticNewsletterStatus(nowInput = new Date()): Promise<AutomaticNewsletterStatus> {
  const settings = await getNewsletterSettings();
  const now = nowInput;
  const weekOf = mondayOf(now);
  const scheduledFor = nextScheduledAt(settings, weekOf);
  const existingIssue = await getIssueByWeek(weekOf);

  if (!settings.enabled) {
    return {
      ok: true,
      skipped: true,
      wouldSend: false,
      reason: 'Automatic newsletter sending is disabled.',
      now: now.toISOString(),
      weekOf,
      scheduledFor,
      issueId: existingIssue?.id ?? null,
      alreadySent: Boolean(existingIssue?.sent_at),
    };
  }

  if (now.getUTCDay() !== settings.send_weekday) {
    return {
      ok: true,
      skipped: true,
      wouldSend: false,
      reason: 'Today is not the configured newsletter day.',
      now: now.toISOString(),
      weekOf,
      scheduledFor,
      issueId: existingIssue?.id ?? null,
      alreadySent: Boolean(existingIssue?.sent_at),
    };
  }

  if (now.getUTCHours() < settings.send_hour_utc) {
    return {
      ok: true,
      skipped: true,
      wouldSend: false,
      reason: 'Configured newsletter send hour has not been reached yet.',
      now: now.toISOString(),
      weekOf,
      scheduledFor,
      issueId: existingIssue?.id ?? null,
      alreadySent: Boolean(existingIssue?.sent_at),
    };
  }

  if (existingIssue?.sent_at) {
    return {
      ok: true,
      skipped: true,
      wouldSend: false,
      reason: 'This week’s newsletter has already been sent.',
      now: now.toISOString(),
      weekOf,
      scheduledFor,
      issueId: existingIssue.id,
      alreadySent: true,
    };
  }

  return {
    ok: true,
    skipped: false,
    wouldSend: true,
    reason: 'The next auto_send call would compose and broadcast this week’s newsletter.',
    now: now.toISOString(),
    weekOf,
    scheduledFor,
    issueId: existingIssue?.id ?? null,
    alreadySent: false,
  };
}

export async function runAutomaticNewsletterSend() {
  const status = await getAutomaticNewsletterStatus();
  if (!status.wouldSend) {
    return { ok: true, skipped: true, reason: status.reason };
  }

  const settings = await getNewsletterSettings();
  const existingIssue = await getIssueByWeek(status.weekOf);

  const issue = await composeNewsletterIssue({
    actorId: null,
    weekOf: status.weekOf,
    editorNote: existingIssue?.editor_note ?? null,
    ctaLabel: existingIssue?.cta_label ?? null,
    ctaHref: existingIssue?.cta_href ?? null,
  });

  const result = await sendNewsletterIssue({
    issue,
    settings,
    mode: 'broadcast',
  });

  return {
    ok: true,
    skipped: false,
    issueId: issue.id,
    weekOf: status.weekOf,
    ...result,
  };
}
