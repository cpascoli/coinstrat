import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Link as RouterLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { ArrowRight, FlaskConical, Gauge, Layers, LineChart } from 'lucide-react';
import type { SignalData } from '../../App';
import ChartsView, { type ChartsSection, type RangeKey } from '../ChartsView';
import Backtest from '../Backtest';
import MemberGate from '../../components/MemberGate';
import {
  MODELS,
  getModel,
  modelTabs,
  type FactorGroup,
  type ModelDef,
  type ModelState,
} from '../../models/registry';
import { INDICATOR_CATEGORIES } from '../../indicators/registry';
import { CQM_RISK_GRADIENT_CSS, colorAtRisk } from '../../utils/cqmRiskGradient';

interface AreaProps {
  data: SignalData[];
  onOpenAuth?: () => void;
}

function toneColor(tone: ModelState['tone']): { border: string; text: string; wash: string } {
  switch (tone) {
    case 'pos':
      return { border: '#22c55e', text: '#bbf7d0', wash: 'rgba(34,197,94,0.10)' };
    case 'neg':
      return { border: '#ef4444', text: '#fecaca', wash: 'rgba(239,68,68,0.10)' };
    case 'neutral':
      return { border: '#94a3b8', text: '#e2e8f0', wash: 'rgba(148,163,184,0.08)' };
    default: {
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
}

const StateBadge: React.FC<{ state: ModelState | null }> = ({ state }) => {
  if (!state) return <Chip size="small" label="—" variant="outlined" />;
  const c = toneColor(state.tone);
  return <Chip size="small" label={state.headline} variant="outlined" sx={{ borderColor: c.border, color: c.text, fontWeight: 700 }} />;
};

const DeltaChip: React.FC<{ delta: NonNullable<ModelState['delta']> }> = ({ delta }) => {
  const c = toneColor(delta.tone);
  return (
    <Chip
      size="small"
      label={delta.text}
      sx={{ bgcolor: c.wash, color: c.text, fontWeight: 700, fontSize: 11 }}
    />
  );
};

const StateMetrics: React.FC<{ state: ModelState | null }> = ({ state }) => {
  if (!state) return null;
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {state.metrics.map((m) => (
        <Chip key={m.label} size="small" label={`${m.label}: ${m.value}`} sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#cbd5e1' }} />
      ))}
    </Stack>
  );
};

/** Minimal inline sparkline: a stroked line with a soft area fill underneath. */
const Sparkline: React.FC<{ values: number[]; color: string; label?: string; height?: number }> = ({
  values,
  color,
  label,
  height = 44,
}) => {
  if (values.length < 2) return null;
  const w = 240;
  const h = 40;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;

  return (
    <Box>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
        <polygon points={area} fill={color} opacity={0.10} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {label}
        </Typography>
      )}
    </Box>
  );
};

/** Horizontal green→red risk scale with a marker at the current reading. */
const RiskScaleBar: React.FC<{ pct: number }> = ({ pct }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <Box>
      <Box sx={{ position: 'relative', height: 12, borderRadius: 6, background: CQM_RISK_GRADIENT_CSS }}>
        <Box
          sx={{
            position: 'absolute',
            left: `${clamped}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '3px solid #f8fafc',
            bgcolor: colorAtRisk(clamped),
            boxShadow: '0 1px 6px rgba(0,0,0,0.55)',
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">0% · deep value</Typography>
        <Typography variant="caption" color="text.secondary">100% · euphoria</Typography>
      </Box>
    </Box>
  );
};

/** One-line live market read across the model suite. */
const SystemStrip: React.FC<{ data: SignalData[]; states: Map<string, ModelState | null> }> = ({ data, states }) => {
  const last = data.length ? data[data.length - 1] : null;
  const weekAgo = data.length > 7 ? data[data.length - 8] : null;
  const btc = Number(last?.BTCUSD);
  const btcPrev = Number(weekAgo?.BTCUSD);
  const btcWow = Number.isFinite(btc) && Number.isFinite(btcPrev) && btcPrev > 0
    ? ((btc - btcPrev) / btcPrev) * 100
    : null;

  if (!last) return null;

  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.35)' }}>
      <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" alignItems="center">
        {Number.isFinite(btc) && (
          <Typography variant="body2" sx={{ fontWeight: 800, color: '#f8fafc' }}>
            BTC ${Math.round(btc).toLocaleString()}
            {btcWow !== null && (
              <Typography component="span" variant="body2" sx={{ ml: 0.75, fontWeight: 700, color: btcWow >= 0 ? '#4ade80' : '#f87171' }}>
                {btcWow >= 0 ? '+' : ''}{btcWow.toFixed(1)}% 7d
              </Typography>
            )}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {MODELS.map((model) => {
          const state = states.get(model.id);
          if (!state) return null;
          const c = toneColor(state.tone);
          return (
            <Chip
              key={model.id}
              size="small"
              component={RouterLink}
              to={`/models/${model.id}`}
              clickable
              label={`${model.shortName}: ${state.headline}`}
              sx={{ borderColor: c.border, color: c.text, fontWeight: 700, bgcolor: c.wash }}
              variant="outlined"
            />
          );
        })}
        <Typography variant="caption" color="text.secondary">data through {last.Date}</Typography>
      </Stack>
    </Paper>
  );
};

const cardHoverSx = {
  transition: 'transform 140ms ease, box-shadow 140ms ease',
  '&:hover': { transform: 'translateY(-3px)', boxShadow: 8 },
} as const;

const FeaturedModelCard: React.FC<{ model: ModelDef; state: ModelState | null }> = ({ model, state }) => {
  const Icon = model.Icon;
  const tone = state ? toneColor(state.tone) : null;
  return (
    <Paper
      sx={{
        p: { xs: 2.5, md: 3 },
        borderLeft: `3px solid ${tone?.border ?? 'transparent'}`,
        backgroundImage: tone ? `linear-gradient(155deg, ${tone.wash} 0%, rgba(15,23,42,0) 55%)` : undefined,
        ...cardHoverSx,
      }}
    >
      <Box sx={{ display: 'grid', gap: { xs: 2.5, md: 4 }, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Icon size={24} color={model.accent} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{model.name}</Typography>
            <Chip size="small" label="flagship" sx={{ bgcolor: 'rgba(167,139,250,0.18)', color: '#ddd6fe', fontWeight: 700 }} />
            {model.status === 'beta' && <Chip size="small" label="beta" />}
            <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
              <StateBadge state={state} />
              {state?.delta && <DeltaChip delta={state.delta} />}
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary">{model.tagline}</Typography>
          <StateMetrics state={state} />
          {typeof state?.gaugePct === 'number' && (
            <Box sx={{ mt: 0.5 }}>
              <RiskScaleBar pct={state.gaugePct} />
            </Box>
          )}
          <Box>
            <Button component={RouterLink} to={`/models/${model.id}`} variant="contained" sx={{ mt: 0.5, fontWeight: 700 }}>
              Open {model.shortName}
            </Button>
          </Box>
        </Box>
        {state?.spark && state.spark.values.length > 1 && (
          <Box>
            <Sparkline
              values={state.spark.values}
              color={typeof state.gaugePct === 'number' ? colorAtRisk(state.gaugePct) : model.accent}
              label={state.spark.label}
              height={92}
            />
          </Box>
        )}
      </Box>
    </Paper>
  );
};

const ModelCard: React.FC<{ model: ModelDef; state: ModelState | null }> = ({ model, state }) => {
  const Icon = model.Icon;
  const tone = state ? toneColor(state.tone) : null;
  return (
    <Paper
      sx={{
        p: 2.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        height: '100%',
        borderLeft: `3px solid ${tone?.border ?? 'transparent'}`,
        backgroundImage: tone ? `linear-gradient(165deg, ${tone.wash} 0%, rgba(15,23,42,0) 50%)` : undefined,
        ...cardHoverSx,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Icon size={22} color={model.accent} />
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{model.name}</Typography>
        {model.status === 'beta' && <Chip size="small" label="beta" sx={{ ml: 'auto' }} />}
      </Box>
      <Typography variant="body2" color="text.secondary">{model.tagline}</Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <StateBadge state={state} />
        {state?.delta && <DeltaChip delta={state.delta} />}
      </Box>
      <StateMetrics state={state} />
      {state?.spark && state.spark.values.length > 1 && (
        <Sparkline values={state.spark.values} color={model.accent} label={state.spark.label} />
      )}
      <Box sx={{ flex: 1 }} />
      <Button component={RouterLink} to={`/models/${model.id}`} variant="contained" sx={{ fontWeight: 700 }}>
        Open {model.shortName}
      </Button>
    </Paper>
  );
};

interface PipelineStep {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  to?: string;
  linkLabel?: string;
}

const PipelinePaper: React.FC = () => {
  const steps: PipelineStep[] = [
    {
      icon: <LineChart size={20} color="#60a5fa" />,
      title: 'Indicators',
      blurb: 'A shared library of market, on-chain and macro series.',
      to: '/indicators',
      linkLabel: 'Browse catalog',
    },
    {
      icon: <Gauge size={20} color="#a78bfa" />,
      title: 'Models',
      blurb: 'Each model distills the indicators into one live market state.',
    },
    {
      icon: <FlaskConical size={20} color="#2dd4bf" />,
      title: 'Strategy Lab',
      blurb: 'Backtest the models head-to-head and turn state into sizing.',
      to: '/lab',
      linkLabel: 'Open the Lab',
    },
  ];

  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>How it fits together</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="stretch">
        {steps.map((step, i) => (
          <React.Fragment key={step.title}>
            {i > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', px: 0.5, transform: { xs: 'rotate(90deg)', sm: 'none' } }}>
                <ArrowRight size={18} color="#475569" />
              </Box>
            )}
            <Box
              sx={{
                flex: 1,
                p: 1.75,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'rgba(2,6,23,0.25)',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {step.icon}
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{step.title}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, lineHeight: 1.6 }}>
                {step.blurb}
              </Typography>
              {step.to && (
                <MuiLink component={RouterLink} to={step.to} sx={{ fontSize: 13, fontWeight: 700 }}>
                  {step.linkLabel} →
                </MuiLink>
              )}
            </Box>
          </React.Fragment>
        ))}
      </Stack>
    </Paper>
  );
};

const HubSkeleton: React.FC = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <Skeleton variant="rounded" height={48} />
    <Skeleton variant="rounded" height={220} />
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      <Skeleton variant="rounded" height={300} />
      <Skeleton variant="rounded" height={300} />
    </Box>
  </Box>
);

const ModelsHub: React.FC<AreaProps> = ({ data }) => {
  // currentState can be expensive (the CQM fit), so compute once per data load
  // and share between the strip and the cards.
  const states = useMemo(() => {
    const map = new Map<string, ModelState | null>();
    for (const model of MODELS) {
      try {
        map.set(model.id, model.currentState(data));
      } catch {
        map.set(model.id, null);
      }
    }
    return map;
  }, [data]);

  const featured = MODELS.find((m) => m.featured) ?? null;
  const rest = MODELS.filter((m) => m !== featured);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Layers className="h-8 w-8 text-blue-600" />
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>Models</Typography>
          <Typography variant="body2" color="text.secondary">
            CoinStrat is a suite of Bitcoin models. Explore each model&apos;s charts, factors and docs.
          </Typography>
        </Box>
      </Box>

      {data.length === 0 ? (
        <HubSkeleton />
      ) : (
        <>
          <SystemStrip data={data} states={states} />

          {featured && <FeaturedModelCard model={featured} state={states.get(featured.id) ?? null} />}

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            {rest.map((model) => (
              <ModelCard key={model.id} model={model} state={states.get(model.id) ?? null} />
            ))}
          </Box>
        </>
      )}

      <PipelinePaper />
    </Box>
  );
};

const ModelOverview: React.FC<{ model: ModelDef; data: SignalData[]; onOpenAuth?: () => void }> = ({ model, data, onOpenAuth }) => {
  const current = data.length ? data[data.length - 1] : null;

  if (model.OverviewComponent && current) {
    const Custom = model.OverviewComponent;
    const node = <Custom current={current} history={data} />;
    return model.overviewGated ? <MemberGate onOpenAuth={onOpenAuth}>{node}</MemberGate> : node;
  }

  const state = model.currentState(data);
  const Extra = model.OverviewExtra;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>About this model</Typography>
        {model.summary.map((p, i) => (
          <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.8 }}>{p}</Typography>
        ))}
      </Paper>
      {Extra && current ? (
        <Extra current={current} history={data} />
      ) : (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>Current state</Typography>
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            <StateBadge state={state} />
          </Stack>
          <StateMetrics state={state} />
        </Paper>
      )}
    </Box>
  );
};

const FactorGroupBlock: React.FC<{ group: FactorGroup; data: SignalData[]; renderSections: ChartsSection[] }> = ({ group, data, renderSections }) => {
  const current = data.length ? data[data.length - 1] : null;
  const rawValue = group.scoreField && current ? Number(current[group.scoreField]) : NaN;
  const hasBadge = group.scoreField && Number.isFinite(rawValue);
  const badge = hasBadge
    ? `${rawValue.toFixed(0)}${group.scoreMax ? ` / ${group.scoreMax}` : ''}`
    : null;

  const indicatorLink = useMemo(() => {
    const cat = INDICATOR_CATEGORIES.find((c) => group.sections.includes(c.section));
    return cat ? `/indicators/${cat.id}` : null;
  }, [group.sections]);

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: group.blurb ? 0.5 : 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{group.label}</Typography>
        {badge && (
          <Chip size="small" label={badge} sx={{ bgcolor: 'rgba(96,165,250,0.18)', color: '#bfdbfe', fontWeight: 800 }} />
        )}
        {indicatorLink && (
          <MuiLink component={RouterLink} to={indicatorLink} sx={{ ml: 'auto', fontSize: 13, fontWeight: 700 }}>
            View full indicator →
          </MuiLink>
        )}
      </Box>
      {group.blurb && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: renderSections.length ? 1.5 : 0 }}>{group.blurb}</Typography>
      )}
      {renderSections.length > 0 ? (
        <ChartsView data={data} sections={renderSections} embedded showRange={false} />
      ) : (
        <Typography variant="caption" color="text.secondary">Charts for this group are shown above under a related factor.</Typography>
      )}
    </Paper>
  );
};

const ModelFactors: React.FC<{ model: ModelDef; data: SignalData[] }> = ({ model, data }) => {
  // Render each underlying chart section only once, even when multiple factor
  // groups (e.g. on-chain value + capitulation) read from the same section.
  const shown = new Set<ChartsSection>();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        The charts below are the market indicators this model consumes, grouped by how they feed the model.
        Each group shows its live contribution where the model exposes a sub-score.
      </Typography>
      {(model.factorGroups ?? []).map((group) => {
        const renderSections = group.sections.filter((s) => !shown.has(s));
        renderSections.forEach((s) => shown.add(s));
        return <FactorGroupBlock key={group.label} group={group} data={data} renderSections={renderSections} />;
      })}
    </Box>
  );
};

const ModelChartTabs: React.FC<{ tabs: NonNullable<ModelDef['chartTabs']>; data: SignalData[] }> = ({ tabs, data }) => {
  const [active, setActive] = React.useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Visually separate the chart sub-tabs from the model-level tabs above. */}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, bgcolor: 'rgba(2,6,23,0.20)' }}>
        <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.12em', color: 'text.secondary' }}>
          Chart explorer
        </Typography>
        <Tabs
          value={Math.min(active, tabs.length - 1)}
          onChange={(_, v: number) => setActive(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ borderBottom: 1, borderColor: 'divider', mt: 0.5, '& .MuiTab-root': { fontWeight: 700, textTransform: 'none' } }}
        >
          {tabs.map((t) => (
            <Tab key={t.label} label={t.label} />
          ))}
        </Tabs>
        {current.blurb && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {current.blurb}
          </Typography>
        )}
      </Paper>
      <ChartsView data={data} chartIds={current.chartIds} embedded />
    </Box>
  );
};

/**
 * Renders a model's curated Charts tab in the exact order of `chartIds` (each as
 * its own embedded single-chart ChartsView), driven by one shared range toggle.
 * Needed because a single ChartsView renders charts in fixed file order.
 */
const OrderedModelCharts: React.FC<{ data: SignalData[]; chartIds: string[] }> = ({ data, chartIds }) => {
  const [range, setRange] = useState<RangeKey>('all');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ToggleButtonGroup color="primary" exclusive value={range} onChange={(_, v: RangeKey | null) => v && setRange(v)} size="small">
          <ToggleButton value="1y">1Y</ToggleButton>
          <ToggleButton value="2y">2Y</ToggleButton>
          <ToggleButton value="5y">5Y</ToggleButton>
          <ToggleButton value="10y">10Y</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {chartIds.map((id) => (
        <ChartsView key={id} data={data} chartIds={[id]} embedded showRange={false} range={range} onRangeChange={setRange} />
      ))}
    </Box>
  );
};

const ModelLayout: React.FC<AreaProps> = ({ data, onOpenAuth }) => {
  const { modelId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const model = getModel(modelId);

  if (!model) return <Navigate to="/models" replace />;

  const tabs = modelTabs(model);
  const base = `/models/${model.id}`;
  const rest = location.pathname.slice(base.length).replace(/^\//, '');
  const activeSegment = rest.split('/')[0] ?? '';
  const activeTab = tabs.find((t) => t.segment === activeSegment) ?? tabs[0];
  const current = data.length ? data[data.length - 1] : null;
  const Icon = model.Icon;
  const signals = model.signals;
  const scores = model.scores;
  const DocsComponent = model.Docs;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
        <Icon size={26} className="text-blue-500" />
        <Box>
          <MuiLink component={RouterLink} to="/models" sx={{ fontSize: 12, fontWeight: 700 }}>Models</MuiLink>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>{model.name}</Typography>
        </Box>
      </Box>

      <Tabs
        value={activeTab.id}
        onChange={(_, id: string) => {
          const t = tabs.find((x) => x.id === id);
          navigate(t && t.segment ? `${base}/${t.segment}` : base);
        }}
        textColor="inherit"
        indicatorColor="primary"
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40 }}
      >
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} sx={{ minHeight: 40 }} />
        ))}
      </Tabs>

      <Routes>
        <Route index element={<ModelOverview model={model} data={data} onOpenAuth={onOpenAuth} />} />
        <Route
          path="charts"
          element={
            model.chartTabs && model.chartTabs.length ? (
              <ModelChartTabs tabs={model.chartTabs} data={data} />
            ) : model.chartIds && model.chartIds.length ? (
              <OrderedModelCharts data={data} chartIds={model.chartIds} />
            ) : (
              <ChartsView data={data} sections={model.chartSections} embedded />
            )
          }
        />
        {model.factorGroups && (
          <Route
            path="factors"
            element={
              model.FactorsComponent ? (
                <model.FactorsComponent data={data} />
              ) : (
                <ModelFactors model={model} data={data} />
              )
            }
          />
        )}
        {model.backtestVariant && (
          <Route path="backtest" element={<Backtest data={data} variant={model.backtestVariant} />} />
        )}
        {signals && (
          <Route
            path="signals"
            element={(() => {
              const Comp = signals.Component;
              const node = current ? <Comp current={current} /> : null;
              return signals.gated ? <MemberGate onOpenAuth={onOpenAuth}>{node}</MemberGate> : node;
            })()}
          />
        )}
        {scores && (
          <Route
            path="scores"
            element={(() => {
              const Comp = scores.Component;
              const node = current ? <Comp current={current} /> : null;
              return scores.gated ? <MemberGate onOpenAuth={onOpenAuth}>{node}</MemberGate> : node;
            })()}
          />
        )}
        <Route path="docs" element={<DocsComponent />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Box>
  );
};

const ModelsArea: React.FC<AreaProps> = ({ data, onOpenAuth }) => (
  <Routes>
    <Route index element={<ModelsHub data={data} onOpenAuth={onOpenAuth} />} />
    <Route path=":modelId/*" element={<ModelLayout data={data} onOpenAuth={onOpenAuth} />} />
    <Route path="*" element={<Navigate to="/models" replace />} />
  </Routes>
);

export default ModelsArea;
