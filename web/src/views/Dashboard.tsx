import React, { useMemo } from 'react';
import { SignalData } from '../App';
import { AlertTriangle, CheckCircle2, PauseCircle, PlayCircle, TrendingUp, Info, Activity } from 'lucide-react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

interface Props {
  current: SignalData;
  history: SignalData[];
}

const Dashboard: React.FC<Props> = ({ current, history }) => {
  // Determine recommendation (mirroring dashboard_2026.py logic)
  const getRecommendation = () => {
    const accum = current.ACCUM_ON;
    const macro = current.MACRO_ON;
    const pr = current.PRICE_REGIME_ON;
    const dxy = current.DXY_SCORE;
    const liq = current.LIQ_SCORE;
    const cyc = current.CYCLE_SCORE;
    const val = current.VAL_SCORE;

    let action: 'PAUSE' | 'BASE' | 'ACCEL' = 'PAUSE';
    let reason = '';
    const blockers: string[] = [];

    if (pr === 0) blockers.push("Price below long-term trend.");
    if (dxy === 0) blockers.push("USD regime risk-off (DXY strengthening).");
    if (liq === 0) blockers.push("Liquidity contracting/worsening.");
    if (cyc === 0) blockers.push("Business cycle contraction-risk elevated.");
    if (val === 0) blockers.push("Valuation overheated.");

    if (accum === 0) {
      action = 'PAUSE';
      reason = "Accumulation permission is OFF. Capital protection prioritized.";
    } else if (macro === 1) {
      action = 'ACCEL';
      reason = "Accumulation permitted with Macro Accelerator active (Liquidity/Business Cycle tailwinds).";
    } else {
      action = 'BASE';
      reason = "Base accumulation permitted. No macro acceleration detected.";
    }

    return { action, reason, blockers };
  };

  const rec = getRecommendation();
  const trendOk = current.PRICE_REGIME_ON === 1;

  const actionTone = rec.action === 'PAUSE' ? 'error' : rec.action === 'ACCEL' ? 'success' : 'primary';
  const actionIcon =
    rec.action === 'PAUSE'
      ? <PauseCircle className="h-8 w-8 text-red-300" />
      : rec.action === 'ACCEL'
        ? <TrendingUp className="h-8 w-8 text-green-300" />
        : <PlayCircle className="h-8 w-8 text-blue-300" />;

  const statCards = useMemo(
    () => [
      { title: 'Liquidity', value: current.LIQ_SCORE, max: 2, icon: <Activity className="text-blue-300" /> },
      { title: 'Business Cycle', value: current.CYCLE_SCORE, max: 2, icon: <TrendingUp className="text-emerald-300" /> },
      { title: 'USD', value: current.DXY_SCORE, max: 2, icon: <Activity className="text-amber-300" /> },
      { title: 'Valuation', value: current.VAL_SCORE, max: 2, icon: <Info className="text-violet-300" /> },
    ],
    [current]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Hero: Action */}
      <Card
        sx={{
          borderWidth: 2,
          borderStyle: 'solid',
          borderColor: rec.action === 'PAUSE' ? 'error.main' : rec.action === 'ACCEL' ? 'success.main' : 'primary.main',
          backgroundImage:
            rec.action === 'PAUSE'
              ? 'radial-gradient(700px circle at 15% 0%, rgba(239,68,68,0.32), transparent 55%)'
              : rec.action === 'ACCEL'
                ? 'radial-gradient(700px circle at 15% 0%, rgba(34,197,94,0.32), transparent 55%)'
                : 'radial-gradient(700px circle at 15% 0%, rgba(96,165,250,0.32), transparent 55%)',
        }}
      >
        <CardHeader
          avatar={actionIcon}
          title={<Typography sx={{ fontWeight: 950, letterSpacing: -0.4 }}>ACTION: {rec.action}</Typography>}
          subheader={rec.reason}
          action={<Chip label={rec.action} color={actionTone as any} variant="filled" />}
        />
        <Divider />
        <CardContent>
          <Grid container spacing={2.5} alignItems="stretch">
            <Grid item xs={12} md={4}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    BTC Price
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 950, mt: 0.5 }}>
                    ${current.BTCUSD.toLocaleString()}
                  </Typography>
                  <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1 }}>
                    {trendOk ? <CheckCircle2 className="h-4 w-4 text-green-300" /> : <AlertTriangle className="h-4 w-4 text-red-300" />}
                    <Typography variant="body2" color={trendOk ? 'success.main' : 'error.main'} sx={{ fontWeight: 800 }}>
                      Trend {trendOk ? 'Positive' : 'Negative'}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={8}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                    <Typography variant="overline" color="text.secondary">
                      Active blockers / risks
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={rec.blockers.length ? 'warning' : 'success'}
                      label={rec.blockers.length ? `${rec.blockers.length} items` : 'None detected'}
                    />
                  </Stack>
                  <Divider sx={{ my: 1.5 }} />

                  {rec.blockers.length ? (
                    <Grid container spacing={1.25}>
                      {rec.blockers.map((b, i) => (
                        <Grid item xs={12} sm={6} key={i}>
                          <Box
                            sx={{
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 2,
                              px: 2,
                              py: 1.25,
                              bgcolor: 'rgba(2,6,23,0.10)',
                              height: '100%',
                            }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {b}
                            </Typography>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No blockers detected.
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <Grid container spacing={2.5}>
        {statCards.map((s) => (
          <Grid item xs={12} sm={6} lg={3} key={s.title}>
            <ScoreMiniCard title={s.title} value={s.value} max={s.max} icon={s.icon} />
          </Grid>
        ))}
      </Grid>

      {/* Snapshot */}
      <Card>
        <CardHeader title={<Typography sx={{ fontWeight: 900 }}>Snapshot Metrics</Typography>} />
        <Divider />
        <CardContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'text.secondary', fontWeight: 900 }}>Metric</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontWeight: 900 }} align="right">
                    Value
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontWeight: 900 }} align="right">
                    Regime
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <SnapshotRow label="US Net Liquidity" value={fmtTrillions(current.US_LIQ)} score={current.LIQ_SCORE} />
                <SnapshotRow label="Liquidity YoY" value={fmtPct(current.US_LIQ_YOY)} score={current.LIQ_SCORE} />
                <SnapshotRow label="Sahm Rule" value={fmtNum(current.SAHM, 2)} score={current.CYCLE_SCORE} />
                <SnapshotRow label="Yield Curve (10Y-3M)" value={fmtNum(current.YC_M, 2)} score={current.CYCLE_SCORE} />
                <SnapshotRow label="MVRV" value={fmtNum(current.MVRV, 2)} score={current.VAL_SCORE} />
                <SnapshotRow label="BTC 40W MA" value={fmtUsd((current as any).BTC_MA40W)} score={current.PRICE_REGIME_ON} />
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

function ScoreMiniCard(props: { title: string; value: number; max: number; icon: React.ReactNode }) {
  const { title, value, max, icon } = props;
  const color = value === 0 ? 'error' : value === 1 ? 'primary' : 'success';
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
          <Typography variant="overline" color="text.secondary">
            {title}
          </Typography>
          {icon}
        </Stack>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={2} sx={{ mt: 0.5 }}>
          <Typography variant="h4" sx={{ fontWeight: 950 }}>
            {value}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.75 }}>
              / {max}
            </Typography>
          </Typography>
          <Chip size="small" label={value === 0 ? 'RISK' : value === 1 ? 'NEUTRAL' : 'OPTIMAL'} color={color as any} variant="outlined" />
        </Stack>
      </CardContent>
    </Card>
  );
}

function SnapshotRow(props: { label: string; value: string; score: number }) {
  const { label, value, score } = props;
  const color = score === 0 ? 'error' : score === 1 ? 'primary' : 'success';
  return (
    <TableRow hover>
      <TableCell sx={{ fontWeight: 700 }}>{label}</TableCell>
      <TableCell align="right" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontWeight: 800 }}>
        {value}
      </TableCell>
      <TableCell align="right">
        <Chip size="small" label={score} color={color as any} variant="outlined" />
      </TableCell>
    </TableRow>
  );
}

function fmtNum(x: any, digits = 2): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return x.toFixed(digits);
}

function fmtPct(x: any): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return `${x.toFixed(2)}%`;
}

function fmtTrillions(x: any): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return `$${(x / 1e6).toFixed(2)}T`;
}

function fmtUsd(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v)) return 'n/a';
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default Dashboard;

