import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Pagination,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { format, parseISO } from 'date-fns';
import { Newspaper } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  FRONT_PAGE_SECTIONS,
  SECTION_LABELS,
  groupFrontPage,
  isFrontPageSection,
  relativeAgeLabel,
  type FrontPageArticle,
  type FrontPageSection,
} from '../utils/newsFrontPage';

const ARCHIVE_PAGE_SIZE = 6;
const FRONT_PREVIEW_PARAS = 3;
const FRONT_PREVIEW_MIN_HEIGHT = { xs: 220, sm: 280 };

type NewsRow = FrontPageArticle;

function articleDate(publishedAt: string): string {
  try {
    return format(parseISO(publishedAt), 'MMMM d, yyyy');
  } catch {
    return publishedAt.slice(0, 10);
  }
}

function previewText(article: FrontPageArticle, maxParagraphs: number): string {
  const raw = (article.body || article.summary || '').trim();
  if (!raw) return '';
  const paragraphs = raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length <= maxParagraphs) return paragraphs.join('\n\n');
  return `${paragraphs.slice(0, maxParagraphs).join('\n\n')}…`;
}

const News: React.FC = () => {
  const [rows, setRows] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<FrontPageSection | 'all'>('all');
  const [archivePage, setArchivePage] = useState(1);

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
      .select('id, slug, headline, summary, body, labels, published_at, section, image_url, image_alt, sources')
      .order('published_at', { ascending: false })
      .limit(80);

    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as NewsRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { lead, archive } = useMemo(() => groupFrontPage(rows), [rows]);
  const editionDate = lead.market?.published_at ?? rows[0]?.published_at ?? null;

  const filteredArchive = useMemo(() => {
    if (sectionFilter === 'all') return archive;
    return archive.filter((row) => row.section === sectionFilter);
  }, [archive, sectionFilter]);

  useEffect(() => {
    setArchivePage(1);
  }, [sectionFilter]);

  const archivePageCount = Math.max(1, Math.ceil(filteredArchive.length / ARCHIVE_PAGE_SIZE));
  const currentArchivePage = Math.min(archivePage, archivePageCount);
  const pagedArchive = filteredArchive.slice(
    (currentArchivePage - 1) * ARCHIVE_PAGE_SIZE,
    currentArchivePage * ARCHIVE_PAGE_SIZE,
  );

  const sourcesBySection = useMemo(() => {
    const grouped: Record<FrontPageSection, FrontPageArticle['sources']> = {
      market: [],
      development: [],
      culture: [],
      opinion: [],
    };
    for (const section of FRONT_PAGE_SECTIONS) {
      grouped[section] = lead[section]?.sources ?? [];
    }
    return grouped;
  }, [lead]);

  const sourceCount = FRONT_PAGE_SECTIONS.reduce(
    (total, section) => total + (sourcesBySection[section]?.length ?? 0),
    0,
  );

  const hasLead = FRONT_PAGE_SECTIONS.some((section) => lead[section]);

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', py: { xs: 2, md: 3 } }}>
      <Stack spacing={0.5} sx={{ mb: 3, borderBottom: '3px solid', borderColor: 'primary.main', pb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Newspaper size={28} style={{ color: '#60a5fa' }} />
          <Typography variant="h3" component="h1" sx={{ fontWeight: 900, fontSize: { xs: 28, sm: 36 }, letterSpacing: -0.5 }}>
            CoinStrat Daily
          </Typography>
        </Stack>
        <Typography sx={{ color: 'text.secondary' }}>
          {editionDate ? articleDate(editionDate) : 'Bitcoin markets, development, culture, and analysis'}
        </Typography>
      </Stack>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={24} />
          <Typography color="text.secondary">Loading the front page…</Typography>
        </Box>
      )}

      {!loading && error && (
        <Paper sx={{ p: 3 }}>
          <Typography color="error" sx={{ fontWeight: 700 }}>{error}</Typography>
        </Paper>
      )}

      {!loading && !error && !hasLead && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 700 }}>No articles yet</Typography>
          <Typography variant="body2" color="text.secondary">Check back after the next morning edition.</Typography>
        </Paper>
      )}

      {!loading && !error && hasLead && (
        <Stack spacing={3}>
          {lead.market && (
            <Paper
              component={RouterLink}
              to={`/news/${lead.market.slug}`}
              sx={{
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'rgba(96, 165, 250, 0.35)',
              }}
            >
              {lead.market.image_url && (
                <Box
                  component="img"
                  src={lead.market.image_url}
                  alt={lead.market.image_alt ?? lead.market.headline}
                  sx={{ width: '100%', maxHeight: { xs: 240, sm: 380 }, objectFit: 'cover', display: 'block' }}
                />
              )}
              <Box sx={{ p: { xs: 2.5, sm: 3.5 } }}>
                <SectionKicker section="market" publishedAt={lead.market.published_at} />
                <Typography variant="h4" component="h2" sx={{ fontWeight: 900, mt: 0.5, mb: 1.5, fontSize: { xs: 24, sm: 34 } }}>
                  {lead.market.headline}
                </Typography>
                <PreviewCopy text={previewText(lead.market, FRONT_PREVIEW_PARAS)} prominent />
              </Box>
            </Paper>
          )}

          <Grid container spacing={2}>
            {lead.development && (
              <Grid item xs={12} md={6}>
                <SectionCard article={lead.development} section="development" />
              </Grid>
            )}
            {lead.culture && (
              <Grid item xs={12} md={6}>
                <SectionCard article={lead.culture} section="culture" />
              </Grid>
            )}
          </Grid>

          {lead.opinion && (
            <Paper
              component={RouterLink}
              to={`/news/${lead.opinion.slug}`}
              sx={{
                p: { xs: 2.5, sm: 3 },
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                border: '2px solid',
                borderColor: 'rgba(250, 204, 21, 0.35)',
                background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.08) 0%, rgba(12, 19, 34, 0.4) 100%)',
              }}
            >
              <SectionKicker section="opinion" publishedAt={lead.opinion.published_at} />
              <Typography variant="h5" component="h2" sx={{ fontWeight: 900, mt: 0.5, mb: 1 }}>
                {lead.opinion.headline}
              </Typography>
              <PreviewCopy text={previewText(lead.opinion, FRONT_PREVIEW_PARAS)} prominent />
            </Paper>
          )}

          {sourceCount > 0 && (
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                borderRadius: '12px !important',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                '&:before': { display: 'none' },
                overflow: 'hidden',
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                  px: { xs: 2, sm: 2.5 },
                  '& .MuiAccordionSummary-content': { my: 1.25, alignItems: 'center', gap: 1 },
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Sources</Typography>
                <Chip size="small" label={sourceCount} variant="outlined" sx={{ fontWeight: 700 }} />
              </AccordionSummary>
              <AccordionDetails sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.5, pt: 0 }}>
                <Grid container spacing={2}>
                  {FRONT_PAGE_SECTIONS.map((section) => {
                    const sources = sourcesBySection[section] ?? [];
                    if (!sources || sources.length === 0) return null;
                    return (
                      <Grid item xs={12} sm={6} key={section}>
                        <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary' }}>
                          {SECTION_LABELS[section]}
                        </Typography>
                        <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                          {sources.map((source, index) => (
                            <Typography
                              key={`${source?.url ?? ''}-${index}`}
                              component="a"
                              href={source?.url ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              variant="body2"
                              sx={{ color: 'primary.light', textDecoration: 'none', fontWeight: 600, wordBreak: 'break-word' }}
                            >
                              {source?.title || source?.url}
                              {source?.source ? ` — ${source.source}` : ''}
                            </Typography>
                          ))}
                        </Stack>
                      </Grid>
                    );
                  })}
                </Grid>
              </AccordionDetails>
            </Accordion>
          )}

          {archive.length > 0 && (
            <>
              <Divider />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h6" sx={{ fontWeight: 800, mr: 1 }}>Archive</Typography>
                <Chip
                  label="All"
                  size="small"
                  onClick={() => setSectionFilter('all')}
                  color={sectionFilter === 'all' ? 'primary' : 'default'}
                  variant={sectionFilter === 'all' ? 'filled' : 'outlined'}
                />
                {FRONT_PAGE_SECTIONS.map((section) => (
                  <Chip
                    key={section}
                    label={SECTION_LABELS[section]}
                    size="small"
                    onClick={() => setSectionFilter(section)}
                    color={sectionFilter === section ? 'primary' : 'default'}
                    variant={sectionFilter === section ? 'filled' : 'outlined'}
                  />
                ))}
              </Stack>
              <Grid container spacing={2}>
                {pagedArchive.map((row) => (
                  <Grid item xs={12} sm={6} key={row.id}>
                    <SectionCard
                      article={row}
                      section={isFrontPageSection(row.section) ? row.section : 'market'}
                      compact
                    />
                  </Grid>
                ))}
              </Grid>
              {archivePageCount > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <Pagination
                    count={archivePageCount}
                    page={currentArchivePage}
                    onChange={(_, page) => setArchivePage(page)}
                    color="primary"
                    shape="rounded"
                  />
                </Box>
              )}
            </>
          )}
        </Stack>
      )}
    </Box>
  );
};

function SectionKicker({ section, publishedAt }: { section: FrontPageSection; publishedAt: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
      <Typography variant="overline" sx={{ color: 'primary.light', letterSpacing: 1.2, fontWeight: 800 }}>
        {SECTION_LABELS[section]}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {articleDate(publishedAt)} · {relativeAgeLabel(publishedAt)}
      </Typography>
    </Stack>
  );
}

function PreviewCopy({ text, prominent = false }: { text: string; prominent?: boolean }) {
  return (
    <Typography
      sx={{
        color: 'text.secondary',
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        minHeight: prominent ? FRONT_PREVIEW_MIN_HEIGHT : { xs: 200, sm: 260 },
      }}
    >
      {text}
    </Typography>
  );
}

function SectionCard({
  article,
  section,
  compact = false,
}: {
  article: NewsRow;
  section: FrontPageSection;
  compact?: boolean;
}) {
  return (
    <Paper
      component={RouterLink}
      to={`/news/${article.slug}`}
      sx={{
        p: compact ? 2.25 : 2.5,
        height: '100%',
        textDecoration: 'none',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
    >
      <SectionKicker section={section} publishedAt={article.published_at} />
      <Typography sx={{ fontWeight: 800, mb: 1, lineHeight: 1.35, fontSize: compact ? 16 : 18 }}>
        {article.headline}
      </Typography>
      {compact ? (
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, lineHeight: 1.55 }}>
          {article.summary.length > 180 ? `${article.summary.slice(0, 177)}…` : article.summary}
        </Typography>
      ) : (
        <PreviewCopy text={previewText(article, FRONT_PREVIEW_PARAS)} />
      )}
    </Paper>
  );
}

export default News;
