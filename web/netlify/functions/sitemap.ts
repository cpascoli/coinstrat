import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_SITE_URL = 'https://coinstrat.xyz';

/** Crawlable routes (no auth-gated app shells, no transactional pages). */
const STATIC_PATHS: { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/docs', changefreq: 'weekly', priority: '0.9' },
  { path: '/docs/data', changefreq: 'monthly', priority: '0.8' },
  { path: '/docs/architecture', changefreq: 'monthly', priority: '0.8' },
  { path: '/docs/scores', changefreq: 'monthly', priority: '0.8' },
  { path: '/docs/signals', changefreq: 'monthly', priority: '0.8' },
  { path: '/docs/signal-builder', changefreq: 'monthly', priority: '0.8' },
  { path: '/developer', changefreq: 'weekly', priority: '0.85' },
  { path: '/news', changefreq: 'daily', priority: '0.9' },
  { path: '/backtest', changefreq: 'weekly', priority: '0.85' },
  { path: '/terms', changefreq: 'yearly', priority: '0.4' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.4' },
  { path: '/strategy-builder', changefreq: 'monthly', priority: '0.75' },
  { path: '/charts/system', changefreq: 'weekly', priority: '0.85' },
  { path: '/charts/valuation', changefreq: 'weekly', priority: '0.8' },
  { path: '/charts/liquidity', changefreq: 'weekly', priority: '0.8' },
  { path: '/charts/business', changefreq: 'weekly', priority: '0.8' },
  { path: '/charts/global', changefreq: 'weekly', priority: '0.8' },
  { path: '/charts/usd', changefreq: 'weekly', priority: '0.8' },
];

function siteBaseUrl(): string {
  const raw = process.env.URL || process.env.DEPLOY_PRIME_URL || DEFAULT_SITE_URL;
  return raw.replace(/\/$/, '');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lastmodDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function urlXml(loc: string, changefreq: string, priority: string, lastmod: string | null): string {
  let block = `  <url>\n    <loc>${escapeXml(loc)}</loc>\n`;
  if (lastmod) block += `    <lastmod>${lastmod}</lastmod>\n`;
  block += `    <changefreq>${changefreq}</changefreq>\n`;
  block += `    <priority>${priority}</priority>\n`;
  block += '  </url>\n';
  return block;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const base = siteBaseUrl();
  const parts: string[] = [];

  for (const { path, changefreq, priority } of STATIC_PATHS) {
    const loc = path === '/' ? base : `${base}${path}`;
    parts.push(urlXml(loc, changefreq, priority, null));
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { data: articles, error } = await supabase
        .from('news_articles')
        .select('slug, updated_at, published_at');

      if (!error && articles?.length) {
        for (const row of articles as { slug: string; updated_at?: string; published_at?: string }[]) {
          if (!row.slug || typeof row.slug !== 'string') continue;
          const loc = `${base}/news/${encodeURIComponent(row.slug)}`;
          const lm = lastmodDay(row.updated_at ?? row.published_at);
          parts.push(urlXml(loc, 'weekly', '0.75', lm));
        }
      }
    } catch (e) {
      console.error('[sitemap] news fetch failed', e);
    }
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + parts.join('')
    + '</urlset>\n';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
    body: xml,
  };
};
