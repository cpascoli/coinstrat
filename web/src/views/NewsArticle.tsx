import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';

type ArticleRow = {
  id: string;
  slug: string;
  headline: string;
  body: string;
  labels: string[] | null;
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
      .select('id, slug, headline, body, labels, published_at, created_at')
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

function DividerSoft() {
  return <Box sx={{ height: 1, bgcolor: 'divider', my: 2 }} />;
}

export default NewsArticle;
