import React from 'react';
import { Box, Chip, Divider, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BOTTOM_FACTORS, BOTTOM_SCORE_BANDS, type BottomFactorKey } from '../../../utils/bottomScore';

/** Present factors in the same order as the Factors tab (independent of spec order). */
const FACTOR_ORDER: BottomFactorKey[] = ['onchain', 'capitulation', 'setup', 'repair', 'liquidity', 'macro'];

const FACTOR_BY_KEY = Object.fromEntries(BOTTOM_FACTORS.map((f) => [f.key, f]));
const ORDERED_FACTORS = FACTOR_ORDER.map((k) => FACTOR_BY_KEY[k]).filter(Boolean);

/** Inclusive 0–100 range string for a band given its position in the (desc) list. */
function bandRange(index: number): string {
  const lo = BOTTOM_SCORE_BANDS[index].min;
  const hi = index === 0 ? 100 : BOTTOM_SCORE_BANDS[index - 1].min - 1;
  return `${lo}–${hi}`;
}

const bandTone: Record<string, { bg: string; color: string }> = {
  'Capitulation Opportunity': { bg: 'rgba(34,197,94,0.20)', color: '#bbf7d0' },
  'Strong Accumulation': { bg: 'rgba(34,197,94,0.14)', color: '#bbf7d0' },
  'Accumulate Slowly': { bg: 'rgba(234,179,8,0.18)', color: '#fde68a' },
  Watch: { bg: 'rgba(148,163,184,0.18)', color: '#cbd5e1' },
  Avoid: { bg: 'rgba(239,68,68,0.16)', color: '#fecaca' },
};

const BottomDocs: React.FC = () => (
  <Stack spacing={2}>
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
        How the Bottom Accumulation Score works
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.8 }}>
        The score adds up five factors into a 0–100 total. Four are worth 20 points each (on-chain value,
        capitulation, liquidity, macro) and the fifth — price structure — is split into two 10-point halves
        (price damage and price repair). Higher totals mean deeper value and a stronger, lower-risk setup to
        accumulate.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
        Every factor is built from a handful of <strong>sub-scores</strong>. Each sub-score has an ordered
        list of tiers; we walk them top to bottom and award the points for the <em>first</em> condition that
        is true (so the tiers are mutually exclusive, best-case first). A factor&apos;s points are the sum of
        its sub-scores, capped at the factor maximum. The <MuiLink component={RouterLink} to="../factors">Factors tab</MuiLink>{' '}
        shows each sub-score&apos;s live value and which tier is currently active.
      </Typography>
    </Paper>

    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
        Total score → action band
      </Typography>
      <Stack spacing={1}>
        {BOTTOM_SCORE_BANDS.map((b, i) => {
          const tone = bandTone[b.label] ?? { bg: 'rgba(148,163,184,0.16)', color: '#cbd5e1' };
          return (
            <Stack key={b.label} direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
              <Chip
                size="small"
                label={bandRange(i)}
                sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 800, minWidth: 64 }}
              />
              <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 180 }}>
                {b.label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Suggested staged deployment: {b.deployment}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Paper>

    {ORDERED_FACTORS.map((factor) => (
      <Paper key={factor.key} sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1, minWidth: 200 }}>
            {factor.label}
          </Typography>
          <Chip
            size="small"
            label={`0–${factor.max} pts`}
            sx={{ bgcolor: 'rgba(34,197,94,0.14)', color: '#bbf7d0', fontWeight: 800 }}
          />
        </Stack>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          <strong>What it asks:</strong> {factor.purpose}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
          {factor.interpretation}
        </Typography>

        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
          How it scores
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {factor.subs.map((sub) => (
            <Box key={sub.label}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 200 }}>
                  {sub.label}
                </Typography>
                <Chip size="small" variant="outlined" label={`up to +${sub.max}`} sx={{ fontWeight: 700 }} />
              </Stack>
              <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {sub.rules.map((rule, i) => (
                  <li key={i}>
                    <Typography variant="caption" color="text.secondary">
                      {rule.when} →{' '}
                      <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        +{rule.points}
                      </Box>
                    </Typography>
                  </li>
                ))}
              </Box>
            </Box>
          ))}
        </Stack>

        {factor.note && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {factor.note}
            </Typography>
          </>
        )}
      </Paper>
    ))}

    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="body2">
        Related:{' '}
        <MuiLink component={RouterLink} to="../factors">Live factor breakdown</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/scores">Full scores reference</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/indicators/valuation">Valuation &amp; on-chain indicators</MuiLink>
      </Typography>
    </Paper>
  </Stack>
);

export default BottomDocs;
