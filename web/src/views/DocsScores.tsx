import React from 'react';
import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import DocsPager from '../components/DocsPager';
import DocsSectionNav from '../components/DocsSectionNav';

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
      'Measures how attractive Bitcoin looks from a long-term valuation perspective by combining a stock metric (MVRV) with a flow metric (LTH SOPR).',
    formula:
      'If MVRV < 1.0 and LTH_SOPR < 1.0 => 3; else if MVRV < 1.0 or (MVRV < 1.8 and LTH_SOPR < 1.0) => 2; else if MVRV < 3.5 => 1; else => 0.',
    rationale:
      'MVRV tells us whether the market is trading below or above realized value. LTH SOPR adds a behavioral layer by checking whether long-term holders are capitulating. Together they distinguish deep-value washouts from normal bull-market conditions and late-cycle euphoria.',
    thresholds: [
      '3 = extreme deep value. Both MVRV and LTH SOPR point to capitulation.',
      '2 = strong value. Either MVRV is deeply cheap, or valuation is fair but long-term holders are still capitulating.',
      '1 = fair / neutral. Not especially cheap, but not euphoric either.',
      '0 = overheated. MVRV >= 3.5, which historically clusters near late-cycle tops.',
    ],
    notes: [
      'The 3.5 ceiling is intentionally higher than the entry zone because Bitcoin often trades above 1.8 for long stretches during bull markets.',
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
    badge: 'CYCLE_SCORE',
    meaning:
      'Nowcasts the macro backdrop using recession-risk and expansion signals from labor, rates, and manufacturing.',
    formula:
      'Score 0 if SAHM >= 0.50 or YC_M < 0 or (NO_YOY < 0 and NO_MOM3 <= 0). Score 2 if SAHM < 0.35 and YC_M >= 0.75 and NO_YOY >= 0. Otherwise score 1.',
    rationale:
      'No single macro indicator is reliable enough on its own. The Sahm Rule captures labor weakness, the yield curve captures recession expectations, and New Orders captures real-economy demand. Combining them reduces false positives and gives a cleaner view of whether the model should lean defensive or constructive.',
    thresholds: [
      '2 = expansion. Labor is healthy, the curve is positive enough, and manufacturing demand is not deteriorating.',
      '1 = stabilizing / mixed. The economy is not clearly in expansion or recession-risk.',
      '0 = recession-risk. Any one of the defensive triggers is enough to block a bullish interpretation.',
    ],
    notes: [
      'This score is conservative by design: one strong recession signal is enough to move it to 0.',
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
    <Box sx={{ maxWidth: 980, mx: 'auto' }}>
      <Stack spacing={3}>
        <DocsSectionNav />

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
    </Box>
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
