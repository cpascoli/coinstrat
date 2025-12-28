import React, { useEffect, useMemo, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, ReferenceArea 
} from 'recharts';
import { SignalData } from '../App';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';
import { Box, Chip, Paper, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';

interface Props {
  data: SignalData[];
}

type RangeKey = 'all' | '10y' | '5y' | '2y' | '1y';
type ChartsSection = 'system' | 'valuation' | 'liquidity' | 'business';

type RegimeKey = 'LIQ_SCORE' | 'CYCLE_SCORE';
type RegimeSpan = { x1: number; x2: number; value: 0 | 1 | 2 };
type BinarySpan = { x1: number; x2: number; value: 0 | 1 };
type SystemSpan = { x1: number; x2: number; value: 0 | 1 | 2 | 3 };
type MvrvSpan = { x1: number; x2: number; value: 0 | 1 | 2 }; // 2=cheap(green), 1=fair(grey), 0=hot(red)

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

function buildBinarySpans(rows: Array<{ ts: number } & Record<string, any>>, key: string): BinarySpan[] {
  const spans: BinarySpan[] = [];
  if (!rows.length) return spans;

  let current: 0 | 1 | null = null;
  let startTs: number | null = null;

  const coerce = (v: any): 0 | 1 | null => {
    const n = Number(v);
    if (n === 0 || n === 1) return n;
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

function buildSystemSpans(rows: Array<{ ts: number } & Record<string, any>>): SystemSpan[] {
  const spans: SystemSpan[] = [];
  if (!rows.length) return spans;

  // 0 = red (0,0), 1 = gray (0,1), 2 = light green (1,0), 3 = dark green (1,1)
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

function buildMvrvSpans(rows: Array<{ ts: number } & Record<string, any>>): MvrvSpan[] {
  const spans: MvrvSpan[] = [];
  if (!rows.length) return spans;

  const classify = (row: any): 0 | 1 | 2 | null => {
    const m = Number(row.MVRV);
    if (!Number.isFinite(m)) return null;
    if (m < 1.0) return 2;
    if (m < 1.8) return 1;
    return 0;
  };

  let current: 0 | 1 | 2 | null = null;
  let startTs: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const v = classify(rows[i]);
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
    0: { fill: '#ef4444', alpha: 0.36 },
    1: { fill: '#94a3b8', alpha: 0.32 },
    2: { fill: '#22c55e', alpha: 0.34 },
  } as const;
  return palette[v];
}

function systemColor(v: 0 | 1 | 2 | 3) {
  // 0: red, 1: gray/neutral, 2: light green, 3: darker green
  switch (v) {
    case 0:
      return { fill: '#ef4444', alpha: 0.36 };
    case 1:
      return { fill: '#94a3b8', alpha: 0.32 };
    case 2:
      return { fill: '#86efac', alpha: 0.34 };
    case 3:
      return { fill: '#22c55e', alpha: 0.34 };
  }
}

function mvrvColor(v: 0 | 1 | 2) {
  // 2=cheap(green), 1=fair(grey), 0=hot(red)
  switch (v) {
    case 2:
      return { fill: '#22c55e', alpha: 0.28 };
    case 0:
      return { fill: '#ef4444', alpha: 0.28 };
    default:
      return { fill: '#94a3b8', alpha: 0.22 };
  }
}

const ChartsView: React.FC<Props> = ({ data }) => {
  const [range, setRange] = useState<RangeKey>('all');
  const location = useLocation();
  const navigate = useNavigate();

  const section: ChartsSection = useMemo(() => {
    const m = location.pathname.match(/^\/charts\/([^/]+)/);
    const seg = (m?.[1] ?? 'system').toLowerCase();
    if (seg === 'system' || seg === 'valuation' || seg === 'liquidity' || seg === 'business') return seg as ChartsSection;
    return 'system';
  }, [location.pathname]);

  useEffect(() => {
    // Normalize /charts and unknown subroutes -> /charts/system
    if (location.pathname === '/charts' || location.pathname === '/charts/') {
      navigate('/charts/system', { replace: true });
      return;
    }
    const m = location.pathname.match(/^\/charts\/([^/]+)/);
    const seg = (m?.[1] ?? '').toLowerCase();
    if (seg && seg !== 'system' && seg !== 'valuation' && seg !== 'liquidity' && seg !== 'business') {
      navigate('/charts/system', { replace: true });
    }
  }, [location.pathname, navigate]);

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
      const fmt = (name: string, value: any) => {
        const v = Number(value);
        if (!Number.isFinite(v)) return String(value);

        // Prices
        if (name.includes('BTC')) return `$${v.toLocaleString()}`;

        // Liquidity levels (WALCL, TGA, RRP, US_LIQ) are in "millions" -> show trillions
        const trillionsKeys = new Set(['WALCL', 'WTREGEN', 'RRPONTSYD', 'US_LIQ']);
        if (trillionsKeys.has(name)) return `$${(v / 1e6).toFixed(2)}T`;

        // Percent series
        if (name.includes('YOY') || name.includes('ROC') || name.includes('%')) return `${v.toFixed(2)}%`;

        // Yield curve (can be negative; keep 2dp)
        if (name.toLowerCase().includes('yield') || name.includes('YC')) return v.toFixed(2);

        // Default
        return v.toFixed(3);
      };

      return (
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
          <p className="mb-2 font-bold text-slate-100">{payload[0].payload.fullDate}</p>
          <div className="space-y-1">
            {payload.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-8">
                <span className="text-xs text-slate-300" style={{ color: p.color }}>{p.name}:</span>
                <span className="text-xs font-mono font-bold text-slate-100">
                  {fmt(p.name, p.value)}
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
  const cycleSpans = useMemo(() => buildRegimeSpans(chartData as any, 'CYCLE_SCORE'), [chartData]);
  const priceRegimeSpans = useMemo(() => buildBinarySpans(chartData as any, 'PRICE_REGIME_ON'), [chartData]);
  const systemSpans = useMemo(() => buildSystemSpans(chartData as any), [chartData]);
  const mvrvSpans = useMemo(() => buildMvrvSpans(chartData as any), [chartData]);

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

  const usdDomain = useMemo(() => {
    const vals = (chartData as any[])
      .flatMap((d) => [Number(d.DXY), Number(d.DXY_MA50), Number(d.DXY_MA200)])
      .filter((v) => Number.isFinite(v));
    if (!vals.length) return { y1: 0, y2: 1 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.06 || 1;
    return { y1: min - pad, y2: max + pad };
  }, [chartData]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Activity className="h-8 w-8 text-blue-600" />
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
          Charts of Key Signals
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Tabs
          value={section}
          onChange={(_, v: ChartsSection) => navigate(`/charts/${v}`)}
          textColor="inherit"
          indicatorColor="primary"
          sx={{ minHeight: 40 }}
        >
          <Tab value="system" label="System" sx={{ minHeight: 40 }} />
          <Tab value="valuation" label="Valuation" sx={{ minHeight: 40 }} />
          <Tab value="liquidity" label="Liquidity" sx={{ minHeight: 40 }} />
          <Tab value="business" label="Business Cycle" sx={{ minHeight: 40 }} />
        </Tabs>

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

      {/* System State: BTCUSD with CORE/MACRO background shading */}
      {section === 'system' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            System State (CORE + MACRO)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD shaded by the engine’s state machine. 
            <br />
            CORE is driven by VAL_SCORE + PRICE_REGIME with DXY_SCORE as a gate;
            MACRO is driven by (LIQ_SCORE + CYCLE_SCORE) with DXY_SCORE as a gate. 
            <br />
            ACCUM is enabled when CORE=1 or MACRO=1.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="CORE=1 MACRO=0" sx={{ borderColor: '#86efac', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="CORE=1 MACRO=1" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="CORE=0 MACRO=0" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="CORE=0 MACRO=1" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`system-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              {systemSpans.map((s, i) => {
                const c = systemColor(s.value);
                return (
                  <ReferenceArea
                    key={`sys-${i}-${s.x1}`}
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
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* Main Chart: BTC + Liquidity Overlay + LIQ_SCORE background shading */}
      {section === 'liquidity' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            US Net Liquidity
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD with US_LIQ overlay and LIQ_SCORE regime shading. 
            <br />
            US_LIQ is computed as WALCL − WTREGEN − RRPONTSYD. 
            <br />
            LIQ_SCORE=2 when US_LIQ YoY is positive; LIQ_SCORE=1 when YoY is non‑positive but the 13‑week delta is positive; otherwise LIQ_SCORE=0.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Contracting (LIQ=0)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="Improving (LIQ=1" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="Expanding (LIQ=2)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
        </Stack>
        
        {/* IMPORTANT: set an explicit height so Recharts never renders into a 0px container in production */}
        <Box sx={{ height: { xs: 360, sm: 460, md: 520 }, width: '100%', minWidth: 0 }}>
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
      )}

      {/* US Net Liquidity Inputs */}
      {section === 'liquidity' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            US Net Liquidity Inputs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Raw inputs used to compute US_LIQ = WALCL − WTREGEN − RRPONTSYD.
            <br />
            These feed LIQ_SCORE via US_LIQ YoY (%) and the 13‑week delta (momentum).
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="WALCL (Fed assets)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
          <Chip size="small" variant="outlined" label="WTREGEN (TGA)" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
          <Chip size="small" variant="outlined" label="RRPONTSYD (RRP)" sx={{ borderColor: '#a78bfa', color: '#ddd6fe' }} />
          <Chip size="small" variant="outlined" label="US_LIQ" sx={{ borderColor: '#60a5fa', color: '#bfdbfe' }} />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2.5 }}>
          {/* Components */}
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`liq-inputs-1-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="lvl"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (typeof v === 'number' ? `$${(v / 1e6).toFixed(1)}T` : '')}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line yAxisId="lvl" type="monotone" dataKey="WALCL" name="WALCL" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="lvl" type="monotone" dataKey="WTREGEN" name="WTREGEN" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="lvl" type="monotone" dataKey="RRPONTSYD" name="RRPONTSYD" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>

          {/* Derived US_LIQ + YoY */}
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`liq-inputs-2-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="liq"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (typeof v === 'number' ? `$${(v / 1e6).toFixed(1)}T` : '')}
                />
                <YAxis
                  yAxisId="yoy"
                  orientation="right"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line yAxisId="liq" type="monotone" dataKey="US_LIQ" name="US_LIQ" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="yoy" type="monotone" dataKey="US_LIQ_YOY" name="US_LIQ_YOY" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Paper>
      )}

      {/* Price Regime: BTCUSD vs 40W MA with regime shading */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            BTC Price Regime (PRICE_REGIME)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD with the 40‑week MA computed from weekly closes.
            <br />
            PRICE_REGIME shading requires ≥20 “BTCUSD ≥ 40W MA” days in the last 30. 
            <br />
            This persistence‑filtered regime is used directly in CORE_ON entry/exit logic (trend confirmation + risk-off exit).
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Bullish (PRICE_REGIME=1)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="Bearish (PRICE_REGIME=0)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
          <Chip size="small" variant="outlined" label="40W MA" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`price-regime-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              {priceRegimeSpans.map((s, i) => (
                <ReferenceArea
                  key={`pr-${i}-${s.x1}`}
                  yAxisId="btc"
                  x1={s.x1}
                  x2={s.x2}
                  y1={btcDomain.y1}
                  y2={btcDomain.y2}
                  ifOverflow="extendDomain"
                  fill={s.value === 1 ? '#22c55e' : '#ef4444'}
                  fillOpacity={s.value === 1 ? 0.32 : 0.32}
                  strokeOpacity={0}
                />
              ))}
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="btc" scale="log" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <Tooltip content={<CustomTooltip />} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTC_MA40W" name="BTC 40W MA" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* MVRV Valuation: BTCUSD shaded by MVRV bands */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            BTC Valuation (VAL_SCORE)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD shaded by MVRV valuation bands and plotted with the MVRV ratio (right axis). 
            <br />
            VAL_SCORE is bucketed from MVRV: 2 when MVRV is below 1.0 (cheap), 1 when MVRV is 1.0–1.8 (fair), 0 when MVRV is ≥ 1.8 (hot). 
            <br />
            VAL_SCORE feeds CORE_ON entry rules.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Cheap (MVRV < 1.0)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="Fair (1.0–1.8)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="Hot (MVRV ≥ 1.8)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
          <Chip size="small" variant="outlined" label="MVRV" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`mvrv-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              {mvrvSpans.map((s, i) => {
                const c = mvrvColor(s.value);
                return (
                  <ReferenceArea
                    key={`mvrv-${i}-${s.x1}`}
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
              <YAxis yAxisId="mvrv" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(2) : '')} />
              <Tooltip content={<CustomTooltip />} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="mvrv" type="monotone" dataKey="MVRV" name="MVRV" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* BTC over Business Cycle Score shading */}
      {section === 'business' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Business Cycle Regime
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD shaded by CYCLE_SCORE (Business Cycle). 
            <br />
            CYCLE_SCORE=0 on recession risk (SAHM ≥ 0.5 OR YC_M is negative OR New Orders YoY is negative with 3‑month momentum non‑positive); 
            <br />
            CYCLE_SCORE=2 in expansion (SAHM below 0.35 AND YC_M ≥ 0.75 AND New Orders YoY ≥ 0); otherwise CYCLE_SCORE=1. 
            <br />
            This score contributes to MACRO_ON via (LIQ_SCORE + BIZ_CYCLE_SCORE).
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Contraction risk (BIZ_CYCLE=0)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="Stabilizing (BIZ_CYCLE=1)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="Expansion (BIZ_CYCLE=2)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`btc-cycle-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                {cycleSpans.map((s, i) => {
                  const c = regimeColor('CYCLE_SCORE', s.value);
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
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTC Price" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* Business Cycle: inputs (moved below BTC + business cycle shading) */}
      {section === 'business' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Business Cycle Inputs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Inputs that drive CYCLE_SCORE: SAHM Rule (labor stress), YC_M (10Y–3M yield curve slope), and New Orders (level + YoY). 
            <br />
            The engine classifies recession risk vs expansion vs neutral using the thresholds described above.
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2.5 }}>
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`cycle-inputs-1-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="sahm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="yc" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
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
                <Line yAxisId="no" type="monotone" dataKey="NO" name="New Orders (level)" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="noy" type="monotone" dataKey="NO_YOY" name="New Orders YoY (%)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Paper>
      )}

      {/* USD Regime Inputs (DTWEXBGS proxy) */}
      {section === 'system' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            USD Regime (DXY_SCORE)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            DTWEXBGS (trade‑weighted USD; the DXY proxy) with MA50/MA200 and ROC20 (20‑day % change). 
            <br />
            DXY_SCORE=0 (headwind) when ROC20 &gt; +0.5%; DXY_SCORE=2 (supportive) when ROC20 &lt; −0.5% and MA50 &lt; MA200; otherwise DXY_SCORE=1 (neutral). 
            <br />
            DXY_SCORE gates CORE and MACRO signals (and triggers CORE exit when combined with PRICE_REGIME=0).
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="DTWEXBGS" sx={{ borderColor: '#60a5fa', color: '#bfdbfe' }} />
          <Chip size="small" variant="outlined" label="MA50" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
          <Chip size="small" variant="outlined" label="MA200" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="ROC20 (%)" sx={{ borderColor: '#34d399', color: '#bbf7d0' }} />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2.5 }}>
          {/* Level + MAs */}
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`usd-level-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
                <YAxis yAxisId="usd" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line yAxisId="usd" type="monotone" dataKey="DXY" name="DTWEXBGS" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="usd" type="monotone" dataKey="DXY_MA50" name="MA50" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="usd" type="monotone" dataKey="DXY_MA200" name="MA200" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>

          {/* ROC20 */}
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`usd-roc-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
                  yAxisId="roc"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '')}
                />
                <Tooltip content={<CustomTooltip />} />
                {/* Color ROC20 green above 0% and red below 0% */}
                <Line
                  yAxisId="roc"
                  type="monotone"
                  dataKey={(d: any) => {
                    const v = d?.DXY_ROC20;
                    if (typeof v !== 'number') return null;
                    const pct = v * 100;
                    return pct >= 0 ? pct : null;
                  }}
                  name="ROC20 (≥ 0%)"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="roc"
                  type="monotone"
                  dataKey={(d: any) => {
                    const v = d?.DXY_ROC20;
                    if (typeof v !== 'number') return null;
                    const pct = v * 100;
                    return pct < 0 ? pct : null;
                  }}
                  name="ROC20 (< 0%)"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Paper>
      )}
    </Box>
  );
};

export default ChartsView;

