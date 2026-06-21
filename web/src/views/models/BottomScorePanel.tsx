import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import type { SignalData } from '../../App';
import ChartsView from '../ChartsView';

interface Props {
  current: SignalData;
  history: SignalData[];
}

/**
 * Bottom Accumulation Score panel — headline score, suggested deployment range,
 * the six component sub-scores, and the score-vs-price history chart. Used on
 * the Bottom model's Overview tab.
 */
const BottomScorePanel: React.FC<Props> = ({ current, history }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
  <Card
    sx={{
      border: '1px solid',
      borderColor: bottomScoreColor(current.BOTTOM_ACCUM_SCORE),
      backgroundImage: 'radial-gradient(700px circle at 15% 0%, rgba(34,197,94,0.18), transparent 55%)',
    }}
  >
    <CardHeader
      title={<Typography sx={{ fontWeight: 900 }}>Bottom Accumulation Score</Typography>}
      subheader="How attractive current conditions are for staged BTC deployment."
      action={
        <Chip
          label={current.BOTTOM_ACCUM_BAND ?? bottomScoreBand(current.BOTTOM_ACCUM_SCORE)}
          color={bottomScoreMuiColor(current.BOTTOM_ACCUM_SCORE) as any}
          variant="outlined"
        />
      }
    />
    <Divider />
    <CardContent>
      <Grid container spacing={2.5} alignItems="stretch">
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Current Score
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 950, mt: 0.5 }}>
                {fmtScore(current.BOTTOM_ACCUM_SCORE)}
                <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 0.75 }}>
                  / 100
                </Typography>
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Suggested deployment range: <strong>{current.BOTTOM_DEPLOYMENT_RANGE ?? bottomDeploymentRange(current.BOTTOM_ACCUM_SCORE)}</strong>
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Grid container spacing={1.25}>
            <BottomScoreChip label="On-chain value" value={current.BOTTOM_ONCHAIN_SCORE} />
            <BottomScoreChip label="Capitulation" value={current.BOTTOM_CAPITULATION_SCORE} />
            <BottomScoreChip label="Price damage" value={current.BOTTOM_PRICE_SETUP_SCORE} max={10} />
            <BottomScoreChip label="Liquidity" value={current.BOTTOM_LIQUIDITY_SCORE} />
            <BottomScoreChip label="Macro support" value={current.BOTTOM_MACRO_SCORE} />
            <BottomScoreChip label="Price repair" value={current.BOTTOM_PRICE_REPAIR_SCORE} max={10} />
          </Grid>
        </Grid>
      </Grid>
    </CardContent>
  </Card>

  <ChartsView data={history} chartIds={['bottom-score']} embedded />
  </Box>
);

function BottomScoreChip(props: { label: string; value?: number; max?: number }) {
  const value = Number(props.value);
  const max = props.max ?? 20;
  const score = Number.isFinite(value) ? value : 0;
  const strong = score >= max * 0.7;
  const partial = score >= max * 0.4;
  return (
    <Grid item xs={12} sm={6} lg={4}>
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, height: '100%' }}>
        <Typography variant="overline" color="text.secondary">
          {props.label}
        </Typography>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={1}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            {Number.isFinite(value) ? Math.round(value) : 'n/a'}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              / {max}
            </Typography>
          </Typography>
          <Chip size="small" label={strong ? 'strong' : partial ? 'partial' : 'weak'} color={(strong ? 'success' : partial ? 'primary' : 'default') as any} variant="outlined" />
        </Stack>
      </Box>
    </Grid>
  );
}

function fmtScore(x: any): string {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round(v).toString() : 'n/a';
}

function bottomScoreBand(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v)) return 'Unavailable';
  if (v >= 85) return 'Capitulation Opportunity';
  if (v >= 70) return 'Strong Accumulation';
  if (v >= 50) return 'Accumulate Slowly';
  if (v >= 25) return 'Watch';
  return 'Avoid';
}

function bottomDeploymentRange(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v)) return 'n/a';
  if (v >= 85) return '75-100%';
  if (v >= 70) return '50-75%';
  if (v >= 50) return '25-40%';
  if (v >= 25) return '0-10%';
  return '0%';
}

function bottomScoreMuiColor(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v) || v < 25) return 'default';
  if (v < 50) return 'warning';
  if (v < 70) return 'primary';
  return 'success';
}

function bottomScoreColor(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v) || v < 25) return 'divider';
  if (v < 50) return 'warning.main';
  if (v < 70) return 'primary.main';
  return 'success.main';
}

export default BottomScorePanel;
