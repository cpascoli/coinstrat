import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron, serviceSupabase } from './lib/auth';

const MAX_HEADLINE = 500;
const MAX_SUMMARY = 4000;
const MAX_BODY = 512_000;

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return s || 'article';
}

function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 128;
}

/**
 * Publish or update a news article.
 *
 * Body JSON:
 *   headline (string, required)
 *   summary (string, required)
 *   article (string, required) — full body, stored as plain text
 *   labels (string[], optional) — topic tags for filtering
 *   slug (string, optional) — URL slug; generated from headline if omitted
 *   published_at (string, optional) — ISO-8601 timestamp
 *
 * Auth: Bearer CRON_SECRET or admin Supabase JWT (same as signal-refresh).
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse((event.body ?? '').trim() || '{}') as Record<string, unknown>;
  } catch {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const headline = typeof body.headline === 'string' ? body.headline.trim() : '';
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  const article = typeof body.article === 'string' ? body.article : '';
  const labels = normalizeLabels(body.labels);

  if (!headline || !summary || !article.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'headline, summary, and article are required' }),
    };
  }

  if (headline.length > MAX_HEADLINE || summary.length > MAX_SUMMARY || article.length > MAX_BODY) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Payload exceeds maximum length' }),
    };
  }

  let slug =
    typeof body.slug === 'string' && body.slug.trim()
      ? body.slug.trim().toLowerCase()
      : slugify(headline);

  if (!isValidSlug(slug)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid slug: use lowercase letters, numbers, and hyphens only' }),
    };
  }

  let publishedAt: string | undefined;
  if (body.published_at != null) {
    if (typeof body.published_at !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'published_at must be an ISO-8601 string' }),
      };
    }
    const d = new Date(body.published_at);
    if (Number.isNaN(d.getTime())) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid published_at' }),
      };
    }
    publishedAt = d.toISOString();
  }

  const now = new Date().toISOString();
  const row = {
    slug,
    headline,
    summary,
    body: article,
    labels,
    ...(publishedAt ? { published_at: publishedAt } : {}),
    updated_at: now,
  };

  const { data: existing } = await serviceSupabase.from('news_articles').select('id').eq('slug', slug).maybeSingle();

  if (existing?.id) {
    const { data, error } = await serviceSupabase
      .from('news_articles')
      .update(row)
      .eq('id', existing.id)
      .select('id, slug, published_at')
      .single();

    if (error) {
      console.error('[news-publish] update', error);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Database error' }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, id: data.id, slug: data.slug, published_at: data.published_at }) };
  }

  const explicitSlug = typeof body.slug === 'string' && body.slug.trim().length > 0;
  let insertSlug = slug;

  const tryInsert = async (s: string) =>
    serviceSupabase
      .from('news_articles')
      .insert({
        ...row,
        slug: s,
        created_at: now,
      })
      .select('id, slug, published_at')
      .single();

  let { data, error } = await tryInsert(insertSlug);

  if (error?.code === '23505' && !explicitSlug) {
    insertSlug = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
    ({ data, error } = await tryInsert(insertSlug));
  }

  if (error) {
    console.error('[news-publish] insert', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Database error' }) };
  }

  return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, id: data.id, slug: data.slug, published_at: data.published_at }) };
};
