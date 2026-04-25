import React, { useEffect, useMemo, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, Brush, ReferenceArea, ReferenceLine 
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
type ChartsSection = 'system' | 'valuation' | 'liquidity' | 'business' | 'global' | 'usd';

type RegimeKey = 'LIQ_SCORE' | 'BIZ_CYCLE_SCORE';
type RegimeSpan = { x1: number; x2: number; value: 0 | 1 | 2 };
type BinarySpan = { x1: number; x2: number; value: 0 | 1 };
type SystemSpan = { x1: number; x2: number; value: 0 | 1 | 2 | 3 };
type MvrvSpan = { x1: number; x2: number; value: 0 | 1 | 2 | 3 }; // 3=extreme(deep green), 2=strong(green), 1=fair(grey), 0=hot(red)

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

  const classify = (row: any): 0 | 1 | 2 | 3 | null => {
    const v = Number(row.VAL_SCORE);
    if (!Number.isFinite(v)) return null;
    if (v >= 3) return 3;
    if (v >= 2) return 2;
    if (v >= 1) return 1;
    return 0;
  };

  let current: 0 | 1 | 2 | 3 | null = null;
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
    2: { fill: '#22c55e', alpha: 0.36 },
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
      return { fill: '#86efac', alpha: 0.36 };
    case 3:
      return { fill: '#22c55e', alpha: 0.36 };
  }
}

function mvrvColor(v: 0 | 1 | 2 | 3) {
  // 3=extreme deep value (bright green), 2=strong (green), 1=fair (grey), 0=hot (red)
  switch (v) {
    case 3:
      return { fill: '#15803d', alpha: 0.40 }; // deep green, higher opacity for extreme conviction
    case 2:
      return { fill: '#22c55e', alpha: 0.36 };
    case 0:
      return { fill: '#ef4444', alpha: 0.36 };
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
    if (seg === 'system' || seg === 'valuation' || seg === 'liquidity' || seg === 'business' || seg === 'global' || seg === 'usd') return seg as ChartsSection;
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
    if (seg && seg !== 'system' && seg !== 'valuation' && seg !== 'liquidity' && seg !== 'business' && seg !== 'global' && seg !== 'usd') {
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
        if (name.includes('BTC') || name.includes('Realized Price')) return `$${v.toLocaleString()}`;

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

  const renderChartBrush = () => (
    <Brush
      dataKey="ts"
      height={22}
      stroke="#60a5fa"
      fill="rgba(15, 23, 42, 0.92)"
      travellerWidth={10}
      tickFormatter={xTickFormatter}
    />
  );

  // Split LTH_SOPR into profit (>=1, green) and loss (<1, red) series for conditional coloring.
  // Each segment includes the boundary point from the other side so lines connect seamlessly.
  const soprChartData = useMemo(() => {
    return chartData.map((d: any, i: number, arr: any[]) => {
      const v = d.LTH_SOPR;
      const isFinite = typeof v === 'number' && Number.isFinite(v);
      const profit = isFinite && v >= 1;
      const loss   = isFinite && v < 1;
      // Check neighbours to duplicate boundary points
      const prev = i > 0 ? arr[i - 1]?.LTH_SOPR : null;
      const next = i < arr.length - 1 ? arr[i + 1]?.LTH_SOPR : null;
      const prevFinite = typeof prev === 'number' && Number.isFinite(prev);
      const nextFinite = typeof next === 'number' && Number.isFinite(next);
      // A point is a "bridge" if its neighbour is on the opposite side — include in both series
      const bridgeToPrev = prevFinite && ((profit && prev < 1) || (loss && prev >= 1));
      const bridgeToNext = nextFinite && ((profit && next < 1) || (loss && next >= 1));
      const isBridge = bridgeToPrev || bridgeToNext;
      return {
        ...d,
        LTH_SOPR_PROFIT: (profit || isBridge) && isFinite ? v : null,
        LTH_SOPR_LOSS:   (loss   || isBridge) && isFinite ? v : null,
      };
    });
  }, [chartData]);

  // Split aggregate NUPL into positive/negative series for conditional coloring.
  const nuplChartData = useMemo(() => {
    return chartData.map((d: any, i: number, arr: any[]) => {
      const v = d.NUPL;
      const ok = typeof v === 'number' && Number.isFinite(v);
      const pos = ok && v >= 0;
      const neg = ok && v < 0;
      const prev = i > 0 ? arr[i - 1]?.NUPL : null;
      const next = i < arr.length - 1 ? arr[i + 1]?.NUPL : null;
      const prevOk = typeof prev === 'number' && Number.isFinite(prev);
      const nextOk = typeof next === 'number' && Number.isFinite(next);
      const bridgeToPrev = prevOk && ((pos && prev < 0) || (neg && prev >= 0));
      const bridgeToNext = nextOk && ((pos && next < 0) || (neg && next >= 0));
      const isBridge = bridgeToPrev || bridgeToNext;
      return {
        ...d,
        NUPL_POS: (pos || isBridge) && ok ? v : null,
        NUPL_NEG: (neg || isBridge) && ok ? v : null,
      };
    });
  }, [chartData]);

  // Split LTH NUPL into positive/negative series for conditional coloring.
  const lthNuplChartData = useMemo(() => {
    return chartData.map((d: any, i: number, arr: any[]) => {
      const v = d.LTH_NUPL;
      const ok = typeof v === 'number' && Number.isFinite(v);
      const pos = ok && v >= 0;
      const neg = ok && v < 0;
      const prev = i > 0 ? arr[i - 1]?.LTH_NUPL : null;
      const next = i < arr.length - 1 ? arr[i + 1]?.LTH_NUPL : null;
      const prevOk = typeof prev === 'number' && Number.isFinite(prev);
      const nextOk = typeof next === 'number' && Number.isFinite(next);
      const bridgeToPrev = prevOk && ((pos && prev < 0) || (neg && prev >= 0));
      const bridgeToNext = nextOk && ((pos && next < 0) || (neg && next >= 0));
      const isBridge = bridgeToPrev || bridgeToNext;
      return {
        ...d,
        LTH_NUPL_POS: (pos || isBridge) && ok ? v : null,
        LTH_NUPL_NEG: (neg || isBridge) && ok ? v : null,
      };
    });
  }, [chartData]);

  // SIP chart only: background shading (not raw engine flags). 0 = no fill (pre‑first‑arm), 1 = green, 2 = red.
  // Red latches when SIP_EXHAUSTED first fires and stays until the next SIP_EUPHORIA_FLAG rising edge (new arm).
  // After the first arm, we never use state 0 — only green or red so the plot is never “plain” again.
  const sipChartBackgroundSpans = useMemo(() => {
    const spans: { x1: number; x2: number; value: 0 | 1 | 2 }[] = [];
    if (!chartData.length) return spans;

    let holdRedUntilNextArm = false;
    let everArmed = false;
    const visual: (0 | 1 | 2)[] = [];

    for (let i = 0; i < chartData.length; i++) {
      const d = chartData[i] as any;
      const armed = Number(d.SIP_EUPHORIA_FLAG) === 1;
      const exhausted = Number(d.SIP_EXHAUSTED) === 1;
      const prev = i > 0 ? (chartData[i - 1] as any) : null;
      const prevArmed = prev ? Number(prev.SIP_EUPHORIA_FLAG) === 1 : false;
      const prevExhausted = prev ? Number(prev.SIP_EXHAUSTED) === 1 : false;

      if (exhausted && !prevExhausted) holdRedUntilNextArm = true;
      if (armed && !prevArmed) holdRedUntilNextArm = false;

      let v: 0 | 1 | 2;
      if (!everArmed) v = armed ? 1 : 0;
      else if (holdRedUntilNextArm) v = 2;
      else v = 1;

      if (armed) everArmed = true;
      visual.push(v);
    }

    let current = visual[0];
    let startTs = (chartData[0] as any).ts;
    for (let i = 1; i < chartData.length; i++) {
      const vi = visual[i];
      const ts = (chartData[i] as any).ts;
      if (vi !== current) {
        const prevTs = (chartData[i - 1] as any).ts;
        if (prevTs > startTs) spans.push({ x1: startTs, x2: prevTs, value: current });
        current = vi;
        startTs = ts;
      }
    }
    const endTs = (chartData[chartData.length - 1] as any).ts;
    if (endTs > startTs) spans.push({ x1: startTs, x2: endTs, value: current });
    return spans;
  }, [chartData]);

  const liqSpans = useMemo(() => buildRegimeSpans(chartData as any, 'LIQ_SCORE'), [chartData]);
  const cycleSpans = useMemo(() => buildRegimeSpans(chartData as any, 'BIZ_CYCLE_SCORE'), [chartData]);
  const priceRegimeSpans = useMemo(() => buildBinarySpans(chartData as any, 'PRICE_REGIME_ON'), [chartData]);
  const dxyPersistSpans = useMemo(() => buildBinarySpans(chartData as any, 'DXY_PERSIST'), [chartData]);
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
          <Tab value="global" label="Global Liq." sx={{ minHeight: 40 }} />
          <Tab value="business" label="Business Cycle" sx={{ minHeight: 40 }} />
          <Tab value="usd" label="USD" sx={{ minHeight: 40 }} />
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
            CORE is driven by VAL_SCORE + PRICE_REGIME
            <br/>
            MACRO is driven by (LIQ_SCORE + BIZ_BIZ_CYCLE_SCORE) with persistence-filtered DXY_SCORE as a gate. 
            <br />
            Both PRICE_REGIME and DXY_SCORE use a 20/30-day persistence filter. 
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
                    ifOverflow="hidden"
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
              {renderChartBrush()}
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
                    ifOverflow="hidden"
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
              {renderChartBrush()}
              
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
                {renderChartBrush()}
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
                {renderChartBrush()}
                <Line yAxisId="liq" type="monotone" dataKey="US_LIQ" name="US_LIQ" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="yoy" type="monotone" dataKey="US_LIQ_YOY" name="US_LIQ_YOY" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
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
            BTCUSD shaded by the 4-tier VAL_SCORE. 
            <br />
            Score 3 = extreme (NUPL &lt; 0 + LTH SOPR &lt; 1); Score 2 = strong (deep value or capitulation);
            Score 1 = fair/neutral (NUPL 0.382–0.618); Score 0 = euphoria (NUPL ≥ 0.618).
            <br />
            NUPL is derived from MVRV as 1 − 1/MVRV. VAL_SCORE feeds CORE_ON entry/exit rules.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Score 3 — Extreme" sx={{ borderColor: '#15803d', color: '#86efac' }} />
          <Chip size="small" variant="outlined" label="Score 2 — Strong" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="Score 1 — Fair" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="Score 0 — Euphoria" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`val-score-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
                    ifOverflow="hidden"
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
              {renderChartBrush()}
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* MVRV ratio: dual-axis with key valuation thresholds */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Market Value to Realized Value Ratio (MVRV)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            MVRV = Market Cap / Realized Cap. VAL_SCORE uses NUPL (= 1 − 1/MVRV) thresholds.
            <br />
            Reference lines mark equivalent MVRV levels: 1.0 (NUPL = 0, deep value), 1.62 (NUPL = 0.382, fair), 2.62 (NUPL = 0.618, euphoria).
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="MVRV" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
          <Chip size="small" variant="outlined" label="BTCUSD (right, log)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
          <Chip size="small" variant="outlined" label="MVRV = 1.0 (NUPL = 0)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="MVRV ≈ 1.62 (NUPL = 0.382)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="MVRV ≈ 2.62 (NUPL = 0.618)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`mvrv-ratio-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="mvrv" domain={['auto', 'auto']} allowDataOverflow tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(2) : '')} />
              <YAxis yAxisId="btc" orientation="right" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <ReferenceLine yAxisId="mvrv" y={1} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: '1.0 (NUPL=0)', fill: '#cbd5e1', fontSize: 10, position: 'right' }} />
              <ReferenceLine yAxisId="mvrv" y={1 / (1 - 0.381924)} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: '1.62 (NUPL=0.382)', fill: '#cbd5e1', fontSize: 10, position: 'right' }} />
              <ReferenceLine yAxisId="mvrv" y={1 / (1 - 0.618)} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: '2.62 (NUPL=0.618)', fill: '#fca5a5', fontSize: 10, position: 'right' }} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="mvrv" type="monotone" dataKey="MVRV" name="MVRV" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
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
                  ifOverflow="hidden"
                  fill={s.value === 1 ? '#22c55e' : '#ef4444'}
                  fillOpacity={0.36}
                  strokeOpacity={0}
                />
              ))}
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="btc" scale="log" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTC_MA40W" name="BTC 40W MA" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* Long-Term Holder SOPR */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Long-Term Holder SOPR
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Spent Output Profit Ratio for long-term holders (coins held &gt; 155 days). 
            <br />
            LTH-SOPR &gt; 1 means LTHs are spending coins at a profit; &lt; 1 means they are realising losses. 
            <br />
            Historically, sustained LTH-SOPR &lt; 1 has coincided with late-bear capitulation zones — optimal accumulation windows.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="LTH SOPR ≥ 1 (profit)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="LTH SOPR < 1 (loss)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="SOPR = 1 (break-even)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="BTCUSD (right, log)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`lth-sopr-${range}`} data={soprChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="sopr" domain={[0, 10]} allowDataOverflow tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(1) : '')} />
              <YAxis yAxisId="btc" orientation="right" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <ReferenceLine yAxisId="sopr" y={1} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="sopr" type="monotone" dataKey="LTH_SOPR_PROFIT" name="LTH SOPR (profit)" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="sopr" type="monotone" dataKey="LTH_SOPR_LOSS" name="LTH SOPR (loss)" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* Holder realized prices (STH / LTH cost basis vs spot) */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Holder Realized Prices
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Short-term and long-term holder realized prices estimate the average on-chain cost basis for each cohort.
            <br />
            They are useful valuation anchors for spotting when spot price reclaims or loses key holder cost-basis zones.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="STH Realized Price" sx={{ borderColor: '#f97316', color: '#fdba74' }} />
          <Chip size="small" variant="outlined" label="LTH Realized Price" sx={{ borderColor: '#38bdf8', color: '#bae6fd' }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`holder-realized-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="price" orientation="right" scale="log" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="price" type="monotone" dataKey="STH_REALIZED_PRICE" name="STH Realized Price" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line yAxisId="price" type="monotone" dataKey="LTH_REALIZED_PRICE" name="LTH Realized Price" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line yAxisId="price" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* Supply in Profit (SIP) — Euphoria Exhaustion exit logic */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Supply in Profit (SIP)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Percentage of total BTC supply currently in profit (current price above the price at which coins last moved on-chain).
            <br />
            Used in the Euphoria Exhaustion exit logic: when SIP stays above 95% for 14+ days the exit is armed;
            if SIP then drops below 90% and fails to reclaim 95% within 45 days, exhaustion is confirmed.
            <br />
            Chart shading only: red stays on from the first exhaustion day until the next euphoria‑arm day (rising edge of SIP_EUPHORIA_FLAG); after the first arm, the background is only green or red (never unshaded).
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Supply in Profit (%)" sx={{ borderColor: '#facc15', color: '#fef08a' }} />
          <Chip size="small" variant="outlined" label="95% Euphoria threshold" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="90% Drop threshold" sx={{ borderColor: '#f59e0b', color: '#fde68a' }} />
          <Chip size="small" variant="filled" label="Euphoria armed" sx={{ bgcolor: 'rgba(34,197,94,0.2)', color: '#bbf7d0', fontSize: 11 }} />
          <Chip size="small" variant="filled" label="SIP exhausted" sx={{ bgcolor: 'rgba(239,68,68,0.25)', color: '#fecaca', fontSize: 11 }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 360, sm: 460, md: 520 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`sip-${range}`} data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="sip" domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? `${v}%` : '')} />
              <YAxis yAxisId="btc" orientation="right" scale="log" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => { if (typeof v !== 'number' || isNaN(v)) return ''; return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0); }} />
              {sipChartBackgroundSpans.filter((s) => s.value > 0).map((s, i) => (
                <ReferenceArea
                  key={`sip-span-${i}`}
                  yAxisId="sip"
                  x1={s.x1}
                  x2={s.x2}
                  y1={0}
                  y2={100}
                  ifOverflow="hidden"
                  fill={s.value === 2 ? '#ef4444' : '#22c55e'}
                  fillOpacity={0.36}
                  strokeOpacity={0}
                />
              ))}
              <ReferenceLine yAxisId="sip" y={95} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: '95% Euphoria', fill: '#fca5a5', fontSize: 10, position: 'left' }} />
              <ReferenceLine yAxisId="sip" y={90} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} label={{ value: '90% Drop', fill: '#fde68a', fontSize: 10, position: 'left' }} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="sip" type="monotone" dataKey="SIP" name="Supply in Profit (%)" stroke="#facc15" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* NUPL — All Holders (derived from MVRV, used in VAL_SCORE) */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            NUPL — All Holders
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            NUPL = 1 − 1/MVRV (derived from MVRV, bounded oscillator).
            <br />
            Used directly in VAL_SCORE: NUPL &lt; 0 = deep value, 0–0.382 = fair with capitulation, &lt; 0.618 = neutral, ≥ 0.618 = euphoria.
            <br />
            Unlike MVRV, NUPL thresholds remain structurally stable across cycles.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="NUPL ≥ 0 (profit)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="NUPL < 0 (loss)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="NUPL = 0 (break-even)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="BTCUSD (right, log)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`nupl-${range}`} data={nuplChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="nupl" domain={[-1, 1]} allowDataOverflow tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(2) : '')} />
              <YAxis yAxisId="btc" orientation="right" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <ReferenceLine yAxisId="nupl" y={0} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} />
              <ReferenceLine yAxisId="nupl" y={0.618} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Euphoria (0.618)', fill: '#fca5a5', fontSize: 10, position: 'right' }} />
              <ReferenceLine yAxisId="nupl" y={0.381924} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Fair (0.382)', fill: '#cbd5e1', fontSize: 10, position: 'right' }} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="nupl" type="monotone" dataKey="NUPL_POS" name="NUPL (profit)" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="nupl" type="monotone" dataKey="NUPL_NEG" name="NUPL (loss)" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* NUPL — Long-Term Holders Only (from BGeometrics lth_nupl) */}
      {section === 'valuation' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            NUPL — Long-Term Holders Only
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            LTH NUPL measures unrealized profit/loss for coins held &gt; 155 days (BGeometrics).
            <br />
            Isolates conviction holders from recent buyers — LTH NUPL turning negative signals deep capitulation
            among the strongest hands, a historically rare and powerful accumulation signal.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="LTH NUPL ≥ 0 (profit)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="LTH NUPL < 0 (loss)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="LTH NUPL = 0 (break-even)" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="BTCUSD (right, log)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`lth-nupl-${range}`} data={lthNuplChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="nupl" domain={[-1, 1]} allowDataOverflow tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(2) : '')} />
              <YAxis yAxisId="btc" orientation="right" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <ReferenceLine yAxisId="nupl" y={0} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} />
              <ReferenceLine yAxisId="nupl" y={0.618} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Euphoria (0.618)', fill: '#fca5a5', fontSize: 10, position: 'right' }} />
              <ReferenceLine yAxisId="nupl" y={0.381924} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Fair (0.382)', fill: '#cbd5e1', fontSize: 10, position: 'right' }} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="nupl" type="monotone" dataKey="LTH_NUPL_POS" name="LTH NUPL (profit)" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="nupl" type="monotone" dataKey="LTH_NUPL_NEG" name="LTH NUPL (loss)" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* G3 Global Liquidity: BTC + G3 composite */}
      {section === 'global' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            G3 Central Bank Assets vs BTC
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Total assets of the three largest central banks (Fed + ECB + BOJ) converted to USD, plotted against BTCUSD.
            <br />
            G3 expansion typically signals a favorable liquidity backdrop for risk assets including Bitcoin.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="G3 Assets (USD)" sx={{ borderColor: '#60a5fa', color: '#bfdbfe' }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 360, sm: 460, md: 520 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`g3-btc-${range}`} data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
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
                yAxisId="g3"
                orientation="right"
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#60a5fa' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => {
                  if (typeof val !== 'number' || isNaN(val)) return '';
                  return `$${(val / 1e6).toFixed(1)}T`;
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="g3" type="monotone" dataKey="G3_ASSETS" name="G3 Assets" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* G3 Global Liquidity: components breakdown */}
      {section === 'global' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            G3 Components (USD)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Individual central bank balance sheets converted to USD.
            <br />
            Fed = WALCL. ECB = ECBASSETSW in EUR converted via DEXUSEU. BOJ = JPNASSETS in JPY converted via DEXJPUS.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Fed (WALCL)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
          <Chip size="small" variant="outlined" label="ECB (USD)" sx={{ borderColor: '#a78bfa', color: '#ddd6fe' }} />
          <Chip size="small" variant="outlined" label="BOJ (USD)" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
        </Stack>

        <Box sx={{ height: 360, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`g3-components-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="cb"
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (typeof v === 'number' ? `$${(v / 1e6).toFixed(1)}T` : '')}
              />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="cb" type="monotone" dataKey="FED_USD" name="Fed (WALCL)" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="cb" type="monotone" dataKey="ECB_USD" name="ECB (USD)" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="cb" type="monotone" dataKey="BOJ_USD" name="BOJ (USD)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* G3 Global Liquidity: YoY */}
      {section === 'global' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            G3 Assets YoY Change
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Year-over-year percent change in the G3 central bank assets composite (USD terms).
            <br />
            Positive YoY indicates the global monetary base is expanding; negative indicates contraction.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="G3 YoY (%)" sx={{ borderColor: '#34d399', color: '#bbf7d0' }} />
        </Stack>

        <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`g3-yoy-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="yoy"
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')}
              />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line
                yAxisId="yoy"
                type="monotone"
                dataKey={(d: any) => {
                  const v = d?.G3_YOY;
                  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
                  return v >= 0 ? v : null;
                }}
                name="G3 YoY (expanding)"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="yoy"
                type="monotone"
                dataKey={(d: any) => {
                  const v = d?.G3_YOY;
                  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
                  return v < 0 ? v : null;
                }}
                name="G3 YoY (contracting)"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
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
            BTCUSD shaded by BIZ_CYCLE_SCORE (Business Cycle). 
            <br />
            BIZ_CYCLE_SCORE=0 on recession risk when at least 2 of 3 triggers fire: SAHM ≥ 0.5, YC_M negative, or ISM PMI below 45 for 2+ consecutive months; 
            <br />
            BIZ_CYCLE_SCORE=2 in expansion (SAHM below 0.35 AND YC_M ≥ 0.75 AND ISM PMI ≥ 50 for 3+ consecutive months); otherwise BIZ_CYCLE_SCORE=1. 
            <br />
            This score contributes to MACRO_ON via (LIQ_SCORE + BIZ_BIZ_CYCLE_SCORE).
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
                  const c = regimeColor('BIZ_CYCLE_SCORE', s.value);
                return (
                  <ReferenceArea
                    key={`cyc-${i}-${s.x1}`}
                    yAxisId="btc"
                    x1={s.x1}
                    x2={s.x2}
                    y1={btcDomain.y1}
                    y2={btcDomain.y2}
                    ifOverflow="hidden"
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
              {renderChartBrush()}
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
            Inputs that drive BIZ_CYCLE_SCORE: SAHM Rule (labor stress), YC_M (10Y–3M yield curve slope), ISM Manufacturing PMI (with persistence filters), and New Orders (display‑only). 
            <br />
            The engine classifies recession risk vs expansion vs neutral using the thresholds described above.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="SAHM" sx={{ borderColor: '#a78bfa', color: '#ddd6fe' }} />
          <Chip size="small" variant="outlined" label="Yield Curve (10Y-3M)" sx={{ borderColor: '#34d399', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="New Orders (level)" sx={{ borderColor: '#60a5fa', color: '#bfdbfe' }} />
          <Chip size="small" variant="outlined" label="New Orders YoY (%)" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2.5 }}>
          <Box sx={{ height: 320, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`cycle-inputs-1-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="sahm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="yc" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                {renderChartBrush()}
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
                {renderChartBrush()}
                <Line yAxisId="no" type="monotone" dataKey="NO" name="New Orders (level)" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="noy" type="monotone" dataKey="NO_YOY" name="New Orders YoY (%)" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Paper>
      )}

      {/* ISM Manufacturing PMI */}
      {section === 'business' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            ISM Manufacturing PMI
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            U.S. ISM Manufacturing Purchasing Managers Index — a monthly diffusion index where 50 = neutral.
            <br />
            Readings above 50 indicate manufacturing expansion; below 50 signals contraction.
            <br />
            PMI is released on the first business day of each month and is one of the most timely macro indicators available.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="ISM PMI" sx={{ borderColor: '#f97316', color: '#fdba74' }} />
          <Chip size="small" variant="outlined" label="50 = Neutral" sx={{ borderColor: '#94a3b8', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="BTCUSD (right, log)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`ism-pmi-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="pmi" domain={[30, 70]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="btc" orientation="right" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <ReferenceLine yAxisId="pmi" y={50} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: '50 (Neutral)', fill: '#cbd5e1', fontSize: 10, position: 'left' }} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="pmi" type="monotone" dataKey="ISM_PMI" name="ISM PMI" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.5} dot={false} isAnimationActive={false} opacity={0.5} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}

      {/* USD Regime Inputs (DTWEXBGS proxy) */}
      {section === 'usd' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            USD Regime (DXY_SCORE)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            DTWEXBGS (trade‑weighted USD; the DXY proxy) with MA50/MA200 and ROC20 (20‑day % change). 
            <br />
            Raw DXY_SCORE: 0 (headwind) when ROC20 &gt; +0.5%; 2 (supportive) when ROC20 &lt; −0.5% and MA50 &lt; MA200; otherwise 1 (neutral). 
            <br />
            A 20/30 persistence filter is applied: DXY_SCORE ≥ 1 must hold for ≥ 20 of the last 30 days, otherwise
            the effective DXY_SCORE is forced to 0. This prevents brief DXY pauses from triggering premature signal entries.
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
                {renderChartBrush()}
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
                {renderChartBrush()}
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

      {/* DXY Persistence Regime: BTCUSD shaded by DXY_PERSIST */}
      {section === 'usd' && (
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            DXY Persistence Regime
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            BTCUSD shaded by the DXY persistence filter (20/30 days).
            <br />
            DXY_PERSIST=1 (green) means the raw DXY_SCORE has been ≥ 1 for at least 20 of the last 30 days —
            the USD is not a headwind and signals may fire. DXY_PERSIST=0 (red) means the favorable window has not
            been sustained, forcing the effective DXY_SCORE to 0 and blocking CORE entry.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Favorable (DXY_PERSIST=1)" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
          <Chip size="small" variant="outlined" label="Headwind (DXY_PERSIST=0)" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
          <Chip size="small" variant="outlined" label="BTCUSD" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
        </Stack>

        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart key={`dxy-persist-${range}`} data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              {dxyPersistSpans.map((s, i) => (
                <ReferenceArea
                  key={`dxy-p-${i}-${s.x1}`}
                  yAxisId="btc"
                  x1={s.x1}
                  x2={s.x2}
                  y1={btcDomain.y1}
                  y2={btcDomain.y2}
                  ifOverflow="hidden"
                  fill={s.value === 1 ? '#22c55e' : '#ef4444'}
                  fillOpacity={0.36}
                  strokeOpacity={0}
                />
              ))}
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="btc" scale="log" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
              <Tooltip content={<CustomTooltip />} />
              {renderChartBrush()}
              <Line yAxisId="btc" type="monotone" dataKey="BTCUSD" name="BTCUSD" stroke="#e5e7eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>
      )}
    </Box>
  );
};

export default ChartsView;

