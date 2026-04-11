import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';

type ArticleRow = {
  id: string;
  slug: string;
  headline: string;
  body: string;
  labels: string[] | null;
  source_links: string[] | null;
  published_at: string;
  created_at: string;
};

const NewsArticle: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<ArticleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) {
      setError('Missing article link.');
      setArticle(null);
      setLoading(false);
      return;
    }
    if (!supabase) {
      setError('News is unavailable (Supabase is not configured).');
      setArticle(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from('news_articles')
      .select('id, slug, headline, body, labels, source_links, published_at, created_at')
      .eq('slug', slug)
      .maybeSingle();

    if (qErr) {
      setError(qErr.message);
      setArticle(null);
    } else if (!data) {
      setError('Article not found.');
      setArticle(null);
    } else {
      setArticle(data as ArticleRow);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', py: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <Breadcrumbs sx={{ color: 'text.secondary', '& a': { color: 'inherit' } }}>
          <Link component={RouterLink} to="/news" underline="hover" sx={{ fontWeight: 600 }}>
            News
          </Link>
          <Typography color="text.primary" sx={{ fontWeight: 600 }}>
            Article
          </Typography>
        </Breadcrumbs>

        <Button
          component={RouterLink}
          to="/news"
          startIcon={<ArrowLeft size={18} />}
          variant="text"
          sx={{ alignSelf: 'flex-start', fontWeight: 700, mb: -1 }}
        >
          All articles
        </Button>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">Loading…</Typography>
          </Box>
        )}

        {!loading && error && (
          <Paper sx={{ p: 3 }}>
            <Typography color="error" sx={{ fontWeight: 700, mb: 2 }}>{error}</Typography>
            <Button component={RouterLink} to="/news" variant="contained" sx={{ fontWeight: 700 }}>
              Back to news
            </Button>
          </Paper>
        )}

        {!loading && !error && article && (
          <Paper sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: 1 }}>
              {format(parseISO(article.published_at), 'MMMM d, yyyy')}
            </Typography>
            <Typography variant="h3" component="h1" sx={{ fontWeight: 900, mt: 0.5, mb: 2, fontSize: { xs: 26, sm: 34 } }}>
              {article.headline}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
              {(article.labels ?? []).map((l) => (
                <Chip key={l} label={l} size="small" variant="outlined" />
              ))}
            </Box>
            <Typography
              component="div"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.75,
                fontSize: '1rem',
                color: 'text.primary',
              }}
            >
              {article.body}
            </Typography>
            {(article.source_links ?? []).length > 0 && (
              <>
                <DividerSoft />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Sources
                </Typography>
                <Stack spacing={2}>
                  {(article.source_links ?? []).map((url) => {
                    const tweetId = extractTweetId(url);
                    if (tweetId) {
                      return <EmbeddedTweet key={url} tweetId={tweetId} url={url} />;
                    }
                    return (
                      <Link
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.5,
                          fontSize: '0.875rem',
                          wordBreak: 'break-all',
                        }}
                      >
                        <ExternalLink size={14} style={{ flexShrink: 0 }} />
                        {prettifySourceUrl(url)}
                      </Link>
                    );
                  })}
                </Stack>
              </>
            )}
            <DividerSoft />
            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
              Generated{' '}
              {format(parseISO(article.created_at), "MMMM d, yyyy 'at' h:mm a")}
            </Typography>
          </Paper>
        )}
      </Stack>
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Tweet embedding via X/Twitter widgets.js                          */
/* ------------------------------------------------------------------ */

const TWEET_URL_RE = /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/;

function extractTweetId(url: string): string | null {
  const m = url.match(TWEET_URL_RE);
  return m ? m[1] : null;
}

interface TwttrWidgets {
  createTweet(
    id: string,
    el: HTMLElement,
    opts?: Record<string, unknown>,
  ): Promise<HTMLElement | undefined>;
}
interface TwttrGlobal { widgets: TwttrWidgets; }
declare global { interface Window { twttr?: TwttrGlobal } }

let widgetScriptPromise: Promise<TwttrGlobal> | null = null;

function ensureWidgetsJs(): Promise<TwttrGlobal> {
  if (widgetScriptPromise) return widgetScriptPromise;
  widgetScriptPromise = new Promise<TwttrGlobal>((resolve, reject) => {
    if (window.twttr?.widgets) {
      resolve(window.twttr);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    s.onerror = () => reject(new Error('Failed to load Twitter widgets.js'));
    s.onload = () => {
      const poll = (attempts = 0) => {
        if (window.twttr?.widgets) {
          resolve(window.twttr);
        } else if (attempts > 50) {
          reject(new Error('twttr.widgets never became available'));
        } else {
          setTimeout(() => poll(attempts + 1), 100);
        }
      };
      poll();
    };
    document.head.appendChild(s);
  });
  return widgetScriptPromise;
}

const EmbeddedTweet: React.FC<{ tweetId: string; url: string }> = ({ tweetId, url }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    ensureWidgetsJs()
      .then((twttr) =>
        twttr.widgets.createTweet(tweetId, el, {
          conversation: 'none',
          dnt: true,
          align: 'center',
        }),
      )
      .then((embedded) => {
        if (cancelled) return;
        setStatus(embedded ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => { cancelled = true; };
  }, [tweetId]);

  return (
    <Box sx={{ position: 'relative', minHeight: status === 'loading' ? 200 : undefined }}>
      {status === 'loading' && (
        <Skeleton
          variant="rounded"
          height={200}
          sx={{ borderRadius: 3, position: 'absolute', inset: 0 }}
        />
      )}
      <Box ref={containerRef} />
      {status === 'error' && (
        <Link
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: '0.875rem',
            wordBreak: 'break-all',
          }}
        >
          <ExternalLink size={14} style={{ flexShrink: 0 }} />
          {prettifySourceUrl(url)}
        </Link>
      )}
    </Box>
  );
};

/* ------------------------------------------------------------------ */

function prettifySourceUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'x.com' || host === 'twitter.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 1) return `@${parts[0]} on ${host === 'x.com' ? 'X' : 'Twitter'}`;
    }
    const path = u.pathname === '/' ? '' : u.pathname;
    const display = host + path;
    return display.length > 80 ? display.slice(0, 77) + '…' : display;
  } catch {
    return raw.length > 80 ? raw.slice(0, 77) + '…' : raw;
  }
}

function DividerSoft() {
  return <Box sx={{ height: 1, bgcolor: 'divider', my: 2 }} />;
}

export default NewsArticle;
