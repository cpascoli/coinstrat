import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Stack,
  Tab,
  Tabs,
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
import { Layers } from 'lucide-react';
import type { SignalData } from '../../App';
import ChartsView, { type ChartsSection } from '../ChartsView';
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

interface AreaProps {
  data: SignalData[];
  onOpenAuth?: () => void;
}

function toneColor(tone: ModelState['tone']): { border: string; text: string } {
  switch (tone) {
    case 'pos':
      return { border: '#22c55e', text: '#bbf7d0' };
    case 'neg':
      return { border: '#ef4444', text: '#fecaca' };
    case 'neutral':
      return { border: '#94a3b8', text: '#e2e8f0' };
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

const ModelsHub: React.FC<AreaProps> = ({ data }) => (
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

    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
      {MODELS.map((model) => {
        const state = model.currentState(data);
        const Icon = model.Icon;
        return (
          <Paper key={model.id} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Icon size={22} className="text-blue-400" />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{model.name}</Typography>
              {model.status === 'beta' && <Chip size="small" label="beta" sx={{ ml: 'auto' }} />}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{model.tagline}</Typography>
            <StateBadge state={state} />
            <StateMetrics state={state} />
            <Button component={RouterLink} to={`/models/${model.id}`} variant="contained" sx={{ mt: 1, fontWeight: 700 }}>
              Open {model.shortName}
            </Button>
          </Paper>
        );
      })}
    </Box>

    <Paper sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>Shared building blocks</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        The models read from a shared library of market indicators, and can be compared head-to-head in the Lab.
      </Typography>
      <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
        <Button component={RouterLink} to="/indicators" variant="outlined" sx={{ fontWeight: 700 }}>Indicators catalog</Button>
        <Button component={RouterLink} to="/lab" variant="outlined" sx={{ fontWeight: 700 }}>Backtest Lab</Button>
      </Stack>
    </Paper>
  </Box>
);

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
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>About this model</Typography>
        {model.summary.map((p, i) => (
          <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.8 }}>{p}</Typography>
        ))}
        <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
          <Button component={RouterLink} to={`/models/${model.id}/charts`} variant="contained" sx={{ fontWeight: 700 }}>View charts</Button>
          {model.factorGroups && (
            <Button component={RouterLink} to={`/models/${model.id}/factors`} variant="outlined" sx={{ fontWeight: 700 }}>Factors</Button>
          )}
          <Button component={RouterLink} to="/lab" variant="outlined" sx={{ fontWeight: 700 }}>Compare in Lab</Button>
          <Button component={RouterLink} to={`/models/${model.id}/docs`} variant="text" sx={{ fontWeight: 700 }}>Docs</Button>
        </Stack>
      </Paper>
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
