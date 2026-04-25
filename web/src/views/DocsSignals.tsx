import React from 'react';
import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

type SignalDoc = {
  title: string;
  badge: string;
  meaning: string;
  formula: string;
  rationale: string;
  rules: string[];
  notes?: string[];
};

const SIGNALS: SignalDoc[] = [
  {
    title: 'Price Regime',
    badge: 'PRICE_REGIME / PRICE_REGIME_ON',
    meaning:
      'A binary trend filter that checks whether Bitcoin is trading above or below its 40-week moving average.',
    formula:
      'PRICE_REGIME = 1 if BTCUSD >= BTC_MA40W, else 0. PRICE_REGIME_ON = 1 only if the raw condition has been true for at least 20 of the last 30 days.',
    rationale:
      'The 40-week moving average is a simple way to separate healthy uptrends from structurally weak environments. The persistence filter reduces whipsaws around the moving average so the Core Engine does not react to every short-lived cross.',
    rules: [
      'Raw state: compare BTCUSD to the 40-week moving average built from weekly closes.',
      'Effective state: require the raw bullish condition to hold on at least 20 of the last 30 days.',
      'Used as the trend confirmation gate for Core entries and as part of one Core exit path.',
    ],
  },
  {
    title: 'Core Engine',
    badge: 'CORE_ON',
    meaning:
      'The main accumulation permission. It decides whether CoinStrat should be in base accumulation mode or stay sidelined.',
    formula:
      'Entry when VAL_SCORE >= 3 or (VAL_SCORE >= 1 and PRICE_REGIME_ON = 1). Exit when (PRICE_REGIME_ON = 0 and VAL_SCORE <= 1) or (SIP_EXHAUSTED = 1 and VAL_SCORE = 0).',
    rationale:
      'The Core Engine is designed to buy deep value aggressively, stay invested through normal bull-market noise, and exit when trend damage and valuation no longer justify accumulation. It is intentionally stateful so it can hold through noisy intermediate conditions instead of flipping every day.',
    rules: [
      'Entry rule 1: extreme value alone is enough. If VAL_SCORE = 3, no trend confirmation is required.',
      'Entry rule 2: if valuation is at least fair and trend is constructive, Core can turn on.',
      'Exit rule A: if the trend breaks and valuation is no longer deep value, Core turns off.',
      'Exit rule B: if the market enters a euphoria exhaustion pattern while valuation is truly euphoric, Core can turn off before the trend filter fully breaks.',
    ],
    notes: [
      'DXY is not used for Core entry. The dollar filter only affects the Macro Accelerator.',
      'The Core Engine is a state machine, so it explicitly tracks whether it is already on or off.',
    ],
  },
  {
    title: 'Euphoria Exhaustion',
    badge: 'SIP_EUPHORIA_FLAG / SIP_EXHAUSTED',
    meaning:
      'A two-phase exit mechanism based on Supply in Profit that tries to detect when a mature bull market has started to roll over.',
    formula:
      'Arm when SIP > 95 for at least 14 of the last 21 days. Then open an observation window once SIP drops below 90. If SIP does not reclaim 95 within 45 days, set SIP_EXHAUSTED = 1.',
    rationale:
      'Late-cycle tops often do not fail in one clean step. This sequence captures an overheated market, a loss of momentum, and a failed recovery. It gives the model a way to exit before the longer-term trend filter fully breaks down.',
    rules: [
      'Phase 1: arm the setup after at least 14 of the last 21 days above 95 percent Supply in Profit.',
      'Phase 2: once armed, a drop below 90 percent starts the observation clock.',
      'If SIP reclaims 95 percent within 45 days, the setup resets and no exhaustion is confirmed.',
      'If SIP fails to reclaim within 45 days, SIP_EXHAUSTED becomes true and can force a Core exit only while VAL_SCORE = 0.',
    ],
    notes: [
      'This logic is meant to catch bull-market deterioration that may appear before price loses the 40-week trend filter, while avoiding fair-valuation whipsaws.',
    ],
  },
  {
    title: 'Macro Accelerator',
    badge: 'MACRO_ON',
    meaning:
      'An intensity modifier that increases the accumulation rate when the macro backdrop is especially supportive.',
    formula:
      'MACRO_ON = 1 when (LIQ_SCORE + BIZ_CYCLE_SCORE) >= 3 and DXY_SCORE >= 1.',
    rationale:
      'CoinStrat separates the question "Should we accumulate?" from "How aggressively should we accumulate?" Liquidity and business-cycle conditions answer the second question. When they align and the dollar is not a headwind, the model can lean harder into the trend.',
    rules: [
      'Liquidity and Business Cycle must sum to at least 3.',
      'The effective DXY score must be at least neutral.',
      'When active, the intended behavior is accelerated accumulation, not a separate permission state.',
    ],
    notes: [
      'In the app and newsletter this is often described as the Macro Accelerator or 3x DCA mode.',
    ],
  },
  {
    title: 'Final Accumulation Permission',
    badge: 'ACCUM_ON',
    meaning:
      'The final yes/no permission to deploy capital.',
    formula:
      'ACCUM_ON = CORE_ON.',
    rationale:
      'This keeps the model easy to reason about. Core decides whether buying is allowed at all. Macro does not override Core; it only changes the pace of buying when Core is already on.',
    rules: [
      'If CORE_ON = 0, accumulation is off no matter what Macro says.',
      'If CORE_ON = 1 and MACRO_ON = 0, accumulation stays on at the base rate.',
      'If CORE_ON = 1 and MACRO_ON = 1, accumulation stays on and the model shifts to accelerated sizing.',
    ],
  },
];

const DocsSignals: React.FC = () => {
  return (
    <DocsPageLayout>
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="h3"
            component="h1"
            sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}
          >
            Signals
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 760 }}>
            Signals are the second layer of the model. They transform the raw factor scores into
            actual portfolio permissions: when to accumulate, when to accelerate, and when to pause.
          </Typography>
        </Box>

        {SIGNALS.map((signal) => (
          <SignalCard key={signal.badge} signal={signal} />
        ))}

        <DocsPager />
      </Stack>
    </DocsPageLayout>
  );
};

const SignalCard: React.FC<{ signal: SignalDoc }> = ({ signal }) => (
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
            {signal.title}
          </Typography>
          <Chip label={signal.badge} sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
        </Stack>

        <SectionBlock label="Meaning" text={signal.meaning} />
        <SectionBlock label="Formula" text={signal.formula} monospace />
        <SectionBlock label="Why It Matters" text={signal.rationale} />

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary">
            Decision Rules
          </Typography>
          <Stack component="ul" spacing={0.75} sx={{ mt: 0.75, pl: 2 }}>
            {signal.rules.map((line) => (
              <Typography component="li" variant="body2" key={line} sx={{ color: 'text.primary', lineHeight: 1.7 }}>
                {line}
              </Typography>
            ))}
          </Stack>
        </Box>

        {signal.notes && signal.notes.length > 0 && (
          <>
            <Divider />
            <Box>
              <Typography variant="overline" color="text.secondary">
                Notes
              </Typography>
              <Stack component="ul" spacing={0.75} sx={{ mt: 0.75, pl: 2 }}>
                {signal.notes.map((line) => (
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

export default DocsSignals;
