import React from 'react';
import { Box, Link as MuiLink, Paper, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const CoreMacroDocs: React.FC = () => (
  <Paper sx={{ p: { xs: 2, sm: 3 } }}>
    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>How CORE + MACRO works</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.8 }}>
      CORE is driven by valuation (VAL_SCORE) and the price regime; it stays ON through deep-value
      capitulation so accumulation continues at bear-market bottoms. MACRO combines the liquidity and
      business-cycle regimes with a persistence-filtered USD gate. Both the price regime and the USD
      score use a 20/30-day persistence filter to avoid whipsaws.
    </Typography>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2">
        Full reference:{' '}
        <MuiLink component={RouterLink} to="/docs/scores">Scores</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/signals">Signals</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/architecture">Architecture</MuiLink>{' · '}
        <MuiLink component={RouterLink} to="/docs/data">Data Feeds</MuiLink>
      </Typography>
    </Box>
  </Paper>
);

export default CoreMacroDocs;
