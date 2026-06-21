import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Link as MuiLink,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SignalData } from '../../App';
import { BOTTOM_FACTORS, type BottomFactor, type BottomFactorKey, type SubScore } from '../../utils/bottomScore';

/** Per-factor line colour for the sub-score history chart. */
const FACTOR_COLOR: Record<BottomFactorKey, string> = {
  onchain: '#a78bfa',
  capitulation: '#fb7185',
  liquidity: '#60a5fa',
  macro: '#34d399',
  setup: '#f97316',
  repair: '#4ade80',
};

function fmtXTick(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** Time series of a single factor's sub-score (0..max) with BTC price for context. */
const FactorScoreChart: React.FC<{ data: SignalData[]; factor: BottomFactor }> = ({ data, factor }) => {
  const color = FACTOR_COLOR[factor.key] ?? '#facc15';
  const points = useMemo(
    () =>
      data
        .map((d) => ({
          ts: Date.parse(`${d.Date}T00:00:00Z`),
          score: Number(d[factor.field]),
          btc: Number(d.BTCUSD),
        }))
        .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.score)),
    [data, factor.field],
  );

  const btcDomain = useMemo<[number, number]>(() => {
    const vals = points.map((p) => p.btc).filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return [1, 10];
    return [Math.min(...vals) * 0.9, Math.max(...vals) * 1.1];
  }, [points]);

  if (points.length < 2) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {factor.label} sub-score history
      </Typography>
      <Box sx={{ height: { xs: 240, sm: 300 }, width: '100%', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 5, right: 28, left: 4, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
            <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={fmtXTick} minTickGap={36} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="score" domain={[0, factor.max]} allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
            <YAxis yAxisId="btc" orientation="right" scale="log" domain={btcDomain} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? `$${Math.round(v).toLocaleString()}` : '')} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1f2a44', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(ts) => new Date(Number(ts)).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
              formatter={(val, name) => (name === 'BTCUSD' ? [`$${Math.round(Number(val)).toLocaleString()}`, 'BTC'] : [Number(val).toFixed(0), factor.label])}
            />
            <Line yAxisId="score" type="monotone" dataKey="score" name={factor.label} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="btc" type="monotone" dataKey="btc" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.4} dot={false} isAnimationActive={false} opacity={0.4} />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
};

/** Tab display order + concise labels (independent of the scoring spec order). */
const FACTOR_TAB_ORDER: { key: BottomFactorKey; label: string }[] = [
  { key: 'onchain', label: 'On-chain value' },
  { key: 'capitulation', label: 'Capitulation' },
  { key: 'setup', label: 'Price damage' },
  { key: 'repair', label: 'Price repair' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'macro', label: 'Macro support' },
];

const ACTIVE_BG = 'rgba(34,197,94,0.16)';
const ACTIVE_BORDER = 'rgba(34,197,94,0.55)';

function scoreTone(value: number, max: number): { bg: string; color: string } {
  const r = max > 0 ? value / max : 0;
  if (r >= 0.66) return { bg: 'rgba(34,197,94,0.18)', color: '#bbf7d0' };
  if (r >= 0.33) return { bg: 'rgba(234,179,8,0.18)', color: '#fde68a' };
  return { bg: 'rgba(148,163,184,0.16)', color: '#cbd5e1' };
}

const SubScoreRow: React.FC<{ sub: SubScore; current: SignalData }> = ({ sub, current }) => {
  const { points, activeIndex } = sub.evaluate(current);
  const tone = scoreTone(points, sub.max);
  return (
    <Box sx={{ py: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 180 }}>
          {sub.label}
        </Typography>
        <Chip
          size="small"
          label={`+${points} / ${sub.max}`}
          sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 800 }}
        />
      </Stack>
      <Typography
        variant="caption"
        sx={{ display: 'block', mb: 0.75, color: 'text.secondary', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        Now: {sub.input(current)}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {sub.rules.map((rule, i) => {
          const active = i === activeIndex;
          return (
            <Box
              key={rule.when}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.4,
                borderRadius: 1,
                border: '1px solid',
                borderColor: active ? ACTIVE_BORDER : 'transparent',
                bgcolor: active ? ACTIVE_BG : 'transparent',
              }}
            >
              <Typography
                variant="caption"
                sx={{ flex: 1, fontWeight: active ? 700 : 400, color: active ? 'text.primary' : 'text.secondary' }}
              >
                {active ? '→ ' : ''}{rule.when}
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: active ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap' }}
              >
                {rule.points} pt{rule.points === 1 ? '' : 's'}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const FactorCard: React.FC<{ factor: BottomFactor; data: SignalData[]; current: SignalData }> = ({ factor, data, current }) => {
  const live = Number(current[factor.field]);
  const hasLive = Number.isFinite(live);
  const tone = scoreTone(hasLive ? live : 0, factor.max);
  const subTotal = factor.subs.reduce((acc, s) => acc + s.evaluate(current).points, 0);

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{factor.label}</Typography>
        <Chip
          label={hasLive ? `${live.toFixed(0)} / ${factor.max}` : `— / ${factor.max}`}
          sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 800 }}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{factor.purpose}</Typography>

      <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        {factor.subs.map((sub) => (
          <SubScoreRow key={sub.label} sub={sub} current={current} />
        ))}
      </Box>

      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 1.25, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Sum of rules: {subTotal} pt{subTotal === 1 ? '' : 's'}
        </Typography>
        {subTotal > factor.max && (
          <Typography variant="caption" color="text.secondary">
            (capped at {factor.max})
          </Typography>
        )}
        {hasLive && (
          <Typography variant="caption" color="text.secondary">
            → factor score {live.toFixed(0)} / {factor.max}
          </Typography>
        )}
      </Stack>

      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
        {factor.interpretation}
      </Typography>
      {factor.note && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary', fontStyle: 'italic' }}>
          {factor.note}
        </Typography>
      )}

      <FactorScoreChart data={data} factor={factor} />
    </Paper>
  );
};

const BottomFactors: React.FC<{ data: SignalData[] }> = ({ data }) => {
  const current = data.length ? data[data.length - 1] : null;
  const total = current ? Number(current.BOTTOM_ACCUM_SCORE) : NaN;
  const band = current?.BOTTOM_ACCUM_BAND;
  const deployment = current?.BOTTOM_DEPLOYMENT_RANGE;
  const [tab, setTab] = useState(0);

  const tabs = useMemo(() => {
    const byKey = new Map(BOTTOM_FACTORS.map((f) => [f.key, f]));
    return FACTOR_TAB_ORDER.map((t) => ({ ...t, factor: byKey.get(t.key) }))
      .filter((t): t is { key: BottomFactorKey; label: string; factor: BottomFactor } => Boolean(t.factor));
  }, []);
  const activeTab = tabs[tab] ?? tabs[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap', mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Factor scoring</Typography>
          {Number.isFinite(total) && (
            <Chip
              label={`Total ${total.toFixed(0)} / 100`}
              sx={{ bgcolor: 'rgba(96,165,250,0.18)', color: '#bfdbfe', fontWeight: 800 }}
            />
          )}
          {band && <Chip size="small" label={String(band)} variant="outlined" />}
          {deployment && <Chip size="small" label={`Deploy ${deployment}`} variant="outlined" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          The Bottom Accumulation Score sums six sub-scores. Pick a factor below to see its live sub-score, the exact tiered
          rules behind it, and which tier today&apos;s inputs land in (highlighted). Open &ldquo;Contributing charts&rdquo;
          to confirm the reading visually.
        </Typography>
      </Paper>

      {!current || !activeTab ? (
        <Paper sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">No data available yet.</Typography>
        </Paper>
      ) : (
        <>
          <Paper sx={{ px: { xs: 0.5, sm: 1 } }}>
            <Tabs
              value={tab}
              onChange={(_, v: number) => setTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              textColor="inherit"
              indicatorColor="primary"
              sx={{ minHeight: 44 }}
            >
              {tabs.map((t) => {
                const live = Number(current[t.factor.field]);
                const label = Number.isFinite(live)
                  ? `${t.label} · ${live.toFixed(0)}/${t.factor.max}`
                  : t.label;
                return <Tab key={t.key} label={label} sx={{ minHeight: 44, fontWeight: 700, textTransform: 'none' }} />;
              })}
            </Tabs>
          </Paper>
          <FactorCard key={activeTab.key} factor={activeTab.factor} data={data} current={current} />
        </>
      )}

      <Typography variant="caption" color="text.secondary">
        Sub-scores are summed and capped at each factor&apos;s maximum, then added into the 0–100 total. See the{' '}
        <MuiLink component={RouterLink} to="/models/bottom/docs">methodology</MuiLink> for bands and deployment ranges.
      </Typography>
    </Box>
  );
};

export default BottomFactors;
