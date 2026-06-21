import React, { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import {
  Activity,
  Anchor,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  FlaskConical,
  Layers,
  LayoutDashboard,
  Minus,
  Waves,
  Workflow,
} from 'lucide-react';
import { SignalData } from '../App';
import { getRecommendation, type RecommendationAction } from '../lib/recommendation';
import { fitCQM, riskForPriceFair, snapshotAt, type CQMSnapshot } from '../utils/cqm';
import { CQM_RISK_GRADIENT_CSS, colorAtRisk } from '../utils/cqmRiskGradient';
import { deriveModelEvents, type EventTone, type ModelEvent, type RiskPoint } from '../utils/modelEvents';

export interface MemberDashboardProps {
  current: SignalData;
  history: SignalData[];
}

// --- shared tone palette -----------------------------------------------------

const TONE: Record<EventTone, { border: string; text: string; soft: string }> = {
  pos: { border: '#22c55e', text: '#bbf7d0', soft: 'rgba(34,197,94,0.16)' },
  neg: { border: '#ef4444', text: '#fecaca', soft: 'rgba(239,68,68,0.16)' },
  neutral: { border: '#94a3b8', text: '#e2e8f0', soft: 'rgba(148,163,184,0.16)' },
};

function actionTone(action: RecommendationAction): EventTone {
  switch (action) {
    case 'ACCEL':
      return 'pos';
    case 'BASE':
      return 'neutral';
    case 'PAUSE':
      return 'neg';
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

const CQM_BAND_LABELS = ['Buy zone', 'Accumulate', 'Trim / Hold', 'Sell zone'] as const;
function cqmBandIndex(pct: number): 0 | 1 | 2 | 3 {
  if (pct < 25) return 0;
  if (pct < 50) return 1;
  if (pct < 75) return 2;
  return 3;
}
function cqmTone(pct: number): EventTone {
  return pct < 50 ? 'pos' : pct < 75 ? 'neutral' : 'neg';
}
function bottomTone(score: number): EventTone {
  return score >= 70 ? 'pos' : score >= 50 ? 'neutral' : 'neg';
}

function relativeDay(daysAgo: number): string {
  if (daysAgo <= 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo < 14) return `${daysAgo}d ago`;
  if (daysAgo < 60) return `${Math.round(daysAgo / 7)}w ago`;
  return `${Math.round(daysAgo / 30)}mo ago`;
}

// --- tiny inline sparkline ---------------------------------------------------

const Sparkline: React.FC<{ values: number[]; color: string; width?: number; height?: number }> = ({
  values,
  color,
  width = 96,
  height = 28,
}) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// --- derived model snapshot (single CQM fit shared across the page) ----------

interface DashModel {
  snap: CQMSnapshot | null;
  riskSeries: RiskPoint[];
}

function useDashModel(history: SignalData[]): DashModel {
  return useMemo(() => {
    const points: { date: string; ts: number; price: number }[] = [];
    for (const d of history) {
      const price = Number(d.BTCUSD);
      const ts = new Date(d.Date).getTime();
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) continue;
      points.push({ date: d.Date, ts, price });
    }
    if (points.length < 365) return { snap: null, riskSeries: [] };
    try {
      const fit = fitCQM(points);
      const snap = snapshotAt(fit);
      const tail = points.slice(-420);
      const riskSeries: RiskPoint[] = tail.map((p) => ({
        date: p.date,
        pct: Math.max(0, Math.min(100, riskForPriceFair(fit, p.ts, p.price) * 100)),
      }));
      return { snap, riskSeries };
    } catch {
      return { snap: null, riskSeries: [] };
    }
  }, [history]);
}

// --- BTC price change helper -------------------------------------------------

function pctChangeOverDays(history: SignalData[], days: number): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const lastPrice = Number(last.BTCUSD);
  const targetTs = Date.parse(`${last.Date}T00:00:00Z`) - days * 86_400_000;
  let ref: SignalData | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (Date.parse(`${history[i].Date}T00:00:00Z`) <= targetTs) {
      ref = history[i];
      break;
    }
  }
  if (!ref) ref = history[0];
  const refPrice = Number(ref.BTCUSD);
  if (!Number.isFinite(lastPrice) || !Number.isFinite(refPrice) || refPrice <= 0) return null;
  return (lastPrice / refPrice - 1) * 100;
}

const ChangeChip: React.FC<{ pct: number | null; label: string }> = ({ pct, label }) => {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <Chip
      size="small"
      icon={up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      label={`${label} ${up ? '+' : ''}${pct.toFixed(1)}%`}
      sx={{
        bgcolor: up ? TONE.pos.soft : TONE.neg.soft,
        color: up ? TONE.pos.text : TONE.neg.text,
        fontWeight: 700,
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
};

// --- sections ----------------------------------------------------------------

const SectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
    <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.12em', color: 'text.secondary' }}>
      {children}
    </Typography>
    {action}
  </Stack>
);

const MemberDashboard: React.FC<MemberDashboardProps> = ({ current, history }) => {
  const { snap, riskSeries } = useDashModel(history);
  const rec = getRecommendation(current);
  const events = useMemo(() => deriveModelEvents(history, riskSeries), [history, riskSeries]);

  const btcPrice = Number(current.BTCUSD);
  const change7d = pctChangeOverDays(history, 7);
  const change30d = pctChangeOverDays(history, 30);

  const riskPct = snap ? snap.risk * 100 : null;
  const bottomScore = Number(current.BOTTOM_ACCUM_SCORE);
  const hasBottom = Number.isFinite(bottomScore);
  const bottomBand = typeof current.BOTTOM_ACCUM_BAND === 'string' ? current.BOTTOM_ACCUM_BAND : null;

  const heroTone = actionTone(rec.action);
  const heroWord =
    rec.action === 'ACCEL' ? 'Accelerate accumulation' : rec.action === 'BASE' ? 'Base accumulation' : 'Capital protection';

  // Compact strip rows (manual to control sparklines + tone).
  const composite = useMemo(
    () =>
      history
        .slice(-120)
        .map((d) => Number(d.VAL_SCORE) + Number(d.LIQ_SCORE) + Number(d.BIZ_CYCLE_SCORE) + Number(d.DXY_SCORE))
        .filter((v) => Number.isFinite(v)),
    [history],
  );
  const bottomSeries = useMemo(
    () => history.slice(-120).map((d) => Number(d.BOTTOM_ACCUM_SCORE)).filter((v) => Number.isFinite(v)),
    [history],
  );
  const riskSpark = useMemo(() => riskSeries.slice(-120).map((r) => r.pct), [riskSeries]);

  const strip = [
    {
      id: 'core-macro',
      name: 'CORE + MACRO',
      Icon: Workflow,
      tone: heroTone,
      metric: rec.action,
      sub: rec.action === 'PAUSE' ? 'Accumulation paused' : rec.action === 'ACCEL' ? 'Macro tailwinds' : 'Base pace',
      spark: composite,
      sparkColor: TONE[heroTone].border,
    },
    {
      id: 'bottom',
      name: 'Bottom Score',
      Icon: Anchor,
      tone: hasBottom ? bottomTone(bottomScore) : ('neutral' as EventTone),
      metric: hasBottom ? `${bottomScore.toFixed(0)} / 100` : '—',
      sub: bottomBand ?? 'Accumulation grade',
      spark: bottomSeries,
      sparkColor: hasBottom ? TONE[bottomTone(bottomScore)].border : TONE.neutral.border,
    },
    {
      id: 'cqm',
      name: 'CQM',
      Icon: Waves,
      tone: riskPct === null ? ('neutral' as EventTone) : cqmTone(riskPct),
      metric: riskPct === null ? '—' : `${riskPct.toFixed(0)}% risk`,
      sub: riskPct === null ? 'Fitting…' : CQM_BAND_LABELS[cqmBandIndex(riskPct)],
      spark: riskSpark,
      sparkColor: riskPct === null ? TONE.neutral.border : colorAtRisk(riskPct),
    },
  ];

  // Market context tiles.
  const marketTiles: { label: string; score: number; max: number; series: number[] }[] = [
    { label: 'Liquidity', score: Number(current.LIQ_SCORE), max: 2, series: history.slice(-120).map((d) => Number(d.LIQ_SCORE)) },
    { label: 'Business cycle', score: Number(current.BIZ_CYCLE_SCORE), max: 2, series: history.slice(-120).map((d) => Number(d.BIZ_CYCLE_SCORE)) },
    { label: 'Dollar', score: Number(current.DXY_SCORE), max: 2, series: history.slice(-120).map((d) => Number(d.DXY_SCORE)) },
    { label: 'Valuation', score: Number(current.VAL_SCORE), max: 3, series: history.slice(-120).map((d) => Number(d.VAL_SCORE)) },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <LayoutDashboard className="h-8 w-8 text-blue-600" />
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            What changed across every CoinStrat model — and what to do about it.
          </Typography>
        </Box>
      </Box>

      {/* Section 1 — Hero: synthesized cross-model state of play */}
      <Paper
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          border: '1px solid',
          borderColor: TONE[heroTone].border,
          background: `radial-gradient(120% 140% at 0% 0%, ${TONE[heroTone].soft} 0%, rgba(15,23,42,0) 55%)`,
        }}
      >
        <Box sx={{ display: 'grid', gap: { xs: 2, md: 4 }, gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, alignItems: 'center' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              Today&apos;s posture · as of {current.Date}
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="baseline" useFlexGap flexWrap="wrap">
              <Typography variant="h3" sx={{ fontWeight: 950, letterSpacing: -1, color: TONE[heroTone].border }}>
                {heroWord}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
              {rec.reason}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                label={`BTC $${Number.isFinite(btcPrice) ? Math.round(btcPrice).toLocaleString() : '—'}`}
                sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#e2e8f0', fontWeight: 800 }}
              />
              <ChangeChip pct={change7d} label="7d" />
              <ChangeChip pct={change30d} label="30d" />
            </Stack>
          </Box>

          <Box sx={{ display: 'grid', gap: 1.25 }}>
            <HeroModelLine
              name="CORE + MACRO"
              tone={heroTone}
              value={rec.action}
              note={rec.blockers.length ? `${rec.blockers.length} blocker${rec.blockers.length > 1 ? 's' : ''}` : 'no blockers'}
            />
            <HeroModelLine
              name="Bottom Score"
              tone={hasBottom ? bottomTone(bottomScore) : 'neutral'}
              value={hasBottom ? `${bottomScore.toFixed(0)} / 100` : '—'}
              note={bottomBand ?? 'accumulation grade'}
            />
            <HeroModelLine
              name="CQM"
              tone={riskPct === null ? 'neutral' : cqmTone(riskPct)}
              value={riskPct === null ? '—' : `${riskPct.toFixed(0)}% risk`}
              note={riskPct === null ? 'fitting' : CQM_BAND_LABELS[cqmBandIndex(riskPct)]}
            />
          </Box>
        </Box>

        {rec.blockers.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {rec.blockers.map((b, i) => (
                <Chip key={i} size="small" variant="outlined" label={b} sx={{ borderColor: TONE.neg.border, color: TONE.neg.text }} />
              ))}
            </Stack>
          </>
        )}
      </Paper>

      {/* Section 2 + 3 — feed + compact strip side by side on desktop */}
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' }, alignItems: 'start' }}>
        {/* What changed recently */}
        <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
          <SectionTitle
            action={<Chip size="small" icon={<Bell size={13} />} label="Alerts" component={RouterLink} to="/profile" clickable sx={{ '& .MuiChip-icon': { color: 'inherit' } }} />}
          >
            What changed recently
          </SectionTitle>
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No model transitions detected in the recent history.</Typography>
          ) : (
            <Stack divider={<Divider flexItem />} spacing={0}>
              {events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </Stack>
          )}
        </Paper>

        {/* Compact cross-model strip */}
        <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
          <SectionTitle action={<Button component={RouterLink} to="/models" size="small" sx={{ fontWeight: 700 }}>All models</Button>}>
            Model states
          </SectionTitle>
          <Stack spacing={1.25}>
            {strip.map((m) => {
              const Icon = m.Icon;
              return (
                <Box
                  key={m.id}
                  component={RouterLink}
                  to={`/models/${m.id}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.25,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'border-color 120ms ease',
                    '&:hover': { borderColor: TONE[m.tone].border },
                  }}
                >
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: TONE[m.tone].border, flexShrink: 0 }} />
                  <Icon size={18} className="text-blue-400" />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>{m.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{m.sub}</Typography>
                  </Box>
                  <Sparkline values={m.spark} color={m.sparkColor} />
                  <Chip size="small" label={m.metric} sx={{ bgcolor: TONE[m.tone].soft, color: TONE[m.tone].text, fontWeight: 800, flexShrink: 0 }} />
                </Box>
              );
            })}
          </Stack>
        </Paper>
      </Box>

      {/* Section 5 — CQM spotlight */}
      {riskPct !== null && snap && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <SectionTitle action={<Button component={RouterLink} to="/models/cqm" size="small" sx={{ fontWeight: 700 }}>Open CQM</Button>}>
            CQM spotlight
          </SectionTitle>
          <Box sx={{ display: 'grid', gap: { xs: 2, md: 3 }, gridTemplateColumns: { xs: '1fr', md: 'auto 1fr' }, alignItems: 'center' }}>
            <Box sx={{ textAlign: 'center', minWidth: 160 }}>
              <Typography variant="h2" sx={{ fontWeight: 950, lineHeight: 1, color: colorAtRisk(riskPct) }}>
                {riskPct.toFixed(0)}<Typography component="span" variant="h5" color="text.secondary">%</Typography>
              </Typography>
              <Chip
                size="small"
                label={CQM_BAND_LABELS[cqmBandIndex(riskPct)]}
                sx={{ mt: 1, bgcolor: TONE[cqmTone(riskPct)].soft, color: colorAtRisk(riskPct), fontWeight: 800 }}
              />
            </Box>
            <Box sx={{ width: '100%' }}>
              <Box sx={{ position: 'relative', mb: 1.5 }}>
                <Box sx={{ height: 12, borderRadius: 6, background: CQM_RISK_GRADIENT_CSS }} />
                <Box
                  sx={{
                    position: 'absolute',
                    top: -5,
                    left: `${riskPct}%`,
                    transform: 'translateX(-50%)',
                    width: 3,
                    height: 22,
                    bgcolor: '#f8fafc',
                    borderRadius: 1,
                    boxShadow: '0 0 0 2px rgba(15,23,42,0.6)',
                  }}
                />
              </Box>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`BTC $${Math.round(snap.price).toLocaleString()}`} sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#e2e8f0', fontWeight: 700 }} />
                <Chip size="small" label={`Fair value $${Math.round(snap.qrDashedMedian).toLocaleString()}`} sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#cbd5e1' }} />
                <Chip
                  size="small"
                  label={`${snap.price >= snap.qrDashedMedian ? '+' : ''}${((snap.price / snap.qrDashedMedian - 1) * 100).toFixed(0)}% vs fair`}
                  sx={{ bgcolor: snap.price >= snap.qrDashedMedian ? TONE.neutral.soft : TONE.pos.soft, color: snap.price >= snap.qrDashedMedian ? '#fde68a' : TONE.pos.text, fontWeight: 700 }}
                />
              </Stack>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Section 6 — Market context tiles */}
      <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
        <SectionTitle action={<Button component={RouterLink} to="/indicators" size="small" sx={{ fontWeight: 700 }}>Indicators</Button>}>
          Market context
        </SectionTitle>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
          {marketTiles.map((t) => {
            const finite = t.series.filter((v) => Number.isFinite(v));
            const tone: EventTone = t.score === 0 ? 'neg' : t.score >= t.max ? 'pos' : 'neutral';
            const trend = finite.length >= 2 ? finite[finite.length - 1] - finite[0] : 0;
            return (
              <Box key={t.label} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{t.label}</Typography>
                  {trend > 0 ? <ArrowUpRight size={14} color={TONE.pos.border} /> : trend < 0 ? <ArrowDownRight size={14} color={TONE.neg.border} /> : <Minus size={14} color={TONE.neutral.border} />}
                </Stack>
                <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ my: 0.25 }}>
                  <Typography variant="h5" sx={{ fontWeight: 900, color: TONE[tone].border }}>{Number.isFinite(t.score) ? t.score : '—'}</Typography>
                  <Typography variant="caption" color="text.secondary">/ {t.max}</Typography>
                </Stack>
                <Sparkline values={finite} color={TONE[tone].border} width={120} height={22} />
              </Box>
            );
          })}
        </Box>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
          <Button component={RouterLink} to="/lab" variant="outlined" size="small" startIcon={<FlaskConical size={16} />} sx={{ fontWeight: 700 }}>Backtest Lab</Button>
          <Button component={RouterLink} to="/models" variant="outlined" size="small" startIcon={<Layers size={16} />} sx={{ fontWeight: 700 }}>Models</Button>
          <Button component={RouterLink} to="/indicators" variant="outlined" size="small" startIcon={<Activity size={16} />} sx={{ fontWeight: 700 }}>Indicators</Button>
          <Button component={RouterLink} to="/profile" variant="outlined" size="small" startIcon={<Bell size={16} />} sx={{ fontWeight: 700 }}>Manage alerts</Button>
        </Stack>
      </Paper>
    </Box>
  );
};

const HeroModelLine: React.FC<{ name: string; tone: EventTone; value: string; note: string }> = ({ name, tone, value, note }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, borderRadius: 1.5, bgcolor: 'rgba(15,23,42,0.4)', border: '1px solid', borderColor: 'divider' }}>
    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: TONE[tone].border, flexShrink: 0 }} />
    <Typography variant="body2" sx={{ fontWeight: 800, flex: 1 }} noWrap>{name}</Typography>
    <Typography variant="caption" color="text.secondary" noWrap sx={{ mr: 1 }}>{note}</Typography>
    <Chip size="small" label={value} sx={{ bgcolor: TONE[tone].soft, color: TONE[tone].text, fontWeight: 800 }} />
  </Box>
);

const EventRow: React.FC<{ event: ModelEvent }> = ({ event }) => (
  <Box
    component={RouterLink}
    to={event.link}
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      py: 1.25,
      textDecoration: 'none',
      color: 'inherit',
      '&:hover .evt-title': { color: TONE[event.tone].text },
    }}
  >
    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: TONE[event.tone].border, flexShrink: 0 }} />
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography className="evt-title" variant="body2" sx={{ fontWeight: 800 }} noWrap>{event.title}</Typography>
      <Typography variant="caption" color="text.secondary" noWrap>
        {event.modelName} · {event.detail}
      </Typography>
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{relativeDay(event.daysAgo)}</Typography>
  </Box>
);

export default MemberDashboard;
