import React from 'react';
import { Box, Chip, Divider, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

type Rule = { when: string; result: string; tone?: 'pos' | 'neg' | 'neutral' };
type Factor = {
  label: string;
  field: string;
  purpose: string;
  formula: string;
  rules: Rule[];
  note?: string;
};

const toneSx: Record<NonNullable<Rule['tone']>, { bg: string; color: string }> = {
  pos: { bg: 'rgba(34,197,94,0.16)', color: '#bbf7d0' },
  neg: { bg: 'rgba(239,68,68,0.16)', color: '#fecaca' },
  neutral: { bg: 'rgba(148,163,184,0.16)', color: '#cbd5e1' },
};

const CORE_RULES: Rule[] = [
  { when: 'VAL_SCORE ≥ 3  (extreme deep value)', result: 'Enter / stay ON unconditionally', tone: 'pos' },
  { when: 'VAL_SCORE ≥ 1  AND  PRICE_REGIME = 1 (price ≥ 40-week MA)', result: 'Enter / stay ON', tone: 'pos' },
  { when: 'PRICE_REGIME = 0  AND  VAL_SCORE ≤ 1', result: 'Exit (trend break, not in deep value)', tone: 'neg' },
  { when: 'SIP_EXHAUSTED = 1  AND  VAL_SCORE = 0', result: 'Exit (euphoria exhaustion)', tone: 'neg' },
];

const MACRO_RULES: Rule[] = [
  { when: 'LIQ_SCORE + BIZ_CYCLE_SCORE ≥ 3', result: 'Liquidity + business-cycle momentum present', tone: 'pos' },
  { when: 'DXY_SCORE ≥ 1  (after 20/30-day persistence)', result: 'USD is not a risk-off headwind', tone: 'pos' },
  { when: 'Both true  AND  CORE is ON', result: 'MACRO ON → accelerate DCA to 3×', tone: 'pos' },
  { when: 'CORE is OFF', result: 'MACRO is ignored (no buys regardless)', tone: 'neutral' },
];

const FACTORS: Factor[] = [
  {
    label: 'BTC Valuation',
    field: 'VAL_SCORE',
    purpose: 'How cheap is BTC on-chain, from deep value to euphoria? Drives CORE entry/exit.',
    formula: 'NUPL (= 1 − 1/MVRV) combined with LTH-SOPR capitulation thresholds.',
    rules: [
      { when: 'NUPL < 0  AND  LTH-SOPR < 1.0', result: 'Score 3 — extreme deep value (unconditional CORE entry)', tone: 'pos' },
      { when: '(NUPL < 0 AND SOPR ≥ 1)  OR  (NUPL < 0.382 AND SOPR < 1)', result: 'Score 2 — strong value', tone: 'pos' },
      { when: 'NUPL < 0.618  (and not score 2/3)', result: 'Score 1 — fair / neutral', tone: 'neutral' },
      { when: 'NUPL ≥ 0.618', result: 'Score 0 — euphoria (can trigger CORE exit)', tone: 'neg' },
    ],
  },
  {
    label: 'BTC Price Regime',
    field: 'PRICE_REGIME',
    purpose: 'Simple bull/bear trend filter that gates CORE entries alongside valuation.',
    formula: 'PRICE_REGIME = 1 when BTCUSD ≥ 40-week MA, else 0 — then a 20/30-day persistence filter.',
    rules: [
      { when: 'BTCUSD ≥ BTC_MA40W', result: 'Regime = 1 (bullish trend)', tone: 'pos' },
      { when: 'BTCUSD < BTC_MA40W', result: 'Regime = 0 (bearish trend)', tone: 'neg' },
    ],
    note: 'A 20-of-30-day persistence filter smooths the raw signal so brief wicks across the MA do not flip the regime.',
  },
  {
    label: 'US Liquidity',
    field: 'LIQ_SCORE',
    purpose: 'Direction and impulse of net USD liquidity — a MACRO accelerator input.',
    formula: 'US_LIQ = WALCL − WTREGEN − RRPONTSYD (Fed balance sheet − Treasury cash − reverse repo).',
    rules: [
      { when: 'US_LIQ YoY > 0', result: 'Score 2 — expanding', tone: 'pos' },
      { when: 'US_LIQ YoY ≤ 0  AND  13-week Δ > 0', result: 'Score 1 — inflecting up', tone: 'neutral' },
      { when: 'otherwise', result: 'Score 0 — contracting', tone: 'neg' },
    ],
  },
  {
    label: 'Business Cycle',
    field: 'BIZ_CYCLE_SCORE',
    purpose: 'Expansion vs recession nowcast — a MACRO accelerator input.',
    formula: 'Sahm rule + yield curve (10Y−3M) + ISM Manufacturing PMI, with persistence filters; recession needs 2-of-3.',
    rules: [
      { when: 'SAHM < 0.35  AND  YC ≥ 0.75  AND  ISM ≥ 50 for 90+ days', result: 'Score 2 — expansion', tone: 'pos' },
      { when: '≥ 2 of: SAHM ≥ 0.50, YC < 0, ISM < 45 for 60+ days', result: 'Score 0 — recession risk', tone: 'neg' },
      { when: 'otherwise', result: 'Score 1 — stabilizing', tone: 'neutral' },
    ],
  },
  {
    label: 'USD Regime',
    field: 'DXY_SCORE',
    purpose: 'Broad-dollar tailwind/headwind for risk assets — the MACRO gate.',
    formula: 'Raw score from DXY ROC20 (±0.5%) + MA50/MA200 crossover, then a 20/30-day persistence filter.',
    rules: [
      { when: 'ROC20 < −0.5%  AND  MA50 < MA200', result: 'Raw 2 — USD weakening (supportive)', tone: 'pos' },
      { when: 'ROC20 > +0.5%', result: 'Raw 0 — USD strengthening (headwind)', tone: 'neg' },
      { when: 'otherwise', result: 'Raw 1 — neutral', tone: 'neutral' },
    ],
    note: 'Effective DXY_SCORE only counts once the raw score has held ≥ 1 for 20 of the last 30 days; otherwise it is forced to 0.',
  },
];

const RuleList: React.FC<{ rules: Rule[] }> = ({ rules }) => (
  <Stack spacing={1}>
    {rules.map((r) => {
      const tone = toneSx[r.tone ?? 'neutral'];
      return (
        <Stack key={r.when} direction="row" alignItems="flex-start" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <Box
            sx={{
              flex: '1 1 280px',
              minWidth: 220,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {r.when}
          </Box>
          <Chip size="small" label={r.result} sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 700, height: 'auto', py: 0.5, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
        </Stack>
      );
    })}
  </Stack>
);

const CoreMacroDocs: React.FC = () => (
  <Stack spacing={2}>
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>How CORE + MACRO works</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.8 }}>
        CORE + MACRO is a two-stage accumulation engine. <strong>CORE</strong> is the master switch: a
        value-led state machine that turns accumulation ON in deep value or confirmed uptrends and OFF on
        trend breaks or euphoria. <strong>MACRO</strong> is an accelerator: when liquidity and the business
        cycle are improving and the dollar is not a headwind, it multiplies the DCA rate — but only while
        CORE is already ON.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
        In short: CORE decides <em>whether</em> to buy; MACRO decides <em>how hard</em>. CORE never buys on
        MACRO alone, so the macro accelerator can never override capital protection.
      </Typography>
    </Paper>

    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>CORE — the accumulation switch</Typography>
        <Chip size="small" label="ACCUM gate" sx={{ bgcolor: 'rgba(96,165,250,0.18)', color: '#bfdbfe', fontWeight: 700 }} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
        CORE evaluates valuation (VAL_SCORE) and the price regime (BTC vs its 40-week moving average). Entry
        conditions are checked when CORE is OFF; exit conditions when it is ON. It deliberately holds through
        deep-value capitulation so buying continues at bear-market bottoms.
      </Typography>
      <RuleList rules={CORE_RULES} />
    </Paper>

    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>MACRO — the 3× accelerator</Typography>
        <Chip size="small" label="intensity" sx={{ bgcolor: 'rgba(234,179,8,0.18)', color: '#fde68a', fontWeight: 700 }} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
        MACRO combines the liquidity and business-cycle regimes with a persistence-filtered USD gate. When it
        aligns alongside an ON CORE, DCA intensity steps up to 3×.
      </Typography>
      <RuleList rules={MACRO_RULES} />
    </Paper>

    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>The factor scores</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        CORE and MACRO are built from five underlying factor scores. Each is a small tiered rule set; the
        first matching tier sets the score. The <MuiLink component={RouterLink} to="../scores">Scores tab</MuiLink>{' '}
        shows each factor&apos;s live inputs and which tier is active, and the{' '}
        <MuiLink component={RouterLink} to="../charts">Charts tab</MuiLink> groups the underlying data.
      </Typography>
    </Paper>

    {FACTORS.map((f) => (
      <Paper key={f.field} sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1, minWidth: 180 }}>{f.label}</Typography>
          <Chip
            size="small"
            label={f.field}
            sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#cbd5e1', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}
          />
        </Stack>
        <Typography variant="body2" sx={{ mb: 0.5 }}><strong>What it asks:</strong> {f.purpose}</Typography>
        <Typography
          variant="caption"
          sx={{ display: 'block', mb: 1.5, color: 'text.secondary', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
          {f.formula}
        </Typography>
        <RuleList rules={f.rules} />
        {f.note && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>{f.note}</Typography>
          </>
        )}
      </Paper>
    ))}

    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="body2">
        Full reference:{' '}
        <MuiLink component={RouterLink} to="/docs/scores">Scores</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/signals">Signals</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/architecture">Architecture</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/data">Data Feeds</MuiLink>
      </Typography>
    </Paper>
  </Stack>
);

export default CoreMacroDocs;
