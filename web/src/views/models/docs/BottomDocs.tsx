import React from 'react';
import { Box, Link as MuiLink, Paper, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const BUCKETS: { label: string; detail: string }[] = [
  { label: 'On-chain value (0–20)', detail: 'VAL_SCORE plus price vs short- and long-term holder realized prices.' },
  { label: 'Capitulation (0–20)', detail: 'LTH-SOPR, SIP and drawdown holder stress, combined with funding and open-interest deleveraging.' },
  { label: 'Liquidity turn (0–20)', detail: 'Liquidity regime, US net-liquidity impulse, G3 YoY and the USD score.' },
  { label: 'Macro risk (0–20)', detail: 'Business-cycle regime, Sahm rule, yield curve and ISM PMI.' },
  { label: 'Price structure (0–20)', detail: 'Drawdown depth, position vs the 40-week MA, momentum and base-repair stabilization.' },
];

const BottomDocs: React.FC = () => (
  <Paper sx={{ p: { xs: 2, sm: 3 } }}>
    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>How the Bottom Accumulation Score works</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.8 }}>
      The score sums five buckets, each capped at 20, for a 0–100 total. Higher totals indicate deeper
      value and stronger accumulation setups. The Factors tab shows each bucket&apos;s live contribution
      alongside the charts that drive it.
    </Typography>
    <Box component="ul" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {BUCKETS.map((b) => (
        <li key={b.label}>
          <Typography variant="body2"><strong>{b.label}:</strong> {b.detail}</Typography>
        </li>
      ))}
    </Box>
    <Typography variant="body2" sx={{ mt: 2 }}>
      Related:{' '}
      <MuiLink component={RouterLink} to="/docs/scores">Full scores reference</MuiLink>{' · '}
      <MuiLink component={RouterLink} to="/indicators/valuation">Valuation & On-chain indicators</MuiLink>
    </Typography>
  </Paper>
);

export default BottomDocs;
