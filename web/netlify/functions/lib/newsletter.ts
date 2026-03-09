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

export interface WeeklyContext {
  weekOf: string;
  referenceDate: string;
  current: Record<string, number | string | null>;
  previousWeek: Record<string, number | string | null>;
  deltas: Record<string, number | null>;
  stateChanges: string[];
  highlights: string[];
}

interface ComposeIssueInput {
  actorId?: string | null;
  weekOf: string;
  editorNote?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  curatedLinks: CuratedLinkInput[];
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
const openAiModel = process.env.OPENAI_MODEL || 'gpt-5.1';

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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildUnsubscribeUrl(email?: string | null): string {
  if (!email) return `${appUrl}/unsubscribe`;
  return `${appUrl}/unsubscribe?email=${encodeURIComponent(email)}`;
}

function personalizeTemplate(value: string, email?: string | null): string {
  return value.replaceAll('__UNSUBSCRIBE_URL__', buildUnsubscribeUrl(email));
}

function issueSlug(weekOf: string): string {
  return `newsletter-${weekOf}`;
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
    `Valuation score is ${current.VAL_SCORE ?? 'n/a'} with MVRV at ${formatNumber(current.MVRV)}.`,
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
      AB_SCORE: current.AB_SCORE ?? null,
      ABCD_SCORE: current.ABCD_SCORE ?? null,
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

  return {
    subject: `CoinStrat Weekly — CORE ${coreStatus} | BTC ${formatCurrency(current.BTCUSD as number | null)}`,
    previewText: `Weekly signal snapshot for ${context.referenceDate}: CORE ${coreStatus}, MACRO ${macroStatus}, BTC ${formatCurrency(current.BTCUSD as number | null)}.`,
    headline: `Weekly signal check-in: CORE ${coreStatus}, MACRO ${macroStatus}`,
    summary: `CoinStrat closes the week with BTC at ${formatCurrency(current.BTCUSD as number | null)}. The model is reading valuation as ${scoreLabel(current.VAL_SCORE as number | undefined)}, liquidity as ${scoreLabel(current.LIQ_SCORE as number | undefined)}, and the macro backdrop as ${scoreLabel(current.CYCLE_SCORE as number | undefined)}.`,
    signalSections: [
      {
        title: 'Signal Snapshot',
        body: `CORE is ${coreStatus}, MACRO is ${macroStatus}, and ACCUM is ${current.ACCUM_ON === 1 ? 'ON' : 'OFF'}. BTC is ${formatCurrency(current.BTCUSD as number | null)} with the 200-day average at ${formatCurrency(current.BTC_MA200 as number | null)} and the 40-week average at ${formatCurrency(current.BTC_MA40W as number | null)}.`,
        bullets: context.stateChanges.length > 0 ? context.stateChanges : ['No major regime changes were recorded this week.'],
      },
      {
        title: 'Macro Backdrop',
        body: `Liquidity is ${scoreLabel(current.LIQ_SCORE as number | undefined)} with US liquidity YoY at ${formatPercent(current.US_LIQ_YOY as number | null)}. The dollar score is ${current.DXY_SCORE ?? 'n/a'} and the business cycle score is ${current.CYCLE_SCORE ?? 'n/a'}.`,
        bullets: [
          `US liquidity YoY: ${formatPercent(current.US_LIQ_YOY as number | null)}`,
          `DXY: ${formatNumber(current.DXY as number | null)}`,
          `Sahm Rule: ${formatNumber(current.SAHM as number | null)}`,
          `Yield curve (10Y-3M): ${formatNumber(current.YC_M as number | null)}`,
        ],
      },
      {
        title: 'Valuation and Trend',
        body: `MVRV sits at ${formatNumber(current.MVRV as number | null)}, with price regime ${current.PRICE_REGIME_ON === 1 ? 'supportive' : 'cautious'}. Supply in profit is ${formatPercent(current.SIP as number | null)} and exhaustion is ${current.SIP_EXHAUSTED === 1 ? 'active' : 'not active'}.`,
        bullets: [
          `Valuation score: ${current.VAL_SCORE ?? 'n/a'}`,
          `Price regime: ${current.PRICE_REGIME_ON === 1 ? 'ON' : 'OFF'}`,
          `Supply in profit: ${formatPercent(current.SIP as number | null)}`,
        ],
      },
      {
        title: 'Why It Matters',
        body: editorNote?.trim() || 'This week’s read is best used as a portfolio sizing and pacing signal, not a short-term price prediction. Watch for changes in liquidity, valuation, and macro conditions to determine whether accumulation should stay patient or accelerate.',
        bullets: context.highlights,
      },
    ],
    curatedLinks: curatedLinks.map((link) => ({
      ...link,
      commentary: link.note?.trim() || `Worth reading for additional market context alongside the CoinStrat signal stack.`,
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

  if (!openAiApiKey) {
    return {
      draft: fallback,
      provider: 'fallback',
      model: 'deterministic-template',
    };
  }

  const payload = {
    model: openAiModel,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You write the CoinStrat weekly newsletter. Keep it concise, analytical, and grounded in the provided data only. Do not invent facts, do not make financial promises, and prefer what changed / why it matters framing. Return a JSON object with keys: subject, previewText, headline, summary, signalSections, curatedLinks, cta, complianceFooter. signalSections must be an array of { title, body, bullets }. curatedLinks must keep the supplied URLs.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          brandVoice: 'Concise analytical newsletter for bitcoin accumulators. Professional, calm, and persuasive. Avoid hype.',
          weeklyContext: context,
          curatedLinks,
          editorNote,
          cta: {
            label: ctaLabel ?? 'Open Dashboard',
            href: ctaHref ?? `${appUrl}/dashboard`,
          },
        }),
      },
    ],
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`OpenAI: HTTP ${response.status}`);
    }

    const json = await response.json() as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenAI returned an empty draft.');
    }

    const parsed = JSON.parse(content);

    return {
      draft: normalizeDraft(parsed, fallback),
      provider: 'openai',
      model: openAiModel,
    };
  } catch (error) {
    console.error('[newsletter/openai]', error);
    return {
      draft: fallback,
      provider: 'fallback',
      model: 'deterministic-template',
    };
  }
}

function renderNewsletterContent(issue: {
  weekOf: string;
  referenceDate: string;
  draft: NewsletterDraft;
}): { html: string; text: string } {
  const sectionsHtml = issue.draft.signalSections.map((section) => `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px;margin-bottom:16px;">
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
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px;margin-bottom:16px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#f8fafc;">Curated Reads</h2>
        ${issue.draft.curatedLinks.map((link) => `
          <div style="margin-bottom:14px;">
            <a href="${escapeHtml(link.url)}" style="color:#93c5fd;font-weight:700;text-decoration:none;">${escapeHtml(link.title)}</a>
            <div style="color:#94a3b8;font-size:12px;margin-top:2px;">${escapeHtml(link.source)}</div>
            ${link.commentary ? `<p style="margin:6px 0 0;color:#cbd5e1;line-height:1.6;">${escapeHtml(link.commentary)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    `
    : '';

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#020617;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="max-width:620px;margin:0 auto;padding:24px;">
          <div style="background:linear-gradient(135deg,#0b1220 0%,#111827 100%);border:1px solid #1e293b;border-radius:16px;padding:28px;color:#e2e8f0;">
            <div style="margin-bottom:24px;">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#60a5fa;font-weight:800;">CoinStrat Weekly</div>
              <h1 style="margin:10px 0 8px;font-size:28px;line-height:1.15;color:#f8fafc;">${escapeHtml(issue.draft.headline)}</h1>
              <p style="margin:0;color:#94a3b8;font-size:14px;">Week of ${escapeHtml(issue.weekOf)} · data through ${escapeHtml(issue.referenceDate)}</p>
            </div>

            <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px;margin-bottom:16px;">
              <p style="margin:0;color:#cbd5e1;line-height:1.75;">${escapeHtml(issue.draft.summary)}</p>
            </div>

            ${sectionsHtml}
            ${curatedLinksHtml}

            <div style="text-align:center;margin:24px 0 8px;">
              <a href="${escapeHtml(issue.draft.cta.href)}" style="display:inline-block;background:#60a5fa;color:#08111f;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:800;">
                ${escapeHtml(issue.draft.cta.label)}
              </a>
            </div>

            <p style="margin:24px 0 8px;color:#64748b;font-size:12px;line-height:1.6;text-align:center;">
              ${escapeHtml(issue.draft.complianceFooter)}
            </p>
            <p style="margin:0;color:#64748b;font-size:12px;text-align:center;">
              <a href="__UNSUBSCRIBE_URL__" style="color:#94a3b8;">Unsubscribe</a>
            </p>
          </div>
        </div>
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
        'Curated Reads',
        ...issue.draft.curatedLinks.flatMap((link) => [
          `${link.title} (${link.source})`,
          link.url,
          link.commentary ?? '',
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

  await saveCuratedLinks(issueId, input.curatedLinks);

  const [context, curatedLinks] = await Promise.all([
    buildWeeklyContext(weekOf),
    loadIssueLinks(issueId),
  ]);

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

export async function unsubscribeEmail(email: string) {
  const normalized = normalizeEmail(email);

  const [{ error: suppressError }, { error: subscriberError }] = await Promise.all([
    serviceSupabase
      .from('newsletter_suppressions')
      .upsert({ email: normalized, reason: 'unsubscribe' }, { onConflict: 'email' }),
    serviceSupabase
      .from('email_subscribers')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('email', normalized),
  ]);

  if (suppressError) throw new Error(suppressError.message);
  if (subscriberError) throw new Error(subscriberError.message);
}

export async function runAutomaticNewsletterSend() {
  const settings = await getNewsletterSettings();
  if (!settings.enabled) {
    return { ok: true, skipped: true, reason: 'Automatic newsletter sending is disabled.' };
  }

  const now = new Date();
  if (now.getUTCDay() !== settings.send_weekday) {
    return { ok: true, skipped: true, reason: 'Today is not the configured newsletter day.' };
  }

  if (now.getUTCHours() < settings.send_hour_utc) {
    return { ok: true, skipped: true, reason: 'Configured newsletter send hour has not been reached yet.' };
  }

  const weekOf = mondayOf(now);
  const existingIssue = await getIssueByWeek(weekOf);

  if (existingIssue?.sent_at) {
    return { ok: true, skipped: true, reason: 'This week’s newsletter has already been sent.' };
  }

  const issue = await composeNewsletterIssue({
    actorId: null,
    weekOf,
    curatedLinks: existingIssue?.curated_links ?? [],
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
    weekOf,
    ...result,
  };
}
