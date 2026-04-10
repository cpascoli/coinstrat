import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { format, parseISO } from 'date-fns';
import { Newspaper } from 'lucide-react';
import { supabase } from '../lib/supabase';

type NewsArticleListRow = {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  labels: string[] | null;
  published_at: string;
};

function articleMatchesSearch(row: NewsArticleListRow, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const words = q.split(/\s+/).filter(Boolean);
  const blob = [row.headline, row.summary, row.slug, ...(row.labels ?? [])].join(' ').toLowerCase();
  return words.every((w) => blob.includes(w));
}

const News: React.FC = () => {
  const [rows, setRows] = useState<NewsArticleListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [topicFilter, setTopicFilter] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    if (!supabase) {
      setError('News is unavailable (Supabase is not configured).');
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from('news_articles')
      .select('id, slug, headline, summary, labels, published_at')
      .order('published_at', { ascending: false });

    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as NewsArticleListRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allTopics = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      for (const raw of r.labels ?? []) {
        const t = raw.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (!m.has(key)) m.set(key, t);
      }
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([, display]) => display);
  }, [rows]);

  const filtered = useMemo(() => {
    let list = [...rows];
    if (search.trim()) {
      list = list.filter((r) => articleMatchesSearch(r, search));
    }
    if (topicFilter.size > 0) {
      const selected = new Set([...topicFilter].map((x) => x.toLowerCase()));
      list = list.filter((r) =>
        (r.labels ?? []).some((l) => selected.has(l.trim().toLowerCase())),
      );
    }
    return list;
  }, [rows, search, topicFilter]);

  const featured = filtered[0];
  const rest = filtered.slice(1);

  const toggleTopic = (label: string) => {
    setTopicFilter((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setTopicFilter(new Set());
  };

  const hasFilters = Boolean(search.trim() || topicFilter.size > 0);

  const filtersSidebar = (
    <Paper
      sx={{
        p: 2,
        width: { xs: '100%', md: 220 },
        flexShrink: 0,
        alignSelf: { xs: 'stretch', md: 'flex-start' },
        position: { md: 'sticky' },
        top: { md: 88 },
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.75, letterSpacing: 0.02 }}>
        Filters
      </Typography>
      <Stack spacing={1.75}>
        <TextField
          label="Search"
          placeholder="Headlines, topics…"
          size="small"
          fullWidth
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
              </InputAdornment>
            ),
          }}
        />
        {hasFilters && (
          <Button variant="outlined" size="small" onClick={clearFilters} fullWidth sx={{ fontWeight: 700 }}>
            Clear filters
          </Button>
        )}
      </Stack>
      {allTopics.length > 0 && (
        <>
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mt: 2.5, mb: 1, color: 'text.secondary' }}>
            Topics
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.75 }}>
            {allTopics.map((t) => (
              <Chip
                key={t}
                label={t}
                size="small"
                onClick={() => toggleTopic(t)}
                color={topicFilter.has(t) ? 'primary' : 'default'}
                variant={topicFilter.has(t) ? 'filled' : 'outlined'}
                sx={{
                  fontWeight: 600,
                  width: '100%',
                  justifyContent: 'flex-start',
                  '& .MuiChip-label': { width: '100%', textAlign: 'left', px: 1.25 },
                }}
              />
            ))}
          </Box>
        </>
      )}
    </Paper>
  );

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', py: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5} sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Newspaper size={32} style={{ color: '#60a5fa' }} />
          <Typography variant="h3" component="h1" sx={{ fontWeight: 900, fontSize: { xs: 28, sm: 36 } }}>
            News
          </Typography>
        </Stack>
        <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
          Commentary and updates from CoinStrat. Search or filter by topic, or open an article to read the full piece.
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: { xs: 2.5, md: 3 },
          alignItems: 'flex-start',
        }}
      >
        {filtersSidebar}

        <Stack spacing={3} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">Loading articles…</Typography>
          </Box>
        )}

        {!loading && error && (
          <Paper sx={{ p: 3 }}>
            <Typography color="error" sx={{ fontWeight: 700 }}>{error}</Typography>
          </Paper>
        )}

        {!loading && !error && filtered.length === 0 && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>No articles match your search or filters</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Try different keywords, clear filters, or check back soon for new posts.
            </Typography>
            {hasFilters && (
              <Button variant="contained" onClick={clearFilters} sx={{ fontWeight: 700 }}>
                Clear filters
              </Button>
            )}
          </Paper>
        )}

        {!loading && !error && featured && (
          <Paper
            component={RouterLink}
            to={`/news/${featured.slug}`}
            sx={{
              p: { xs: 2.5, sm: 3.5 },
              textDecoration: 'none',
              color: 'inherit',
              display: 'block',
              border: '1px solid',
              borderColor: 'rgba(96, 165, 250, 0.35)',
              background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(12, 19, 34, 0.4) 100%)',
              transition: 'transform 0.15s, box-shadow 0.15s',
              '&:hover': {
                boxShadow: '0 12px 40px -12px rgba(37, 99, 235, 0.35)',
                transform: 'translateY(-2px)',
              },
            }}
          >
            <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: 1 }}>
              {format(parseISO(featured.published_at), 'MMMM d, yyyy')}
            </Typography>
            <Typography variant="h4" component="h2" sx={{ fontWeight: 900, mt: 0.5, mb: 1.5, fontSize: { xs: 22, sm: 28 } }}>
              {featured.headline}
            </Typography>
            <Typography sx={{ color: 'text.secondary', mb: 2, lineHeight: 1.6 }}>
              {featured.summary}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {(featured.labels ?? []).map((l) => (
                <Chip key={l} label={l} size="small" variant="outlined" sx={{ fontSize: 11 }} />
              ))}
            </Box>
            <Typography sx={{ mt: 2, fontWeight: 800, color: 'primary.light' }}>Read full article →</Typography>
          </Paper>
        )}

        {!loading && !error && rest.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Earlier articles
            </Typography>
            <Grid container spacing={2}>
              {rest.map((r) => (
                <Grid item xs={12} sm={6} key={r.id}>
                  <Paper
                    component={RouterLink}
                    to={`/news/${r.slug}`}
                    sx={{
                      p: 2.25,
                      height: '100%',
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      border: '1px solid',
                      borderColor: 'divider',
                      transition: 'border-color 0.15s, background 0.15s',
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5 }}>
                      {format(parseISO(r.published_at), 'MMM d, yyyy')}
                    </Typography>
                    <Typography sx={{ fontWeight: 800, mb: 1, lineHeight: 1.35 }}>{r.headline}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1, lineHeight: 1.5 }}>
                      {r.summary.length > 160 ? `${r.summary.slice(0, 157)}…` : r.summary}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
                      {(r.labels ?? []).slice(0, 4).map((l) => (
                        <Chip key={l} label={l} size="small" variant="outlined" sx={{ height: 22, fontSize: 10 }} />
                      ))}
                    </Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </>
        )}
        </Stack>
      </Box>
    </Box>
  );
};

export default News;
