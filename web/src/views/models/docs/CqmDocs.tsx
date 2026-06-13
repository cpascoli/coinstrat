import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

const CqmDocs: React.FC = () => (
  <Paper sx={{ p: { xs: 2, sm: 3 } }}>
    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>How the CoinStrat Quantile Model works</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.8 }}>
      CQM fits quantile-regression bands across BTC&apos;s full price history and converts the latest
      price into a fair-value risk between 0% (deep value) and 100% (euphoric). The model holds the QR
      50% fair value fixed at the snapshot date and sweeps hypothetical prices to produce the
      risk-vs-price curve.
    </Typography>
    <Box component="ul" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <li><Typography variant="body2"><strong>0–25% — Buy zone:</strong> deep value, size up DCA.</Typography></li>
      <li><Typography variant="body2"><strong>25–50% — Accumulate:</strong> fair to cheap.</Typography></li>
      <li><Typography variant="body2"><strong>50–75% — Trim:</strong> richening, reduce adds.</Typography></li>
      <li><Typography variant="body2"><strong>75–100% — Sell zone:</strong> euphoric, distribute.</Typography></li>
    </Box>
    <Typography variant="body2" sx={{ mt: 2 }}>
      Risk drives the CQM Risk-Weighted DCA strategy available in the Lab.
    </Typography>
  </Paper>
);

export default CqmDocs;
