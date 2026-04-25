import React from 'react';
import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

type Stage = {
  title: string;
  badge: string;
  summary: string;
  details: string[];
};

const PIPELINE: Stage[] = [
  {
    title: 'Raw Data Series',
    badge: 'Inputs',
    summary:
      'CoinStrat starts from external time series covering liquidity, macro conditions, BTC price, and on-chain valuation.',
    details: [
      'Macro/liquidity inputs include `WALCL`, `WTREGEN`, `RRPONTSYD`, `DTWEXBGS`, `SAHMREALTIME`, `T10Y3M`, and `ISM_PMI` (ISM Manufacturing PMI).',
      'Market and on-chain inputs include `BTCUSD`, `MVRV`, `LTH_SOPR`, and `SIP`.',
      '`NUPL` (Net Unrealized Profit/Loss) is derived from MVRV as `1 − 1/MVRV` and used directly in `VAL_SCORE`.',
      'Additional context series like `ECB_RAW`, `BOJ_RAW`, `EURUSD`, and `JPYUSD` are also cached for transparency and future expansion.',
      'All series are aligned onto a common daily timeline with forward-filling where appropriate so the model can evaluate a full state each day.',
    ],
  },
  {
    title: 'Engineered Higher-Level Metrics',
    badge: 'Feature Layer',
    summary:
      'The raw series are transformed into a smaller set of derived metrics that capture impulse, trend, and regime information.',
    details: [
      '`US_LIQ = WALCL - WTREGEN - RRPONTSYD`, plus `US_LIQ_YOY` and `US_LIQ_13W_DELTA`, convert three balance-sheet series into one liquidity signal.',
      '`DXY_MA50`, `DXY_MA200`, and `DXY_ROC20` turn the broad dollar index into a regime feature set.',
      '`ISM_PMI_ABOVE50_DAYS` and `ISM_PMI_BELOW45_DAYS` track ISM PMI persistence streaks for the business cycle score. `NO_YOY` and `NO_MOM3` are still computed from AMTMNO for display.',
      '`BTC_MA40W`, `PRICE_REGIME`, and `PRICE_REGIME_ON` convert BTC price into a trend filter with persistence.',
      '`SIP_EUPHORIA_FLAG`, `SIP_EXHAUSTED`, and `SIP_OBS_DAYS` create a stateful late-cycle exhaustion detector.',
    ],
  },
  {
    title: 'Factor Scores',
    badge: 'Scoring Layer',
    summary:
      'The engineered metrics are then discretized into interpretable scores so the model can reason in a stable, rule-based way.',
    details: [
      '`VAL_SCORE` summarizes whether Bitcoin is in deep value, fair value, or euphoria by combining `NUPL` (derived from `MVRV`) and `LTH_SOPR`.',
      '`LIQ_SCORE` translates net-liquidity expansion or contraction into a 0-2 score.',
      '`BIZ_CYCLE_SCORE` uses Sahm Rule, the yield curve, and ISM Manufacturing PMI (with persistence filters) to estimate whether the macro backdrop is expansionary, mixed, or recession-risk. Recession requires 2-of-3 confirmation.',
      '`DXY_SCORE` measures whether the dollar is a headwind, neutral, or supportive, with a persistence filter to avoid false positives.',
    ],
  },
  {
    title: 'Stateful Signals',
    badge: 'Signal Layer',
    summary:
      'Scores do not directly tell you what to do. They first feed stateful signals that encode entry, hold, exit, and acceleration logic.',
    details: [
      '`CORE_ON` is the primary permission engine. It uses valuation and trend to decide whether accumulation is allowed.',
      '`MACRO_ON` is an intensity modifier, not a separate buy permission. It turns on only when liquidity and business cycle are strong enough and the dollar is not a headwind.',
      '`ACCUM_ON` is the final permission and currently equals `CORE_ON`.',
      'Because these are stateful signals, they are not recalculated from scratch each day in a purely stateless way. The prior regime matters, especially for `CORE_ON` and the SIP exhaustion state machine.',
    ],
  },
  {
    title: 'Portfolio Output',
    badge: 'Decision Layer',
    summary:
      'The final output is a simple operational instruction: pause, accumulate at the base rate, or accelerate accumulation.',
    details: [
      'If `ACCUM_ON = 0`, the model says do not deploy fresh capital.',
      'If `ACCUM_ON = 1` and `MACRO_ON = 0`, the model allows base-rate accumulation.',
      'If `ACCUM_ON = 1` and `MACRO_ON = 1`, the model keeps accumulation on but increases sizing intensity.',
      'This separation makes CoinStrat easier to explain: Core answers whether to buy, Macro answers how aggressively to buy.',
    ],
  },
];

const DocsArchitecture: React.FC = () => {
  return (
    <DocsPageLayout>
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="h3"
            component="h1"
            sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}
          >
            Architecture
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 780 }}>
            CoinStrat is a layered decision engine. It does not jump directly from raw data to a
            trading signal. Instead, it progressively transforms noisy time series into derived
            metrics, then into factor scores, then into stateful signals, and finally into a simple
            accumulation permission.
          </Typography>
        </Box>

        <Card
          sx={{
            borderColor: 'rgba(148,163,184,0.35)',
            background: 'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
            boxShadow: 'none',
          }}
        >
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 900, mb: 2 }}>
              End-to-End Flow
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} useFlexGap flexWrap="wrap">
              {[
                'Data Feeds',
                'Derived Metrics',
                'Scores',
                'Signals',
              ].map((step) => (
                <Chip
                  key={step}
                  label={step}
                  sx={{
                    fontWeight: 700,
                    px: 0.75,
                    bgcolor: 'rgba(96,165,250,0.14)',
                    border: '1px solid rgba(96,165,250,0.35)',
                  }}
                />
              ))}
            </Stack>
          </CardContent>
        </Card>

        {PIPELINE.map((stage) => (
          <StageCard key={stage.title} stage={stage} />
        ))}

        <Card
          sx={{
            borderColor: 'rgba(148,163,184,0.35)',
            background: 'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
            boxShadow: 'none',
          }}
        >
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Why This Architecture Exists
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: 1.75 }}>
                Each layer reduces complexity. Raw time series are noisy and difficult to compare
                directly. Engineered metrics turn them into interpretable features, scores make
                them stable and comparable, and stateful signals prevent the model from overreacting
                to one-day moves. The result is a rules-based system that is easier to audit,
                explain, and operate than a single black-box formula.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <DocsPager />
      </Stack>
    </DocsPageLayout>
  );
};

const StageCard: React.FC<{ stage: Stage }> = ({ stage }) => (
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
            {stage.title}
          </Typography>
          <Chip label={stage.badge} sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
        </Stack>

        <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: 1.75 }}>
          {stage.summary}
        </Typography>

        <Divider />

        <Stack component="ul" spacing={0.9} sx={{ pl: 2 }}>
          {stage.details.map((line) => (
            <Typography component="li" variant="body2" key={line} sx={{ color: 'text.primary', lineHeight: 1.75 }}>
              {line}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </CardContent>
  </Card>
);

export default DocsArchitecture;
