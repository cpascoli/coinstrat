import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  ArrowLeftRight,
  DollarSign,
  Droplets,
  Gauge,
  Link2,
  Radio,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';
import {
  STRATEGY_SERIES_CATALOG,
  STRATEGY_METRIC_OPERATORS,
  STRATEGY_LIMITS,
  getGroupedSeries,
} from '../lib/strategyBuilder';

// ---------------------------------------------------------------------------
// Operator docs
// ---------------------------------------------------------------------------

type OperatorDoc = {
  key: string;
  label: string;
  description: string;
  requiredFields: string[];
  example: string;
};

const OPERATOR_DOCS: OperatorDoc[] = [
  {
    key: 'identity',
    label: 'Identity',
    description: 'Passes the input series through unchanged. Useful when you want to reference a source directly as a named metric.',
    requiredFields: [],
    example: '{ operator: "identity", input: "btcusd" }',
  },
  {
    key: 'rolling_mean',
    label: 'Rolling Mean (Moving Average)',
    description: 'Computes a simple moving average over a fixed window of days. The most common operator for trend detection.',
    requiredFields: ['window (integer >= 2, max 400)'],
    example: '{ operator: "rolling_mean", input: "btcusd", window: 200 }',
  },
  {
    key: 'rolling_min',
    label: 'Rolling Min',
    description: 'Tracks the minimum value within a rolling window. Useful for detecting drawdowns or support levels.',
    requiredFields: ['window (integer >= 2, max 400)'],
    example: '{ operator: "rolling_min", input: "btcusd", window: 52 }',
  },
  {
    key: 'rolling_max',
    label: 'Rolling Max',
    description: 'Tracks the maximum value within a rolling window. Useful for ATH proximity or resistance levels.',
    requiredFields: ['window (integer >= 2, max 400)'],
    example: '{ operator: "rolling_max", input: "btcusd", window: 365 }',
  },
  {
    key: 'diff',
    label: 'Difference',
    description:
      'Computes the absolute difference between the current value and the value N periods ago: value[i] - value[i - periods]. '
      + 'A key operator for detecting whether a moving average is rising or falling.',
    requiredFields: ['periods (integer >= 1, max 400)'],
    example: '{ operator: "diff", input: "btc_ma_200", periods: 1 }',
  },
  {
    key: 'pct_change',
    label: 'Percent Change',
    description:
      'Computes the percentage or ratio change over a fixed number of periods: (value[i] / value[i - periods]) - 1. '
      + 'Use scale "ratio" for a 0.05 representation or "percent" for 5.0.',
    requiredFields: ['periods (integer >= 1, max 400)', 'scale ("ratio" or "percent")'],
    example: '{ operator: "pct_change", input: "us_liq", periods: 90, scale: "percent" }',
  },
  {
    key: 'rsi',
    label: 'RSI',
    description:
      'Computes the Relative Strength Index on a 0-100 scale. Useful for identifying momentum exhaustion or reclaim conditions '
      + 'such as RSI crossing back above 30 from oversold territory.',
    requiredFields: ['length (integer >= 2, max 400)', 'timeframe ("day", "week", or "month", optional)'],
    example: '{ operator: "rsi", input: "btcusd", length: 14, timeframe: "month" }',
  },
  {
    key: 'stoch_rsi',
    label: 'Stochastic RSI',
    description:
      'Computes Stochastic RSI on a 0-100 scale by normalizing RSI against its recent range. '
      + 'Useful for prompts like "monthly stochastic RSI crosses back above 20".',
    requiredFields: ['length (integer >= 2, max 400)', 'stochWindow (integer >= 2, max 400)', 'timeframe ("day", "week", or "month", optional)'],
    example: '{ operator: "stoch_rsi", input: "btcusd", length: 14, stochWindow: 14, timeframe: "month" }',
  },
];

const COMPARATOR_DOCS = [
  { symbol: '>', key: 'gt', label: 'Greater than' },
  { symbol: '>=', key: 'gte', label: 'Greater than or equal' },
  { symbol: '<', key: 'lt', label: 'Less than' },
  { symbol: '<=', key: 'lte', label: 'Less than or equal' },
  { symbol: '=', key: 'eq', label: 'Equal' },
  { symbol: '^ above', key: 'crosses_above', label: 'Crosses above (was <= yesterday, is > today)' },
  { symbol: 'v below', key: 'crosses_below', label: 'Crosses below (was >= yesterday, is < today)' },
];

// ---------------------------------------------------------------------------
// Example prompts
// ---------------------------------------------------------------------------

type ExamplePrompt = {
  title: string;
  prompt: string;
  explanation: string;
  concepts: string[];
};

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    title: 'Simple threshold',
    prompt: 'Alert me when BTC is above its 200-day moving average and MVRV is below 2.',
    explanation:
      'The simplest pattern: one moving average crossover combined with a valuation filter. '
      + 'Demonstrates rolling_mean on price and a constant comparison on an on-chain metric.',
    concepts: ['rolling_mean', 'constant comparison', 'AND logic', 'two sources'],
  },
  {
    title: 'Trend direction detection',
    prompt: 'Alert me when bitcoin is above the 200-day moving average, the 200-day MA is going up, and the dollar is weak.',
    explanation:
      'Goes beyond a simple cross: it checks the direction of the MA by chaining diff on top of rolling_mean. '
      + '"Dollar is weak" maps to DXY_SCORE >= 1, the pre-computed regime score with persistence.',
    concepts: ['metric chaining', 'diff', 'rolling_mean', 'DXY_SCORE', 'ambiguity resolution'],
  },
  {
    title: 'Liquidity-driven accumulation',
    prompt: 'Accumulate when US net liquidity year-over-year is positive and the liquidity score is at least 2.',
    explanation:
      'Uses both a raw derived series (US_LIQ_YOY) and the composite score (LIQ_SCORE) to double-confirm '
      + 'that the liquidity backdrop is supportive before signaling.',
    concepts: ['derived series', 'score threshold', 'gte comparator'],
  },
  {
    title: 'Multi-factor macro filter',
    prompt: 'Signal ON when the business cycle score is at least 1, liquidity score is at least 1, and the valuation score is at least 2.',
    explanation:
      'Combines three CoinStrat scores with AND logic. No derived metrics needed — just direct comparisons on pre-computed signals. '
      + 'A good example of a "score stacking" approach.',
    concepts: ['multiple scores', 'identity operator', 'all-mode output'],
  },
  {
    title: 'Mean-reversion setup',
    prompt: 'Alert me when MVRV drops below its 90-day rolling minimum plus 0.1.',
    explanation:
      'Detects when MVRV is near or below its recent floor. Uses rolling_min to establish a baseline, '
      + 'then compares the raw value against a shifted version of that floor. Tests metric-vs-metric comparison with a constant offset.',
    concepts: ['rolling_min', 'reference comparison', 'on-chain series'],
  },
  {
    title: 'STH cost-basis reclaim',
    prompt: 'Alert me when BTC rises above the short-term holder realized price and MVRV is below 2.5.',
    explanation:
      'Uses the new short-term holder realized price feed as an on-chain support/resistance anchor. '
      + 'This is a good example of combining spot-price structure with a valuation filter.',
    concepts: ['STH_REALIZED_PRICE', 'reference comparison', 'on-chain support', 'MVRV'],
  },
  {
    title: 'Holder cost-basis spread',
    prompt: 'Signal ON when the short-term holder realized price is above the long-term holder realized price and BTC is above the long-term holder realized price.',
    explanation:
      'Shows that you can reference multiple on-chain price anchors directly, without first turning them into scores. '
      + 'This kind of setup can be useful for tracking whether recent holders and long-term holders are both in a constructive regime.',
    concepts: ['STH_REALIZED_PRICE', 'LTH_REALIZED_PRICE', 'multi-source comparison', 'on-chain valuation'],
  },
  {
    title: 'Rate-of-change momentum',
    prompt: 'Signal ON when the 30-day percent change in US net liquidity is above 2% and BTC is above its 50-day moving average.',
    explanation:
      'Uses pct_change to measure liquidity momentum over a specific window, combined with a classic price trend filter. '
      + 'Demonstrates the scale parameter (percent vs ratio) on pct_change.',
    concepts: ['pct_change', 'scale: percent', 'rolling_mean', 'cross-domain conditions'],
  },
  {
    title: 'Monthly Stochastic RSI reclaim',
    prompt: 'Alert me when the bitcoin monthly stochastic RSI moves back above 20.',
    explanation:
      'Uses a month-end resampled BTC series, computes monthly Stochastic RSI, and triggers only when the completed monthly value crosses back above 20. '
      + 'The latest completed monthly value is then forward-filled onto daily rows for preview and alert state display.',
    concepts: ['stoch_rsi', 'timeframe: month', 'crosses_above', 'month-end signals'],
  },
  {
    title: 'Monthly Stochastic RSI threshold',
    prompt: 'Alert me when the bitcoin monthly stochastic RSI is above 20.',
    explanation:
      'Uses the latest completed monthly Stochastic RSI value and keeps that state active on daily rows until the next monthly close updates it. '
      + 'In practice, that means the signal can stay ON for the whole month after the last completed monthly value is above 20.',
    concepts: ['stoch_rsi', 'timeframe: month', 'gt comparator', 'completed month only'],
  },
  {
    title: 'OR logic (any condition)',
    prompt: 'Alert me when either the valuation score is 3 (deep value) or BTC crosses below its 200-day moving average.',
    explanation:
      'Uses OR (any) output mode instead of the default AND. The signal fires when at least one condition is true. '
      + 'Also demonstrates the crosses_below comparator for detecting a specific transition.',
    concepts: ['any-mode output', 'crosses_below', 'eq comparator', 'OR logic'],
  },
  {
    title: 'G3 global liquidity regime',
    prompt: 'Accumulate when G3 central bank assets year-over-year growth is positive and the dollar score is at least 1.',
    explanation:
      'Goes beyond US-only data by using the G3 (Fed + ECB + BOJ) composite. Pairs global liquidity expansion with '
      + 'a favorable dollar regime for a macro-aligned accumulation signal.',
    concepts: ['G3_YOY', 'DXY_SCORE', 'global macro', 'constant comparison'],
  },
];

// ---------------------------------------------------------------------------
// Series group icons (shared with StrategyBuilder)
// ---------------------------------------------------------------------------

function seriesGroupIcon(group: string) {
  const sz = 15;
  const cls = 'opacity-60';
  switch (group) {
    case 'market':
      return <DollarSign size={sz} className={cls} />;
    case 'valuation':
      return <Link2 size={sz} className={cls} />;
    case 'liquidity':
      return <Droplets size={sz} className={cls} />;
    case 'macro':
      return <TrendingUp size={sz} className={cls} />;
    case 'fx':
      return <ArrowLeftRight size={sz} className={cls} />;
    case 'scores':
      return <Gauge size={sz} className={cls} />;
    case 'signals':
      return <Radio size={sz} className={cls} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Series detail modal (self-contained; no nesting issue on a page)
// ---------------------------------------------------------------------------

function formatSeriesValue(value: number | null, key: string): string {
  if (value == null) return '—';
  if (['BTCUSD', 'STH_REALIZED_PRICE', 'LTH_REALIZED_PRICE'].includes(key)) {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    });
  }
  if (['CORE_ON', 'MACRO_ON', 'ACCUM_ON', 'PRICE_REGIME_ON', 'SIP_EXHAUSTED'].includes(key)) {
    return value === 1 ? 'ON' : 'OFF';
  }
  if (['VAL_SCORE', 'LIQ_SCORE', 'DXY_SCORE', 'CYCLE_SCORE'].includes(key)) return String(value);
  if (['SIP', 'US_LIQ_YOY', 'G3_YOY'].includes(key)) return `${value.toFixed(2)}%`;
  if (['WALCL', 'WTREGEN', 'RRPONTSYD', 'US_LIQ', 'US_LIQ_13W_DELTA', 'ECB_RAW', 'BOJ_RAW', 'G3_ASSETS'].includes(key)) {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return value.toLocaleString();
  }
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(Math.abs(value) < 10 ? 4 : 2);
}

interface SeriesDetailModalProps {
  open: boolean;
  onClose: () => void;
  seriesKey: string | null;
  accessToken: string | null;
  isSmDown: boolean;
}

function SeriesDetailModal({ open, onClose, seriesKey, accessToken, isSmDown }: SeriesDetailModalProps) {
  const [data, setData] = useState<Array<{ d: string; v: number | null }>>([]);
  const [latest, setLatest] = useState<{ d: string; v: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = useMemo(
    () => (seriesKey ? STRATEGY_SERIES_CATALOG.find((e) => e.key === seriesKey) ?? null : null),
    [seriesKey],
  );

  React.useEffect(() => {
    if (!open || !seriesKey || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData([]);
    setLatest(null);

    fetch(`/api/pro/series-detail?key=${encodeURIComponent(seriesKey)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load series data.');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json.data ?? []);
        setLatest(json.latest ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load series.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, seriesKey, accessToken]);

  const chartData = useMemo(() => {
    if (!data.length) return [];
    return data.filter((r) => r.v != null).map((r) => ({ date: r.d, ts: new Date(r.d).getTime(), value: r.v! }));
  }, [data]);

  const lastPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const yDomain = useMemo(() => {
    if (!chartData.length) return [0, 1] as [number, number];
    let min = Infinity;
    let max = -Infinity;
    for (const p of chartData) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    const pad = (max - min) * 0.05 || 1;
    return [min - pad, max + pad] as [number, number];
  }, [chartData]);

  return (
    <Dialog open={open} onClose={onClose} fullScreen={isSmDown} fullWidth maxWidth="md"
      PaperProps={{ sx: { bgcolor: 'background.paper', m: isSmDown ? 0 : 2, width: isSmDown ? '100%' : undefined, maxHeight: isSmDown ? '100%' : 'calc(100% - 32px)' } }}
    >
      <DialogContent sx={{ p: isSmDown ? 1.5 : 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant={isSmDown ? 'h6' : 'h5'} sx={{ fontWeight: 900 }}>{meta?.label ?? seriesKey}</Typography>
              {meta && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{meta.description}</Typography>}
              {meta && (
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                  <Chip label={meta.kind} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
                  <Chip label={meta.group} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
                </Stack>
              )}
            </Box>
            <IconButton onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
          </Stack>
          {latest && (
            <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'baseline', gap: 1.5, borderColor: 'primary.main', bgcolor: 'rgba(96,165,250,0.06)' }}>
              <Typography variant="overline" sx={{ fontWeight: 700 }}>Latest ({latest.d})</Typography>
              <Typography variant="h5" sx={{ fontWeight: 900, fontFamily: 'monospace' }}>{formatSeriesValue(latest.v, seriesKey ?? '')}</Typography>
            </Paper>
          )}
          {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={32} /></Box>}
          {error && <Alert severity="error">{error}</Alert>}
          {!loading && !error && chartData.length > 0 && (
            <Box sx={{ width: '100%', height: isSmDown ? '50vh' : 340 }}>
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs><linearGradient id="seriesGradDoc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} /><stop offset="95%" stopColor="#60a5fa" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                  <XAxis dataKey="ts" scale="time" type="number" domain={['dataMin', 'dataMax']}
                    tickFormatter={(ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }}
                    tick={{ fontSize: 11 }} minTickGap={40} />
                  <YAxis domain={yDomain} tick={{ fontSize: 11 }} width={60} />
                  <Tooltip labelFormatter={(ts: number) => new Date(ts).toISOString().slice(0, 10)}
                    formatter={(v: number) => [formatSeriesValue(v, seriesKey ?? ''), meta?.label ?? seriesKey]}
                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.92)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, fontSize: 13 }} />
                  <Area type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={1.8} fill="url(#seriesGradDoc)" dot={false} activeDot={{ r: 4, stroke: '#60a5fa', strokeWidth: 2, fill: '#0f172a' }} />
                  {lastPoint && <ReferenceDot x={lastPoint.ts} y={lastPoint.value} r={6} fill="#60a5fa" stroke="#fff" strokeWidth={2} />}
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
          {!loading && !error && chartData.length === 0 && data.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No historical data available for this series.</Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const CARD_SX = { borderColor: 'rgba(148,163,184,0.35)', background: 'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)', boxShadow: 'none' } as const;

const SECTION_TABS = [
  { label: 'Overview' },
  { label: 'Series' },
  { label: 'Reference' },
  { label: 'Examples' },
] as const;

const DocsSignalBuilder: React.FC = () => {
  const { session } = useAuth();
  const theme = useTheme();
  const isSmDown = useMediaQuery(theme.breakpoints.down('sm'));
  const groupedSeries = useMemo(() => getGroupedSeries(), []);
  const [seriesModalOpen, setSeriesModalOpen] = useState(false);
  const [seriesModalKey, setSeriesModalKey] = useState<string | null>(null);
  const [sectionIdx, setSectionIdx] = useState(0);
  const hasPaidAccess = !!session?.access_token;

  const openSeriesDetail = useCallback((key: string) => {
    setSeriesModalKey(key);
    setSeriesModalOpen(true);
  }, []);

  return (
    <DocsPageLayout>
      <Stack spacing={3}>
        {/* Header */}
        <Box>
          <Typography variant="h3" component="h1" sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}>
            Signal Builder
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 760 }}>
            The Signal Builder lets you describe a strategy in plain English. CoinStrat turns that into a constrained,
            reviewable strategy spec that you can preview, backtest, save, and set alerts on — no code required.
          </Typography>
        </Box>

        {/* Section tabs */}
        <Tabs
          value={sectionIdx}
          onChange={(_, v: number) => setSectionIdx(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 42 },
          }}
        >
          {SECTION_TABS.map((t) => (
            <Tab key={t.label} label={t.label} />
          ))}
        </Tabs>

        {/* ---- Tab 0: Overview ---- */}
        {sectionIdx === 0 && (
          <>
            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>How it works</Typography>
                  <Stack component="ol" spacing={1.25} sx={{ pl: 2.5 }}>
                    {[
                      ['Describe', 'Write what you want in the text box. For example: "Alert me when BTC is above its 200-day MA and the dollar is weak."'],
                      ['Interpret', 'CoinStrat sends your prompt to an LLM (with guardrails) that translates it into a structured JSON spec using only the approved series and operators.'],
                      ['Review', 'You can inspect the generated strategy blocks, edit the JSON directly, and fix anything the model got wrong.'],
                      ['Preview', 'Run the strategy against the cached signal dataset to see how the signal would have behaved historically, including state transitions and current snapshot values.'],
                      ['Save & alert', 'Save the strategy to your account. Optionally enable email alerts that notify you when the signal flips.'],
                    ].map(([title, body]) => (
                      <Typography component="li" variant="body2" key={title} sx={{ lineHeight: 1.75 }}>
                        <strong>{title}.</strong> {body}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>Anatomy of a strategy</Typography>
                  <Typography variant="body2" sx={{ lineHeight: 1.75 }}>
                    Every strategy spec has four layers that build on each other:
                  </Typography>
                  <Stack spacing={1.5}>
                    {[
                      { badge: 'Sources', desc: `Raw data feeds selected from the catalog (max ${STRATEGY_LIMITS.maxSources}). Each source is assigned an id you can reference later.` },
                      { badge: 'Metrics', desc: `Derived values computed from sources or other metrics using the operators (max ${STRATEGY_LIMITS.maxMetrics}). Metrics can chain \u2014 e.g. you can compute a diff of a rolling_mean to detect whether a moving average is rising.` },
                      { badge: 'Conditions', desc: `Boolean tests that compare a source or metric against a constant or another reference using a comparator (max ${STRATEGY_LIMITS.maxConditions}). Optional persistence filters let you require a condition to be true for N of the last M days.` },
                      { badge: 'Output', desc: 'Combines conditions with AND (all) or OR (any) logic to produce the final binary signal (1 = on, 0 = off).' },
                    ].map(({ badge, desc }) => (
                      <Box key={badge} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.15)' }}>
                        <Chip label={badge} size="small" sx={{ fontWeight: 700, mb: 0.5 }} />
                        <Typography variant="body2" sx={{ lineHeight: 1.75 }}>{desc}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}

        {/* ---- Tab 1: Series ---- */}
        {sectionIdx === 1 && (
          <Card sx={CARD_SX}>
            <CardContent>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>Available series</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    The builder only uses the approved series below. {hasPaidAccess ? 'Click any series to view its historical chart and latest value.' : 'Sign in with a Pro account to view historical charts.'}
                  </Typography>
                </Box>
                {groupedSeries.map((g) => (
                  <Box key={g.group}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
                      {seriesGroupIcon(g.group)}
                      <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1 }}>{g.label}</Typography>
                    </Stack>
                    <Stack spacing={0.75}>
                      {g.series.map((entry) => (
                        <Box
                          key={entry.key}
                          sx={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 1.5,
                            px: 2,
                            py: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            bgcolor: 'rgba(2,6,23,0.15)',
                            cursor: hasPaidAccess ? 'pointer' : 'default',
                            '&:hover': hasPaidAccess ? { borderColor: 'primary.main', bgcolor: 'rgba(96,165,250,0.06)' } : {},
                          }}
                          onClick={hasPaidAccess ? () => openSeriesDetail(entry.key) : undefined}
                        >
                          <Chip label={entry.key} size="small" sx={{ fontFamily: 'monospace', fontWeight: 700, minWidth: 110 }} />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{entry.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{entry.description}</Typography>
                          </Box>
                          <Chip label={entry.kind} size="small" variant="outlined" sx={{ textTransform: 'capitalize', fontSize: 11 }} />
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* ---- Tab 2: Reference (operators, comparators, limits) ---- */}
        {sectionIdx === 2 && (
          <>
            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 900 }}>Metric operators</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Operators transform a source or metric into a derived value. Metrics can chain — the input of one metric can be the output of another.
                    </Typography>
                  </Box>
                  {OPERATOR_DOCS.map((op) => (
                    <Box key={op.key} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.5, bgcolor: 'rgba(2,6,23,0.15)' }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={0.75} sx={{ mb: 0.75 }}>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>{op.label}</Typography>
                        <Chip label={op.key} size="small" sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
                      </Stack>
                      <Typography variant="body2" sx={{ lineHeight: 1.75, mb: 1 }}>{op.description}</Typography>
                      {op.requiredFields.length > 0 && (
                        <Box sx={{ mb: 1 }}>
                          <Typography variant="overline" color="text.secondary">Required fields</Typography>
                          <Stack component="ul" spacing={0.25} sx={{ pl: 2, mt: 0.25 }}>
                            {op.requiredFields.map((field) => (
                              <Typography component="li" variant="body2" key={field} sx={{ fontFamily: 'monospace', fontSize: 13 }}>{field}</Typography>
                            ))}
                          </Stack>
                        </Box>
                      )}
                      <Box>
                        <Typography variant="overline" color="text.secondary">Example</Typography>
                        <Typography variant="body2" sx={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          fontSize: 13,
                          bgcolor: 'rgba(0,0,0,0.25)',
                          px: 1.5,
                          py: 0.75,
                          borderRadius: 1,
                          mt: 0.25,
                        }}>
                          {op.example}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 900 }}>Condition comparators</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Conditions compare the left operand (a source or metric) against a constant or another reference.
                    </Typography>
                  </Box>
                  <Stack spacing={0.75}>
                    {COMPARATOR_DOCS.map((c) => (
                      <Stack key={c.key} direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(2,6,23,0.15)' }}>
                        <Chip label={c.symbol} size="small" sx={{ fontFamily: 'monospace', fontWeight: 800, minWidth: 70, justifyContent: 'center' }} />
                        <Chip label={c.key} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: 12, minWidth: 100 }} />
                        <Typography variant="body2" sx={{ flex: 1 }}>{c.label}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>Limits</Typography>
                  <Stack spacing={0.75}>
                    {[
                      ['Max sources', String(STRATEGY_LIMITS.maxSources)],
                      ['Max metrics', String(STRATEGY_LIMITS.maxMetrics)],
                      ['Max conditions', String(STRATEGY_LIMITS.maxConditions)],
                      ['Max window / periods', String(STRATEGY_LIMITS.maxWindow)],
                      ['Max lookback (persistence)', `${STRATEGY_LIMITS.maxLookbackDays} days`],
                    ].map(([label, val]) => (
                      <Stack key={label} direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(2,6,23,0.15)' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
                        <Chip label={val} size="small" sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}

        {/* ---- Tab 3: Examples (tips + example prompts) ---- */}
        {sectionIdx === 3 && (
          <>
            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>Tips for writing prompts</Typography>
                  <Stack component="ul" spacing={1} sx={{ pl: 2 }}>
                    {[
                      'Be specific about time windows: "200-day moving average" is better than "long-term average".',
                      'Name the series when possible: "MVRV below 2" is clearer than "valuation is cheap".',
                      'For ambiguous concepts like "dollar is weak", the LLM will default to DXY_SCORE >= 1 (CoinStrat\'s pre-computed dollar regime score).',
                      'Use "and" for conditions that must all be true, "or" for conditions where any one is sufficient.',
                      'To detect a rising moving average, the model will use diff(rolling_mean, periods=1) > 0.',
                      'For monthly or weekly indicators, CoinStrat computes only on completed period-end bars and forward-fills the latest completed value into the daily preview.',
                      'Comparisons on monthly or weekly metrics use the latest completed period value and stay in effect until the next completed period updates them.',
                      'You can always review and edit the generated JSON before saving.',
                    ].map((tip) => (
                      <Typography component="li" variant="body2" key={tip} sx={{ lineHeight: 1.75 }}>{tip}</Typography>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card sx={CARD_SX}>
              <CardContent>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 900 }}>Example prompts</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Copy any of these into the builder to see how the LLM translates them. Each one highlights a different capability.
                    </Typography>
                  </Box>
                  {EXAMPLE_PROMPTS.map((ex) => (
                    <Box key={ex.title} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.5, bgcolor: 'rgba(2,6,23,0.15)' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>{ex.title}</Typography>
                      <Typography variant="body2" sx={{
                        fontStyle: 'italic',
                        bgcolor: 'rgba(0,0,0,0.25)',
                        px: 1.5,
                        py: 1,
                        borderRadius: 1,
                        lineHeight: 1.75,
                        mb: 1,
                      }}>
                        &ldquo;{ex.prompt}&rdquo;
                      </Typography>
                      <Typography variant="body2" sx={{ lineHeight: 1.75, mb: 1 }}>{ex.explanation}</Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {ex.concepts.map((concept) => (
                          <Chip key={concept} label={concept} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                        ))}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </>
        )}

        <DocsPager />
      </Stack>

      <SeriesDetailModal
        open={seriesModalOpen}
        onClose={() => setSeriesModalOpen(false)}
        seriesKey={seriesModalKey}
        accessToken={session?.access_token ?? null}
        isSmDown={isSmDown}
      />
    </DocsPageLayout>
  );
};

export default DocsSignalBuilder;
