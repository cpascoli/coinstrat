import { normalizeWhitespace } from './newsFetch';
import type { NewsSection } from './newsSources/types';

const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_NEWS_MODEL || process.env.OPENAI_NEWSLETTER_MODEL || 'gpt-4.1-mini';
const OPENAI_TIMEOUT_MS = 45000;
const MAX_HEADLINE = 200;
const MAX_SUMMARY = 600;
const MAX_LABELS = 5;

export interface NewsSourcePacket {
  title: string;
  source: string;
  url: string;
  excerpt: string;
}

export interface SectionDraft {
  section: NewsSection;
  headline: string;
  summary: string;
  body: string;
  labels: string[];
  imagePrompt: string;
  imageAlt: string;
}

export interface DailyFacts {
  date: string;
  btcUsd: number | null;
  btcChange24hPct: number | null;
  cqmRiskPct: number | null;
  valScore: number | null;
  liqScore: number | null;
  dxyScore: number | null;
  bizCycleScore: number | null;
  bottomAccumScore: number | null;
  mempoolFastestFee: number | null;
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

export function isCreditsExhaustedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient_quota|credit_balance_exhausted|no credits remaining/i.test(message);
}

export function normalizeLabels(raw: unknown): string[] {
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

export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean)
    .join('\n\n');
}

export async function completeJson(args: {
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  if (!openAiApiKey) {
    throw new Error('News generation failed: OPENAI_API_KEY is not configured.');
  }

  const timeoutMs = args.timeoutMs ?? OPENAI_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: openAiModel,
        temperature: args.temperature ?? 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    }, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`News generation failed: OpenAI request timed out after ${timeoutMs}ms using model ${openAiModel}.`);
    }
    throw error;
  }

  if (!response.ok) {
    const bodyText = normalizeWhitespace(await response.text()).slice(0, 400);
    throw new Error(`News generation failed: OpenAI HTTP ${response.status}${bodyText ? ` - ${bodyText}` : ''}`);
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('News generation failed: OpenAI returned an empty response.');
  }
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`News generation failed: OpenAI returned invalid JSON - ${normalizeWhitespace(content).slice(0, 300)}`);
  }
}

function sectionSystemPrompt(section: NewsSection): string {
  const shared = 'Ground every claim in the supplied excerpts and the facts sheet; do not invent facts, numbers, or quotes. Calm, professional, analytical voice. No hype, no financial advice. Return valid JSON with keys: `headline`, `summary`, `body`, `labels`. `headline` under 120 characters. `summary` one or two sentences. `body` is 350-650 words of PLAIN TEXT (no markdown, headings, links, or bullets), 4-6 paragraphs separated by a blank line. `labels` is 2-4 tags from: "Markets", "ETFs & Funds", "Treasuries", "Institutions", "Mining", "On-Chain", "Macro & Geopolitics", "Regulation & Policy", "Development & Tech", "Adoption & Culture".';
  switch (section) {
    case 'market':
      return `You are a Bitcoin markets journalist writing CoinStrat's daily market lead. Cover price, flows, ETFs, mining, and institutional activity from today's sources. ${shared} Also return \`imagePrompt\` (one vivid sentence, a pop-art visual metaphor for the lead takeaway — no text, logos, coins, charts, or real people) and \`imageAlt\` (short literal alt text).`;
    case 'development':
      return `You are a Bitcoin protocol correspondent. Cover releases, BIPs, Lightning, wallets, and developer discussion. Prefer concrete software and research over price. ${shared}`;
    case 'culture':
      return `You are a Bitcoin culture correspondent. Cover community, education, conferences, adoption on the ground, and Nostr/long-form voices. ${shared}`;
    case 'opinion':
      return `You are writing CoinStrat's daily Analysis column on macro, geopolitics, and Bitcoin. Anchor the argument in the facts sheet (price, CQM risk, liquidity/dollar/cycle scores) and the supplied sources. Label the piece as analysis, not news. Never give investment advice. ${shared}`;
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export async function writeSectionArticle(args: {
  section: NewsSection;
  dateLabel: string;
  facts: DailyFacts;
  packets: NewsSourcePacket[];
}): Promise<SectionDraft> {
  if (args.packets.length === 0) {
    throw new Error(`News generation failed: no excerpts for ${args.section}.`);
  }

  const parsed = await completeJson({
    system: sectionSystemPrompt(args.section),
    user: JSON.stringify({
      dateUtc: args.dateLabel,
      facts: args.facts,
      sourcePackets: args.packets,
    }),
    temperature: args.section === 'opinion' ? 0.45 : 0.5,
  });

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim().slice(0, MAX_HEADLINE) : '';
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, MAX_SUMMARY) : '';
  const body = typeof parsed.body === 'string' ? normalizeBody(parsed.body) : '';
  const labels = normalizeLabels(parsed.labels);
  const imagePrompt = typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim().slice(0, 600) : '';
  const imageAlt = typeof parsed.imageAlt === 'string' ? parsed.imageAlt.trim().slice(0, 300) : '';

  if (!headline || !summary || body.length < 200) {
    throw new Error(`News generation failed: ${args.section} response missing headline, summary, or body.`);
  }

  return {
    section: args.section,
    headline,
    summary,
    body,
    labels: labels.length > 0 ? labels : [args.section === 'opinion' ? 'Macro & Geopolitics' : 'Bitcoin'],
    imagePrompt,
    imageAlt,
  };
}

export async function editFrontPage(args: {
  dateLabel: string;
  drafts: SectionDraft[];
}): Promise<{ drafts: SectionDraft[]; heroImagePrompt: string; heroImageAlt: string }> {
  if (args.drafts.length === 0) {
    return { drafts: [], heroImagePrompt: '', heroImageAlt: '' };
  }

  const parsed = await completeJson({
    system:
      'You are the front-page editor of CoinStrat. You receive draft section articles. Remove overlapping coverage so the market lead does not repeat development or culture beats. Tighten headlines. Do not invent facts. Return JSON: `sections` array of {section, headline, summary, body, labels}, plus `imagePrompt` and `imageAlt` for the market lead (pop-art metaphor, no text/logos/coins/charts/people). Keep each body as plain text paragraphs.',
    user: JSON.stringify({
      dateUtc: args.dateLabel,
      drafts: args.drafts,
    }),
    temperature: 0.3,
  });

  const bySection = new Map(args.drafts.map((draft) => [draft.section, draft]));
  const edited = Array.isArray(parsed.sections) ? parsed.sections : [];
  for (const row of edited) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const section = rec.section;
    if (section !== 'market' && section !== 'development' && section !== 'culture' && section !== 'opinion') continue;
    const existing = bySection.get(section);
    if (!existing) continue;
    const headline = typeof rec.headline === 'string' ? rec.headline.trim().slice(0, MAX_HEADLINE) : '';
    const summary = typeof rec.summary === 'string' ? rec.summary.trim().slice(0, MAX_SUMMARY) : '';
    const body = typeof rec.body === 'string' ? normalizeBody(rec.body) : '';
    if (!headline || !summary || body.length < 200) continue;
    bySection.set(section, {
      ...existing,
      headline,
      summary,
      body,
      labels: normalizeLabels(rec.labels).length > 0 ? normalizeLabels(rec.labels) : existing.labels,
    });
  }

  return {
    drafts: args.drafts.map((draft) => bySection.get(draft.section) ?? draft),
    heroImagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim().slice(0, 600) : '',
    heroImageAlt: typeof parsed.imageAlt === 'string' ? parsed.imageAlt.trim().slice(0, 300) : '',
  };
}
