import React, { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea,
} from 'recharts';
import { SignalData } from '../App';
import {
  runBacktest, BacktestConfig, StrategyResult, DcaFrequency, OffSignalMode,
} from '../services/backtest';
import { format } from 'date-fns';
import { FlaskConical, TrendingUp, Coins, BarChart3, ShieldAlert, DollarSign, ArrowDownToLine, Wallet } from 'lucide-react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

interface Props {
  data: SignalData[];
}

type RangeKey = 'all' | '5y' | '4y' | '3y' | '2y' | '1y' | 'custom';

const ALL_START_DATE = '2013-01-01';

const STRATEGY_COLORS: Record<string, string> = {
  'Baseline DCA': '#94a3b8',
  'CORE DCA': '#60a5fa',
  'CORE DCA + MACRO 3x': '#22c55e',
};

// Build system-state spans for regime shading (same logic as ChartsView)
type SystemSpan = { x1: number; x2: number; value: 0 | 1 | 2 | 3 };

function buildSystemSpans(rows: Array<{ ts: number } & Record<string, any>>): SystemSpan[] {
  const spans: SystemSpan[] = [];
  if (!rows.length) return spans;

  const mapState = (row: any): 0 | 1 | 2 | 3 | null => {
    const core = Number(row.CORE_ON);
    const macro = Number(row.MACRO_ON);
    if (![0, 1].includes(core) || ![0, 1].includes(macro)) return null;
    if (core === 0 && macro === 0) return 0;
    if (core === 0 && macro === 1) return 1;
    if (core === 1 && macro === 0) return 2;
    return 3;
  };

  let current: 0 | 1 | 2 | 3 | null = null;
  let startTs: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const v = mapState(rows[i]);
    const ts = rows[i].ts;
    if (v === null) continue;

    if (current === null) {
      current = v;
      startTs = ts;
      continue;
    }

    if (v !== current && startTs !== null) {
      const prevTs = rows[i - 1]?.ts ?? ts;
      if (prevTs > startTs) spans.push({ x1: startTs, x2: prevTs, value: current });
      current = v;
      startTs = ts;
    }
  }

  if (current !== null && startTs !== null) {
    const endTs = rows[rows.length - 1].ts;
    if (endTs > startTs) spans.push({ x1: startTs, x2: endTs, value: current });
  }

  return spans;
}

function systemColor(v: 0 | 1 | 2 | 3) {
  switch (v) {
    case 0: return { fill: '#ef4444', alpha: 0.20 };
    case 1: return { fill: '#94a3b8', alpha: 0.18 };
    case 2: return { fill: '#86efac', alpha: 0.20 };
    case 3: return { fill: '#22c55e', alpha: 0.20 };
  }
}

const Backtest: React.FC<Props> = ({ data }) => {
  const [range, setRange] = useState<RangeKey>('5y');
  const [customDate, setCustomDate] = useState<string>(ALL_START_DATE);
  const [frequency, setFrequency] = useState<DcaFrequency>('weekly');
  const [dcaAmount, setDcaAmount] = useState<number>(100);
  const [offSignalMode, setOffSignalMode] = useState<OffSignalMode>('pause');
  const [macroAccel, setMacroAccel] = useState<boolean>(true);

  // Compute start date from range selection or custom date
  const startDate = useMemo(() => {
    if (!data.length) return ALL_START_DATE;
    if (range === 'custom') return customDate;
    if (range === 'all') return ALL_START_DATE;
    const last = data[data.length - 1];
    const end = new Date(last.Date);
    const years = range === '5y' ? 5 : range === '4y' ? 4 : range === '3y' ? 3 : range === '2y' ? 2 : 1;
    const start = new Date(
      Date.UTC(end.getUTCFullYear() - years, end.getUTCMonth(), end.getUTCDate())
    );
    return start.toISOString().split('T')[0];
  }, [data, range, customDate]);

  // Run backtest
  const results = useMemo<StrategyResult[]>(() => {
    if (!data.length) return [];
    const config: BacktestConfig = {
      startDate,
      dcaAmount,
      frequency,
      offSignalMode,
      macroAccel,
      accelMultiplier: 3,
    };
    return runBacktest(data, config);
  }, [data, startDate, dcaAmount, frequency, offSignalMode, macroAccel]);

  // Build chart data by merging strategy series with signal data for regime shading
  const chartData = useMemo(() => {
    if (!results.length || !results[0].series.length) return [];

    // Use baseline series dates as the reference
    const baseline = results[0];
    const dateMap = new Map<string, any>();

    for (const pt of baseline.series) {
      const dt = new Date(pt.date);
      dateMap.set(pt.date, {
        date: pt.date,
        ts: dt.getTime(),
        fullDate: format(dt, 'yyyy-MM-dd'),
        btcPrice: pt.btcPrice,
      });
    }

    // Merge signal data for regime shading
    for (const d of data) {
      const entry = dateMap.get(d.Date);
      if (entry) {
        entry.CORE_ON = d.CORE_ON;
        entry.MACRO_ON = d.MACRO_ON;
        entry.ACCUM_ON = d.ACCUM_ON;
      }
    }

    // Merge each strategy's portfolio value and BTC held.
    // Replace 0 portfolio values with null so Recharts skips them on the
    // log-scale chart (log(0) = -Infinity breaks the entire line series).
    for (const result of results) {
      const key = result.name;
      const pvKey = `pv_${key}`;
      const btcKey = `btc_${key}`;
      for (const pt of result.series) {
        const entry = dateMap.get(pt.date);
        if (entry) {
          entry[pvKey] = pt.portfolioValue > 0 ? pt.portfolioValue : null;
          entry[btcKey] = pt.btcHeld;
        }
      }
    }

    return Array.from(dateMap.values()).sort((a: any, b: any) => a.ts - b.ts);
  }, [results, data]);

  const systemSpans = useMemo(() => buildSystemSpans(chartData), [chartData]);

  // BTC price Y domain (right axis, log scale)
  const btcDomain = useMemo(() => {
    const vals = chartData
      .map((d: any) => Number(d.btcPrice))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return { y1: 1, y2: 10 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { y1: Math.max(min * 0.85, 1e-6), y2: max * 1.15 };
  }, [chartData]);

  // For custom range, pick tick density based on span length
  const spanYears = useMemo(() => {
    if (!chartData.length) return 5;
    const first = chartData[0]?.ts;
    const last = chartData[chartData.length - 1]?.ts;
    return (last - first) / (365.25 * 24 * 60 * 60 * 1000);
  }, [chartData]);

  const useYearFormat = range === 'all' || range === '5y' || range === '4y' || range === '3y' || (range === 'custom' && spanYears > 3);
  const tickCount = range === 'all' || range === 'custom' ? 10 : range === '5y' || range === '4y' ? 8 : range === '3y' || range === '2y' ? 8 : 6;

  const xTickFormatter = (value: any) => {
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      return useYearFormat ? format(d, 'yyyy') : format(d, 'MMM yy');
    } catch {
      return String(value);
    }
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
          <p className="mb-2 font-bold text-slate-100">{payload[0]?.payload?.fullDate}</p>
          <div className="space-y-1">
            {payload.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-8">
                <span className="text-xs text-slate-300" style={{ color: p.color }}>{p.name}:</span>
                <span className="text-xs font-mono font-bold text-slate-100">
                  {typeof p.value === 'number' ? `$${p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : p.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const BtcTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
          <p className="mb-2 font-bold text-slate-100">{payload[0]?.payload?.fullDate}</p>
          <div className="space-y-1">
            {payload.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-8">
                <span className="text-xs text-slate-300" style={{ color: p.color }}>{p.name}:</span>
                <span className="text-xs font-mono font-bold text-slate-100">
                  {typeof p.value === 'number' ? `${p.value.toFixed(4)} BTC` : p.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  if (!data || data.length === 0) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography color="text.secondary">No signal data available to backtest.</Typography>
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <FlaskConical className="h-8 w-8 text-blue-400" />
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
          Backtest
        </Typography>
      </Box>

      {/* Controls */}
      <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Grid container spacing={2} alignItems="center">
          {/* Time Range Presets */}
          <Grid item xs={12} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                Time Range
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                <ToggleButtonGroup
                  color="primary"
                  exclusive
                  value={range === 'custom' ? null : range}
                  onChange={(_, next) => {
                    if (next) setRange(next);
                  }}
                  size="small"
                >
                  <ToggleButton value="1y">1Y</ToggleButton>
                  <ToggleButton value="2y">2Y</ToggleButton>
                  <ToggleButton value="3y">3Y</ToggleButton>
                  <ToggleButton value="4y">4Y</ToggleButton>
                  <ToggleButton value="5y">5Y</ToggleButton>
                  <ToggleButton value="all">All</ToggleButton>
                </ToggleButtonGroup>
                <TextField
                  type="date"
                  size="small"
                  label="Start Date"
                  value={startDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      setCustomDate(v);
                      setRange('custom');
                    }
                  }}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{
                    min: ALL_START_DATE,
                    max: data.length ? data[data.length - 1].Date : undefined,
                  }}
                  sx={{ width: 155 }}
                />
              </Stack>
            </Stack>
          </Grid>

          {/* DCA Frequency */}
          <Grid item xs={12} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                DCA Frequency
              </Typography>
              <ToggleButtonGroup
                color="primary"
                exclusive
                value={frequency}
                onChange={(_, next) => next && setFrequency(next)}
                size="small"
              >
                <ToggleButton value="daily">Daily</ToggleButton>
                <ToggleButton value="weekly">Weekly</ToggleButton>
                <ToggleButton value="monthly">Monthly</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Grid>

          {/* DCA Amount */}
          <Grid item xs={6} sm="auto">
            <TextField
              label="DCA Amount"
              type="number"
              size="small"
              value={dcaAmount}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) setDcaAmount(v);
              }}
              InputProps={{
                startAdornment: <InputAdornment position="start">$</InputAdornment>,
              }}
              sx={{ width: 120 }}
            />
          </Grid>

          {/* Off-Signal Mode */}
          <Grid item xs={6} sm="auto">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>When Signal OFF</InputLabel>
              <Select
                value={offSignalMode}
                label="When Signal OFF"
                onChange={(e) => setOffSignalMode(e.target.value as OffSignalMode)}
              >
                <MenuItem value="pause">Pause Buys</MenuItem>
                <MenuItem value="sell_matching">Sell Matching</MenuItem>
                <MenuItem value="sell_all">Sell All</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* MACRO 3x Toggle */}
          <Grid item xs={12} sm="auto">
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={macroAccel}
                onChange={(_, checked) => setMacroAccel(checked)}
                color="success"
                size="small"
              />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                MACRO 3x
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Paper>

      {/* Summary Cards */}
      {results.length > 0 && (
        <Grid container spacing={2}>
          {results.map((r) => {
            const color = STRATEGY_COLORS[r.name] ?? '#94a3b8';
            return (
              <Grid item xs={12} md={macroAccel ? 4 : 6} key={r.name}>
                <Card sx={{ borderTop: `3px solid ${color}` }}>
                  <CardHeader
                    title={
                      <Typography sx={{ fontWeight: 900, fontSize: '0.95rem' }}>
                        {r.name}
                      </Typography>
                    }
                  />
                  <Divider />
                  <CardContent>
                    <Grid container spacing={1.5}>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<TrendingUp className="h-4 w-4" style={{ color }} />}
                          label="Total Return"
                          value={`${(r.totalReturn * 100).toFixed(1)}%`}
                          tone={r.totalReturn >= 0 ? 'positive' : 'negative'}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<Coins className="h-4 w-4" style={{ color }} />}
                          label="Final Value"
                          value={`$${r.finalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<DollarSign className="h-4 w-4" style={{ color }} />}
                          label="Total Invested"
                          value={fmtUsd(r.totalInvested)}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<Wallet className="h-4 w-4" style={{ color }} />}
                          label="Cash Balance"
                          value={fmtUsd(r.finalCashBalance)}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<BarChart3 className="h-4 w-4" style={{ color }} />}
                          label="BTC Accumulated"
                          value={`${r.btcAccumulated.toFixed(4)}`}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<ShieldAlert className="h-4 w-4" style={{ color }} />}
                          label="Max Drawdown"
                          value={`-${(r.maxDrawdown * 100).toFixed(1)}%`}
                          tone="negative"
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Chart 1: Portfolio Value */}
      {chartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Portfolio Value Over Time
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Total portfolio value (BTC holdings at market price + cash reserves) for each strategy.
              All strategies receive the same DCA deposits; CoinStrat holds cash as dry powder when CORE is OFF and deploys reserves on re-entry.
              Background shading shows the CoinStrat system state (CORE = accumulation permission; MACRO = 3× intensity modifier).
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            {results.map(r => (
              <Chip
                key={r.name}
                size="small"
                variant="outlined"
                label={r.name}
                sx={{ borderColor: STRATEGY_COLORS[r.name], color: STRATEGY_COLORS[r.name] }}
              />
            ))}
            <Chip
              size="small"
              variant="outlined"
              label="BTC Price"
              sx={{ borderColor: '#fbbf24', color: '#fde68a' }}
            />
          </Stack>

          <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                {systemSpans.map((s, i) => {
                  const c = systemColor(s.value);
                  return (
                    <ReferenceArea
                      key={`sys-${i}-${s.x1}`}
                      yAxisId="pv"
                      x1={s.x1}
                      x2={s.x2}
                      ifOverflow="extendDomain"
                      fill={c.fill}
                      fillOpacity={c.alpha}
                      strokeOpacity={0}
                    />
                  );
                })}
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  tickFormatter={xTickFormatter}
                  tickCount={tickCount}
                  minTickGap={24}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="pv"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) =>
                    typeof val === 'number' ? `$${val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)}` : ''
                  }
                />
                <YAxis
                  yAxisId="btcPrice"
                  orientation="right"
                  scale="log"
                  domain={[btcDomain.y1, btcDomain.y2]}
                  tick={{ fontSize: 10, fill: '#fbbf24' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) =>
                    typeof val === 'number' ? `$${val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)}` : ''
                  }
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  yAxisId="btcPrice"
                  type="monotone"
                  dataKey="btcPrice"
                  name="BTC Price"
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  isAnimationActive={false}
                />
                {results.map(r => (
                  <Line
                    key={r.name}
                    yAxisId="pv"
                    type="monotone"
                    dataKey={`pv_${r.name}`}
                    name={r.name}
                    stroke={STRATEGY_COLORS[r.name]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* Chart 2: BTC Holdings */}
      {chartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              BTC Holdings Over Time
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Cumulative BTC accumulated by each strategy over the backtest period.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            {results.map(r => (
              <Chip
                key={r.name}
                size="small"
                variant="outlined"
                label={r.name}
                sx={{ borderColor: STRATEGY_COLORS[r.name], color: STRATEGY_COLORS[r.name] }}
              />
            ))}
            <Chip size="small" variant="outlined" label="BTCUSD (right, log)" sx={{ borderColor: '#fbbf24', color: '#fbbf24' }} />
          </Stack>

          <Box sx={{ height: { xs: 300, sm: 360 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  tickFormatter={xTickFormatter}
                  tickCount={tickCount}
                  minTickGap={24}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="btcHoldings"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) =>
                    typeof val === 'number' ? `${val.toFixed(2)}` : ''
                  }
                />
                <YAxis
                  yAxisId="btcPriceLog"
                  orientation="right"
                  scale="log"
                  domain={[btcDomain.y1, btcDomain.y2]}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) =>
                    typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : ''
                  }
                />
                <Tooltip content={<BtcTooltip />} />
                {results.map(r => (
                  <Line
                    key={r.name}
                    yAxisId="btcHoldings"
                    type="monotone"
                    dataKey={`btc_${r.name}`}
                    name={r.name}
                    stroke={STRATEGY_COLORS[r.name]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  yAxisId="btcPriceLog"
                  type="monotone"
                  dataKey="btcPrice"
                  name="BTC Price"
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  opacity={0.45}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* Comparison Table */}
      {results.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Strategy Comparison
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 900, color: 'text.secondary' }}>Metric</TableCell>
                  {results.map(r => (
                    <TableCell key={r.name} align="right" sx={{ fontWeight: 900, color: STRATEGY_COLORS[r.name] }}>
                      {r.name}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                <CompRow label="Total Deposited" values={results.map(r => fmtUsd(r.totalInvested))} />
                <CompRow label="Final Portfolio Value" values={results.map(r => fmtUsd(r.finalPortfolioValue))} />
                <CompRow label="Cash Balance" values={results.map(r => fmtUsd(r.finalCashBalance))} />
                <CompRow label="BTC Value" values={results.map(r => fmtUsd(r.finalBtcHeld * (r.series.length > 0 ? r.series[r.series.length - 1].btcPrice : 0)))} />
                <CompRow label="Total Return" values={results.map(r => fmtPct(r.totalReturn * 100))} />
                <CompRow label="BTC Accumulated" values={results.map(r => r.btcAccumulated.toFixed(4))} />
                <CompRow label="Max Drawdown" values={results.map(r => `-${(r.maxDrawdown * 100).toFixed(1)}%`)} />
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
};

// --- Sub-components ---

function MetricBox(props: { icon: React.ReactNode; label: string; value: string; tone?: 'positive' | 'negative' }) {
  const { icon, label, value, tone } = props;
  const color = tone === 'positive' ? 'success.main' : tone === 'negative' ? 'error.main' : 'text.primary';

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1, bgcolor: 'rgba(2,6,23,0.10)' }}>
      <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 0.25 }}>
        {icon}
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.6rem', lineHeight: 1.2 }}>
          {label}
        </Typography>
      </Stack>
      <Typography
        variant="body1"
        sx={{
          fontWeight: 900,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          color,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function CompRow(props: { label: string; values: string[] }) {
  return (
    <TableRow hover>
      <TableCell sx={{ fontWeight: 700 }}>{props.label}</TableCell>
      {props.values.map((v, i) => (
        <TableCell
          key={i}
          align="right"
          sx={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontWeight: 800,
          }}
        >
          {v}
        </TableCell>
      ))}
    </TableRow>
  );
}

function fmtUsd(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `${x.toFixed(1)}%`;
}

export default Backtest;
