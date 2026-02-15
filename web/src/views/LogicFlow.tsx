import React, { useMemo } from 'react';
import { SignalData } from '../App';
import { Binary, ShieldCheck, Zap, ToggleRight } from 'lucide-react';
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

interface Props {
  current: SignalData;
}

const LogicFlow: React.FC<Props> = ({ current }) => {
  const coreStatus = current.CORE_ON === 1;
  const macroStatus = current.MACRO_ON === 1;
  const accumStatus = current.ACCUM_ON === 1;

  const macroScoreSum = useMemo(() => current.LIQ_SCORE + current.CYCLE_SCORE, [current.LIQ_SCORE, current.CYCLE_SCORE]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Binary className="h-8 w-8 text-blue-400" />
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
          Signal Synthesis
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={6}>
          <Card>
            <CardHeader
              avatar={<ShieldCheck className="h-6 w-6 text-blue-300" />}
              title={<Typography sx={{ fontWeight: 900 }}>Core Engine (CORE)</Typography>}
              subheader="State-machine for value-led accumulation (entry/hold/exit)."
              action={
                <Chip
                  label={coreStatus ? 'ACTIVE' : 'IDLE'}
                  color={coreStatus ? 'success' : 'default'}
                  variant={coreStatus ? 'filled' : 'outlined'}
                  size="small"
                />
              }
            />
            <Divider />
            <CardContent>
              <Stack spacing={1.25}>
                <LogicRule
                  title="Entry condition"
                  formula="(VAL_SCORE ≥ 3) OR (VAL_SCORE ≥ 1 AND PRICE_REGIME = 1)  —  requires DXY_SCORE ≥ 1"
                  active={coreStatus}
                />
                <LogicRule
                  title="Risk filter (with 20/30 persistence)"
                  formula="DXY_SCORE ≥ 1 (requires DXY favorable ≥ 20/30 days)"
                  active={current.DXY_SCORE >= 1}
                />
                <LogicRule
                  title="Exit condition 1"
                  formula="PRICE_REGIME = 0 AND VAL_SCORE ≤ 2 (bearish trend + not extreme conviction)"
                  active={current.PRICE_REGIME_ON === 0 && current.VAL_SCORE <= 2}
                  tone="danger"
                />
                <LogicRule
                  title="Exit condition 2"
                  formula="VAL_SCORE = 0 AND DXY_SCORE = 0 (overheated + USD headwind)"
                  active={current.VAL_SCORE === 0 && current.DXY_SCORE === 0}
                  tone="danger"
                />

                <Divider sx={{ my: 1 }} />

                <Grid container spacing={1.25}>
                  <Grid item xs={4}>
                    <MetricChip title="Valuation" label="VAL_SCORE" value={current.VAL_SCORE} />
                  </Grid>
                  <Grid item xs={4}>
                    <MetricChip title="MVRV" label="MVRV" value={typeof current.MVRV === 'number' ? current.MVRV.toFixed(2) : '–'} />
                  </Grid>
                  <Grid item xs={4}>
                    <MetricChip title="LTH SOPR" label="LTH_SOPR" value={typeof (current as any).LTH_SOPR === 'number' ? ((current as any).LTH_SOPR as number).toFixed(2) : '–'} />
                  </Grid>
                  <Grid item xs={6}>
                    <MetricChip title="Price Regime" label="PRICE_REGIME" value={current.PRICE_REGIME_ON} />
                  </Grid>
                  <Grid item xs={6}>
                    <MetricChip title="DXY (eff.)" label="DXY_SCORE" value={current.DXY_SCORE} />
                  </Grid>
                  <Grid item xs={4}>
                    <MetricChip title="DXY (raw)" label="DXY_SCORE_RAW" value={(current as any).DXY_SCORE_RAW ?? '–'} />
                  </Grid>
                  <Grid item xs={4}>
                    <MetricChip title="DXY Persist" label="DXY_PERSIST" value={(current as any).DXY_PERSIST ?? '–'} />
                  </Grid>
                </Grid>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={6}>
          <Card>
            <CardHeader
              avatar={<Zap className="h-6 w-6 text-amber-300" />}
              title={<Typography sx={{ fontWeight: 900 }}>Macro Accelerator (MACRO)</Typography>}
              subheader="Intensity modifier: 3× DCA when liquidity + business cycle align and USD is not risk-off. Only active while CORE is ON."
              action={
                <Chip
                  label={macroStatus ? 'ACTIVE' : 'IDLE'}
                  color={macroStatus ? 'success' : 'default'}
                  variant={macroStatus ? 'filled' : 'outlined'}
                  size="small"
                />
              }
            />
            <Divider />
            <CardContent>
              <Stack spacing={1.25}>
                <LogicRule
                  title="Accelerator formula"
                  formula="(LIQ + BIZ_CYCLE ≥ 3) AND (DXY ≥ 1, persistence-filtered)"
                  active={macroStatus}
                />

                <Grid container spacing={1.25}>
                  <Grid item xs={6}>
                    <MetricChip title="Liquidity" label="LIQ_SCORE" value={current.LIQ_SCORE} />
                  </Grid>
                  <Grid item xs={6}>
                    <MetricChip title="Business Cycle" label="BIZ_CYCLE_SCORE" value={current.CYCLE_SCORE} />
                  </Grid>
                  <Grid item xs={6}>
                    <MetricChip title="Liquidity + Business Cycle" label="LIQ_SCORE+BIZ_CYCLE_SCORE" value={macroScoreSum} />
                  </Grid>
                  <Grid item xs={6}>
                    <MetricChip title="USD Regime" label="DXY_SCORE" value={current.DXY_SCORE} />
                  </Grid>
                </Grid>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card
            sx={{
              borderColor: accumStatus ? 'success.main' : 'error.main',
              borderWidth: 2,
              borderStyle: 'solid',
              backgroundImage: accumStatus
                ? 'radial-gradient(700px circle at 20% 0%, rgba(34,197,94,0.10), transparent 50%)'
                : 'radial-gradient(700px circle at 20% 0%, rgba(239,68,68,0.10), transparent 50%)',
            }}
          >
            <CardHeader
              avatar={<ToggleRight className="h-7 w-7 text-blue-300" />}
              title={<Typography sx={{ fontWeight: 900 }}>Final Permission (ACCUM)</Typography>}
              subheader="Final permission to deploy capital. ACCUM = CORE. MACRO only modifies DCA intensity (3×) when CORE is already ON."
              action={
                <Chip
                  label={accumStatus ? 'ON' : 'OFF'}
                  color={accumStatus ? 'success' : 'error'}
                  variant="filled"
                  size="small"
                />
              }
            />
            <Divider />
            <CardContent>
              <Grid container spacing={1.25} alignItems="stretch">
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="overline" color="text.secondary">
                        CORE ENGINE
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 900, mt: 0.5 }}>
                        {coreStatus ? 'ENABLED' : 'DISABLED'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Valuation/regime-led baseline accumulation.
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="overline" color="text.secondary">
                        MACRO ACCELERATOR
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 900, mt: 0.5 }}>
                        {macroStatus ? 'ENABLED' : 'DISABLED'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Intensity modifier: 3× DCA when active alongside CORE.
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: '100%',
                      borderColor: accumStatus ? 'success.main' : 'error.main',
                      backgroundColor: accumStatus ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    }}
                  >
                    <CardContent>
                      <Typography variant="overline" color="text.secondary">
                        RESULT
                      </Typography>
                      <Typography variant="h4" sx={{ fontWeight: 950, mt: 0.5 }}>
                        {accumStatus ? 'ON' : 'OFF'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {accumStatus
                          ? (macroStatus ? 'Permission granted — accelerated (3×) accumulation.' : 'Permission granted to accumulate (base rate).')
                          : 'Capital protection: pause buys.'}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

function LogicRule(props: { title: string; formula: string; active: boolean; tone?: 'default' | 'danger' }) {
  const { title, formula, active, tone = 'default' } = props;

  const borderColor = tone === 'danger' ? (active ? 'rgba(239,68,68,0.6)' : 'rgba(148,163,184,0.25)') : active ? 'rgba(96,165,250,0.6)' : 'rgba(148,163,184,0.25)';
  const bgColor = tone === 'danger' ? (active ? 'rgba(239,68,68,0.10)' : 'rgba(2,6,23,0.20)') : active ? 'rgba(96,165,250,0.10)' : 'rgba(2,6,23,0.20)';

  return (
    <Box sx={{ border: `1px solid ${borderColor}`, backgroundColor: bgColor, borderRadius: 2, px: 2, py: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        <Chip
          size="small"
          variant={active ? 'filled' : 'outlined'}
          color={tone === 'danger' ? (active ? 'error' : 'default') : active ? 'primary' : 'default'}
          label={active ? 'TRUE' : 'FALSE'}
        />
      </Box>
      <Typography
        variant="body2"
        sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontWeight: 800 }}
      >
        {formula}
      </Typography>
    </Box>
  );
}

function MetricChip(props: { title: string; label: string; value: number | string }) {
  const { title, label, value } = props;
  const v = typeof value === 'number' ? value : value;
  const color =
    typeof v === 'number'
      ? v === 0
        ? 'error'
        : v === 1
          ? 'primary'
          : 'success'
      : v === 'ON'
        ? 'success'
        : 'default';

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.15)' }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          {String(value)}
        </Typography>
        <Chip size="small" label={label} color={color as any} variant="outlined" />
      </Stack>
    </Box>
  );
}

export default LogicFlow;

