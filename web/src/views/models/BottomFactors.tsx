import React, { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import { Link as RouterLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { SignalData } from '../../App';
import ChartsView, { type ChartsSection } from '../ChartsView';
import { BOTTOM_FACTORS, type BottomFactor, type BottomFactorKey, type SubScore } from '../../utils/bottomScore';

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

      <Accordion
        disableGutters
        elevation={0}
        TransitionProps={{ unmountOnExit: true }}
        sx={{ mt: 1.5, bgcolor: 'transparent', '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
      >
        <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ minHeight: 44 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>Contributing charts</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {factor.chartIds && factor.chartIds.length > 0 ? (
            <ChartsView data={data} chartIds={factor.chartIds} embedded showRange={false} />
          ) : (
            <ChartsView data={data} sections={factor.sections as ChartsSection[]} embedded showRange={false} />
          )}
        </AccordionDetails>
      </Accordion>
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
