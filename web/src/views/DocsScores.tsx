import React from 'react';
import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

type ScoreDoc = {
  title: string;
  badge: string;
  meaning: string;
  formula: string;
  rationale: string;
  thresholds: string[];
  notes?: string[];
};

const SCORES: ScoreDoc[] = [
  {
    title: 'Valuation Score',
    badge: 'VAL_SCORE',
    meaning:
      'Measures how attractive Bitcoin looks from a long-term valuation perspective by combining NUPL (derived from MVRV as 1 − 1/MVRV) with LTH SOPR (flow metric).',
    formula:
      'NUPL = 1 − 1/MVRV. If NUPL < 0 and LTH_SOPR < 1.0 => 3; else if NUPL < 0 or (NUPL < 0.382 and LTH_SOPR < 1.0) => 2; else if NUPL < 0.618 => 1; else => 0.',
    rationale:
      'NUPL is a bounded oscillator derived from MVRV that tells us whether the market is trading below or above realized value. Unlike raw MVRV, whose peaks decay across cycles, NUPL thresholds remain structurally stable. LTH SOPR adds a behavioral layer by checking whether long-term holders are capitulating. Together they distinguish deep-value washouts from normal bull-market conditions and late-cycle euphoria.',
    thresholds: [
      '3 = extreme deep value. Both NUPL and LTH SOPR point to capitulation (NUPL < 0 and SOPR < 1).',
      '2 = strong value. Either NUPL is negative (deep value), or NUPL is below 0.382 with long-term holders still capitulating.',
      '1 = fair / neutral. NUPL between 0.382 and 0.618 — not especially cheap, but not euphoric either.',
      '0 = overheated. NUPL >= 0.618, which historically clusters near late-cycle tops.',
    ],
    notes: [
      'NUPL thresholds are more forward-looking than raw MVRV because MVRV peaks have been trending down each cycle (6 → 4.5 → 3.8 → 2.7), while NUPL euphoria peaks remain stable around 0.70–0.75.',
      'This score is the backbone of the Core Engine.',
    ],
  },
  {
    title: 'Liquidity Score',
    badge: 'LIQ_SCORE',
    meaning:
      'Measures whether net liquidity in the U.S. system is expanding, inflecting upward, or contracting.',
    formula:
      'US_LIQ = WALCL - WTREGEN - RRPONTSYD. Score 2 if US_LIQ_YOY > 0; else 1 if US_LIQ_13W_DELTA > 0; else 0.',
    rationale:
      'Bitcoin tends to respond to changes in liquidity. A positive year-over-year impulse is the strongest tailwind. A positive 13-week delta is weaker, but still useful because it can catch inflections before the annual trend fully turns.',
    thresholds: [
      '2 = expanding liquidity. Year-over-year liquidity is positive.',
      '1 = inflecting up. Annual trend is not positive yet, but the recent 13-week change is improving.',
      '0 = contracting liquidity. Neither condition is supportive.',
    ],
    notes: [
      'WALCL and WTREGEN come from FRED in millions of USD. RRPONTSYD is normalized before the formula is applied.',
    ],
  },
  {
    title: 'Business Cycle Score',
    badge: 'BIZ_CYCLE_SCORE',
    meaning:
      'Nowcasts the macro backdrop using recession-risk and expansion signals from labor, rates, and manufacturing (ISM PMI).',
    formula:
      'Three recession flags: [A] SAHM >= 0.50, [B] YC_M < 0, [C] ISM_PMI < 45 for 60+ consecutive days. Score 0 when at least 2 of 3 flags are active. Score 2 if SAHM < 0.35 and YC_M >= 0.75 and ISM_PMI >= 50 for 90+ consecutive days (3 monthly prints). Otherwise score 1.',
    rationale:
      'No single macro indicator is reliable enough on its own. The Sahm Rule captures labor weakness, the yield curve captures recession expectations, and ISM Manufacturing PMI captures real-economy manufacturing breadth. Requiring 2-of-3 confirmation for recession risk avoids extended false alarms — for example, the yield curve was inverted from Oct 2022 through Oct 2024 while BTC rallied from $16k to $70k. Under a pure-OR rule, BIZ_CYCLE_SCORE would have been stuck at 0 for most of that period. The 2-of-3 rule ensures a single noisy indicator cannot block the MACRO accelerator alone.',
    thresholds: [
      '2 = expansion. Labor is healthy, the curve is positive enough, and ISM PMI has been above 50 for at least 3 consecutive months.',
      '1 = stabilizing / mixed. The economy is not clearly in expansion or recession-risk.',
      '0 = recession-risk. At least two of the three defensive triggers are firing simultaneously.',
    ],
    notes: [
      'Recession risk requires 2-of-3 confirmation to avoid single-indicator false alarms (e.g. prolonged yield curve inversions without actual recession).',
      'ISM PMI < 45 for 2 months is the manufacturing recession trigger — a single sub-45 print alone does not fire. The 45 threshold aligns with historical NBER recessions.',
      'ISM PMI expansion persistence (3 months above 50) uses a strict reset: any single print below 50 resets the counter to zero.',
      'True recessions historically trigger all three indicators; the 2-of-3 rule loses almost nothing in real recession detection.',
    ],
  },
  {
    title: 'Dollar Regime Score',
    badge: 'DXY_SCORE',
    meaning:
      'Measures whether the U.S. dollar is a headwind, neutral, or supportive for risk assets using a broad trade-weighted dollar index rather than the ICE DXY ticker.',
    formula:
      'Compute ROC20, MA50, and MA200 on DTWEXBGS. Raw score = 0 if ROC20 > +0.5%; 2 if ROC20 < -0.5% and MA50 < MA200; else 1. Then apply a 20-of-30-day persistence filter: if raw score >= 1 on at least 20 of the last 30 days, keep the raw score; otherwise force the effective score to 0.',
    rationale:
      'A strengthening dollar usually tightens financial conditions and acts as a headwind for Bitcoin. A weakening dollar helps. The persistence filter exists because brief pauses in dollar strength often reverse quickly, so the model waits for a more durable regime change before treating the dollar as supportive.',
    thresholds: [
      '2 = supportive. The dollar is weakening and short-term trend confirms it.',
      '1 = neutral. No strong signal either way.',
      '0 = headwind. Dollar strength is still a risk, or the favorable regime has not persisted long enough.',
    ],
    notes: [
      'The persistence filter is what turns the raw signal into the effective score used by the model.',
    ],
  },
];

const DocsScores: React.FC = () => {
  return (
    <DocsPageLayout>
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="h3"
            component="h1"
            sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}
          >
            Scores
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 760 }}>
            The CoinStrat model first turns raw market and macro inputs into a small set of
            interpretable scores. Those scores are then combined into the higher-level signals.
          </Typography>
        </Box>

        <Alert severity="info" sx={{ alignItems: 'center' }}>
          `PRICE_REGIME` is documented under <strong>Signals</strong> because it acts as a binary
          trend filter rather than a multi-level score.
        </Alert>

        {SCORES.map((score) => (
          <ScoreCard key={score.badge} score={score} />
        ))}

        <DocsPager />
      </Stack>
    </DocsPageLayout>
  );
};

const ScoreCard: React.FC<{ score: ScoreDoc }> = ({ score }) => (
  <Card
    sx={{
      borderColor: 'rgba(148,163,184,0.35)',
      background: 'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
      boxShadow: 'none',
    }}
  >
    <CardContent>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1}>
          <Typography variant="h5" sx={{ fontWeight: 900 }}>
            {score.title}
          </Typography>
          <Chip label={score.badge} sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
        </Stack>

        <SectionBlock label="Meaning" text={score.meaning} />
        <SectionBlock label="Formula" text={score.formula} monospace />
        <SectionBlock label="Why It Matters" text={score.rationale} />

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary">
            Thresholds
          </Typography>
          <Stack component="ul" spacing={0.75} sx={{ mt: 0.75, pl: 2 }}>
            {score.thresholds.map((line) => (
              <Typography component="li" variant="body2" key={line} sx={{ color: 'text.primary', lineHeight: 1.7 }}>
                {line}
              </Typography>
            ))}
          </Stack>
        </Box>

        {score.notes && score.notes.length > 0 && (
          <>
            <Divider />
            <Box>
              <Typography variant="overline" color="text.secondary">
                Notes
              </Typography>
              <Stack component="ul" spacing={0.75} sx={{ mt: 0.75, pl: 2 }}>
                {score.notes.map((line) => (
                  <Typography component="li" variant="body2" key={line} sx={{ color: 'text.primary', lineHeight: 1.7 }}>
                    {line}
                  </Typography>
                ))}
              </Stack>
            </Box>
          </>
        )}
      </Stack>
    </CardContent>
  </Card>
);

const SectionBlock: React.FC<{ label: string; text: string; monospace?: boolean }> = ({ label, text, monospace = false }) => (
  <Box>
    <Typography variant="overline" color="text.secondary">
      {label}
    </Typography>
    <Typography
      variant="body2"
      sx={{
        color: 'text.primary',
        lineHeight: 1.75,
        fontFamily: monospace
          ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          : 'inherit',
      }}
    >
      {text}
    </Typography>
  </Box>
);

export default DocsScores;
