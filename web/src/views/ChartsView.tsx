import React, { useMemo, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Legend, AreaChart, Area, ReferenceArea 
} from 'recharts';
import { SignalData } from '../App';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';
import { Box, Chip, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

interface Props {
  data: SignalData[];
}

type RangeKey = 'all' | '10y' | '5y' | '2y' | '1y';

type RegimeKey = 'LIQ_SCORE' | 'CYCLE_SCORE_V2';
type RegimeSpan = { x1: number; x2: number; value: 0 | 1 | 2 };

function buildRegimeSpans(rows: Array<{ ts: number } & Record<string, any>>, key: RegimeKey): RegimeSpan[] {
  const spans: RegimeSpan[] = [];
  if (!rows.length) return spans;

  let current: 0 | 1 | 2 | null = null;
  let startTs: number | null = null;

  const coerce = (v: any): 0 | 1 | 2 | null => {
    const n = Number(v);
    if (n === 0 || n === 1 || n === 2) return n;
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const v = coerce((rows[i] as any)[key]);
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

function regimeColor(key: RegimeKey, v: 0 | 1 | 2) {
  // Match the feel of dashboard_2026.py shading: red (risk), grey (neutral), green (tailwind)
  const palette = {
    0: { fill: '#ef4444', alpha: 0.16 },
    1: { fill: '#94a3b8', alpha: 0.12 },
    2: { fill: '#22c55e', alpha: 0.14 },
  } as const;
  return palette[v];
}

function inPlotLegendItem(color: string, label: string) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color, flex: '0 0 auto' }} />
      <Typography variant="caption" sx={{ color: '#e5e7eb', lineHeight: 1.1 }}>
        {label}
      </Typography>
    </Box>
  );
}

function InPlotLegend(props: { items: Array<{ color: string; label: string }> }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 2,
        border: '1px solid',
        borderColor: 'rgba(148,163,184,0.35)',
        bgcolor: 'rgba(2,6,23,0.75)',
        backdropFilter: 'blur(6px)',
        borderRadius: 2,
        px: 1.25,
        py: 1,
        display: 'grid',
        gap: 0.75,
        minWidth: 160,
      }}
    >
      {props.items.map((it) => (
        <React.Fragment key={`${it.label}-${it.color}`}>{inPlotLegendItem(it.color, it.label)}</React.Fragment>
      ))}
    </Box>
  );
}

const ChartsView: React.FC<Props> = ({ data }) => {
  const [range, setRange] = useState<RangeKey>('all');

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const last = data[data.length - 1];
    const end = new Date(last.Date);
    const start =
      range === 'all'
        ? null
        : new Date(
            Date.UTC(
              end.getUTCFullYear() - (range === '10y' ? 10 : range === '5y' ? 5 : range === '2y' ? 2 : 1),
              end.getUTCMonth(),
              end.getUTCDate()
            )
          );

    const filtered = start ? data.filter((d) => new Date(d.Date) >= start) : data;

    return filtered.map(d => {
      let dateObj: Date;
      try {
        // Handle both "YYYY-MM-DD" and other potential formats
        dateObj = new Date(d.Date);
        if (isNaN(dateObj.getTime())) throw new Error("Invalid date");
      } catch (e) {
        dateObj = new Date(); // Fallback
      }

      return {
        ...d,
        ts: dateObj.getTime(),
        // Use the raw Date field for X-axis, and keep formatted helpers for tooltip.
        displayDate:
          range === 'all' || range === '10y' || range === '5y'
            ? format(dateObj, 'yyyy')
            : format(dateObj, 'MMM yy'),
        fullDate: format(dateObj, 'yyyy-MM-dd')
      };
    });
  }, [data, range]);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white">
        <div className="text-center text-slate-400">
          <Activity className="mx-auto mb-2 h-8 w-8 opacity-20" />
          <p>No signal data available to chart.</p>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
          <p className="mb-2 font-bold text-slate-100">{payload[0].payload.fullDate}</p>
          <div className="space-y-1">
            {payload.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-8">
                <span className="text-xs text-slate-300" style={{ color: p.color }}>{p.name}:</span>
                <span className="text-xs font-mono font-bold text-slate-100">
                  {p.name.includes('BTC') ? `$${p.value.toLocaleString()}` : 
                   p.name.includes('LIQ') && !p.name.includes('SCORE') ? `$${(p.value / 1e6).toFixed(2)}T` : 
                   p.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const xTickFormatter = (value: any) => {
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      return (range === 'all' || range === '10y' || range === '5y') ? format(d, 'yyyy') : format(d, 'MMM yy');
    } catch {
      return String(value);
    }
  };

  const liqSpans = useMemo(() => buildRegimeSpans(chartData as any, 'LIQ_SCORE'), [chartData]);
  const cycleSpans = useMemo(() => buildRegimeSpans(chartData as any, 'CYCLE_SCORE_V2'), [chartData]);

  const tickCount = range === 'all' ? 10 : range === '10y' ? 10 : range === '5y' ? 8 : range === '2y' ? 8 : 6;

  const btcDomain = useMemo(() => {
    const vals = (chartData as any[])
      .map((d) => Number(d.BTCUSD))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return { y1: 1, y2: 10 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    // Padding for log chart; keep strictly > 0
    return { y1: Math.max(min * 0.85, 1e-6), y2: max * 1.15 };
  }, [chartData]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Activity className="h-8 w-8 text-blue-600" />
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
          Interactive Analytics
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}>
        <ToggleButtonGroup
          color="primary"
          exclusive
          value={range}
          onChange={(_, next) => next && setRange(next)}
          size="small"
        >
          <ToggleButton value="1y">1Y</ToggleButton>
          <ToggleButton value="2y">2Y</ToggleButton>
          <ToggleButton value="5y">5Y</ToggleButton>
          <ToggleButton value="10y">10Y</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Main Chart: BTC + Liquidity Overlay + LIQ_SCORE background shading */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            BTC Price & US Net Liquidity
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD (log) with US_LIQ and LIQ_SCORE regime shading
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="LIQ 0: contracting" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="LIQ 1: improving" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="LIQ 2: expanding" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
        </Stack>
        
        {/* IMPORTANT: set an explicit height so Recharts never renders into a 0px container in production */}
        <Box sx={{ height: { xs: 360, sm: 460, md: 520 }, width: '100%', minWidth: 0, position: 'relative' }}>
          <InPlotLegend
            items={[
              { color: '#e5e7eb', label: 'BTCUSD' },
              { color: '#60a5fa', label: 'US_LIQ' },
              { color: 'rgba(239,68,68,0.55)', label: 'LIQ 0' },
              { color: 'rgba(148,163,184,0.55)', label: 'LIQ 1' },
              { color: 'rgba(34,197,94,0.55)', label: 'LIQ 2' },
            ]}
          />
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={range} data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              {liqSpans.map((s, i) => {
                const c = regimeColor('LIQ_SCORE', s.value);
                return (
                  <ReferenceArea
                    key={`liq-${i}-${s.x1}`}
                    yAxisId="btc"
                    x1={s.x1}
                    x2={s.x2}
                    y1={btcDomain.y1}
                    y2={btcDomain.y2}
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
                yAxisId="btc" 
                scale="log"
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#94a3b8' }} 
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => {
                  if (typeof val !== 'number' || isNaN(val)) return '';
                  if (val >= 1000) return `$${Math.round(val / 1000)}k`;
                  return `$${Math.round(val)}`;
                }}
              />
              <YAxis 
                yAxisId="liq" 
                orientation="right" 
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#94a3b8' }} 
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => {
                  if (typeof val !== 'number' || isNaN(val)) return '';
                  return `$${(val/1e6).toFixed(1)}T`;
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              
              <Line 
                yAxisId="btc"
                type="monotone" 
                dataKey="BTCUSD" 
                name="BTC Price"
                stroke="#e5e7eb" 
                strokeWidth={2} 
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Line 
                yAxisId="liq"
                type="monotone" 
                dataKey="US_LIQ" 
                name="US Net Liquidity"
                stroke="#60a5fa" 
                strokeWidth={2} 
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* Business Cycle: inputs */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Business Cycle Inputs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            SAHM, Yield Curve (10Y-3M) and New Orders proxies
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`cycle-inputs-1-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="sahm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="yc" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Line yAxisId="sahm" type="monotone" dataKey="SAHM" name="SAHM" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="yc" type="monotone" dataKey="YC_M" name="Yield Curve (10Y-3M)" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>

          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`cycle-inputs-2-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="no" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="noy" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Line yAxisId="no" type="monotone" dataKey="NO" name="New Orders (level)" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="noy" type="monotone" dataKey="NO_YOY" name="New Orders YoY (%)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Paper>

      {/* BTC over Business Cycle Score shading */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            BTC Price with Business Cycle Regime Shading
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD (log) shaded by CYCLE_SCORE_V2
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Cycle 0: contraction risk" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="Cycle 1: stabilizing" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="Cycle 2: expansion" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0, position: 'relative' }}>
          <InPlotLegend
            items={[
              { color: '#e5e7eb', label: 'BTCUSD' },
              { color: 'rgba(239,68,68,0.55)', label: 'Cycle 0' },
              { color: 'rgba(148,163,184,0.55)', label: 'Cycle 1' },
              { color: 'rgba(34,197,94,0.55)', label: 'Cycle 2' },
            ]}
          />
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`btc-cycle-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              {cycleSpans.map((s, i) => {
                const c = regimeColor('CYCLE_SCORE_V2', s.value);
                return (
                  <ReferenceArea
                    key={`cyc-${i}-${s.x1}`}
                    yAxisId="btc"
                    x1={s.x1}
                    x2={s.x2}
                    y1={btcDomain.y1}
                    y2={btcDomain.y2}
                    ifOverflow="extendDomain"
                    fill={c.fill}
                    fillOpacity={c.alpha}
                    strokeOpacity={0}
                  />
                );
              })}
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="btc" scale="log" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTC Price" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* Supporting timelines */}
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            Liquidity & Cycle Scores (Timeline)
          </Typography>
          <Box sx={{ height: 280, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart key={`scores-${range}`} data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={[0, 2]} ticks={[0, 1, 2]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="stepAfter" dataKey="LIQ_SCORE" name="LIQ_SCORE" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.12} isAnimationActive={false} />
                <Area type="stepAfter" dataKey="CYCLE_SCORE_V2" name="CYCLE_SCORE" stroke="#34d399" fill="#34d399" fillOpacity={0.12} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            Permission Logic History
          </Typography>
          <Box sx={{ height: 280, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart key={`perm-${range}`} data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={[0, 1]} ticks={[0, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="stepAfter" dataKey="CORE_ON" name="CORE_ON" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.18} isAnimationActive={false} />
                <Area type="stepAfter" dataKey="MACRO_ON" name="MACRO_ON" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.18} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default ChartsView;

