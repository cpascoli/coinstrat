/**
 * Lab Inspect mode: single-strategy deep dive with strategy-specific charts.
 * Equity always overlays Baseline DCA for context.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, Area, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Brush, ReferenceArea, ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import {
  Box, Chip, Grid, Paper, Stack, Typography,
} from '@mui/material';
import { TrendingUp, Coins, DollarSign, Wallet, BarChart3, ShieldAlert } from 'lucide-react';
import type { StrategyResult } from '../../services/backtest';
import {
  computeEmaTrendSeries,
  EMA_DEFAULT_SIGNAL_SCALE,
} from '../../services/backtest';
import {
  computeLliSeries,
  parseLliPeriods,
  type LliMode,
  type LliState,
} from '../../utils/larssonLine';
import {
  computeCryptoTrendSeries,
  type CryptoTrendParams,
  type CryptoTrendState,
} from '../../utils/cryptoTrend';
import { buildRiskGradientStops } from '../../utils/cqmRiskGradient';
import type { SignalData } from '../../App';
import { STRATEGY_COLORS, type LabInspectStrategy } from './labTypes';

type RiskBand = 0 | 1 | 2 | 3;

function riskBand(r: number): RiskBand {
  if (r < 0.25) return 0;
  if (r < 0.5) return 1;
  if (r < 0.75) return 2;
  return 3;
}

function riskColor(b: RiskBand): { fill: string; alpha: number } {
  switch (b) {
    case 0: return { fill: '#22c55e', alpha: 0.16 };
    case 1: return { fill: '#84cc16', alpha: 0.14 };
    case 2: return { fill: '#f59e0b', alpha: 0.14 };
    case 3: return { fill: '#ef4444', alpha: 0.16 };
    default: {
      const _exhaustive: never = b;
      return _exhaustive;
    }
  }
}

function lliColor(s: LliState): { fill: string; alpha: number } {
  switch (s) {
    case 'gold': return { fill: '#eab308', alpha: 0.22 };
    case 'blue': return { fill: '#6366f1', alpha: 0.20 };
    case 'gray': return { fill: '#64748b', alpha: 0.12 };
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

/** Pine colours: yellow up, purple down, orange neutral. */
function cryptoTrendColor(s: CryptoTrendState): { fill: string; alpha: number } {
  switch (s) {
    case 'up': return { fill: '#CCCC00', alpha: 0.20 };
    case 'down': return { fill: '#5D3FD3', alpha: 0.24 };
    case 'neutral': return { fill: '#DB6600', alpha: 0.16 };
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

type StateSpan<S extends string> = { x1: number; x2: number; state: S };

function buildStateSpans<S extends string>(
  rows: Array<{ ts: number; date: string }>,
  stateByDate: Map<string, S>,
): StateSpan<S>[] {
  const spans: StateSpan<S>[] = [];
  if (!rows.length || stateByDate.size === 0) return spans;
  let current: S | null = null;
  let startTs: number | null = null;
  let prevTs: number | null = null;
  for (const row of rows) {
    const s = stateByDate.get(row.date);
    if (!s) continue;
    if (current === null) {
      current = s;
      startTs = row.ts;
      prevTs = row.ts;
      continue;
    }
    if (s !== current && startTs !== null && prevTs !== null) {
      const boundary = (prevTs + row.ts) / 2;
      if (boundary > startTs) spans.push({ x1: startTs, x2: boundary, state: current });
      current = s;
      startTs = boundary;
    }
    prevTs = row.ts;
  }
  if (current !== null && startTs !== null && prevTs !== null && prevTs > startTs) {
    spans.push({ x1: startTs, x2: prevTs, state: current });
  }
  return spans;
}

type RiskSpan = { x1: number; x2: number; band: RiskBand };

function buildRiskSpans(
  rows: Array<{ ts: number; date: string }>,
  riskByDate: Map<string, number>,
): RiskSpan[] {
  const spans: RiskSpan[] = [];
  if (!rows.length || riskByDate.size === 0) return spans;
  let current: RiskBand | null = null;
  let startTs: number | null = null;
  let prevTs: number | null = null;
  for (const row of rows) {
    const r = riskByDate.get(row.date);
    if (!Number.isFinite(r)) continue;
    const b = riskBand(r as number);
    if (current === null) {
      current = b;
      startTs = row.ts;
      prevTs = row.ts;
      continue;
    }
    if (b !== current && startTs !== null && prevTs !== null) {
      const boundary = (prevTs + row.ts) / 2;
      if (boundary > startTs) spans.push({ x1: startTs, x2: boundary, band: current });
      current = b;
      startTs = boundary;
    }
    prevTs = row.ts;
  }
  if (current !== null && startTs !== null && prevTs !== null && prevTs > startTs) {
    spans.push({ x1: startTs, x2: prevTs, band: current });
  }
  return spans;
}

function MetricBox(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
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

function fmtUsd(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Deposit-normalized ROI and return-drawdown paths (same basis as
 * `totalReturn` / `maxReturnDrawdown` in the backtest).
 */
function buildReturnPath(series: StrategyResult['series']): Array<{
  date: string;
  roiPct: number;
  drawdownPct: number;
}> {
  let peakRatio = -Infinity;
  const out: Array<{ date: string; roiPct: number; drawdownPct: number }> = [];
  for (const pt of series) {
    if (!(pt.cashDeployed > 0)) continue;
    const ratio = pt.portfolioValue / pt.cashDeployed;
    if (!Number.isFinite(ratio)) continue;
    if (ratio > peakRatio) peakRatio = ratio;
    const drawdownPct = peakRatio > 0 ? ((ratio - peakRatio) / peakRatio) * 100 : 0;
    out.push({
      date: pt.date,
      roiPct: (ratio - 1) * 100,
      drawdownPct,
    });
  }
  return out;
}

function fmtPctOrNa(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
}

export interface LabInspectViewProps {
  strategyName: LabInspectStrategy;
  inspected: StrategyResult;
  baseline: StrategyResult;
  signalData: SignalData[];
  riskByDate: Map<string, number>;
  /** Full history used to warm EMAs / LLI (same as backtest input). */
  seriesData: SignalData[];
  emaFastPeriod: number;
  emaSlowPeriod: number;
  lliMode: LliMode;
  lliSeries: 'risk' | 'price';
  lliPeriods: readonly [number, number, number, number];
  lliFastPeriod: number;
  lliSlowPeriod: number;
  lliAtrPeriod: number;
  lliAtrMult: number;
  cryptoTrendParams: CryptoTrendParams;
  tradesTable: React.ReactNode;
}

const LabInspectView: React.FC<LabInspectViewProps> = ({
  strategyName,
  inspected,
  baseline,
  signalData,
  riskByDate,
  seriesData,
  emaFastPeriod,
  emaSlowPeriod,
  lliMode,
  lliSeries,
  lliPeriods,
  lliFastPeriod,
  lliSlowPeriod,
  lliAtrPeriod,
  lliAtrMult,
  cryptoTrendParams,
  tradesTable,
}) => {
  const color = STRATEGY_COLORS[strategyName] ?? '#94a3b8';
  const baseColor = STRATEGY_COLORS['Baseline DCA'];

  const chartData = useMemo(() => {
    const dateMap = new Map<string, Record<string, unknown>>();
    for (const pt of baseline.series) {
      const dt = new Date(pt.date);
      const btcUsd = pt.btcHeld * pt.btcPrice;
      const cashUsd = pt.portfolioValue - btcUsd;
      dateMap.set(pt.date, {
        date: pt.date,
        ts: dt.getTime(),
        fullDate: format(dt, 'yyyy-MM-dd'),
        btcPrice: pt.btcPrice,
        pv_Baseline: pt.portfolioValue > 0 ? pt.portfolioValue : null,
        btc_Baseline: pt.btcHeld,
        btcUsd_Baseline: Number.isFinite(btcUsd) ? Math.max(0, btcUsd) : null,
        cashUsd_Baseline: Number.isFinite(cashUsd) ? Math.max(0, cashUsd) : null,
      });
    }
    for (const pt of inspected.series) {
      const entry = dateMap.get(pt.date);
      if (entry) {
        const btcUsd = pt.btcHeld * pt.btcPrice;
        const cashUsd = pt.portfolioValue - btcUsd;
        entry.pv_Inspect = pt.portfolioValue > 0 ? pt.portfolioValue : null;
        entry.btc_Inspect = pt.btcHeld;
        entry.btcUsd_Inspect = Number.isFinite(btcUsd) ? Math.max(0, btcUsd) : null;
        entry.cashUsd_Inspect = Number.isFinite(cashUsd) ? Math.max(0, cashUsd) : null;
      }
    }
    for (const d of signalData) {
      const entry = dateMap.get(d.Date);
      if (entry) {
        entry.CORE_ON = d.CORE_ON;
        entry.MACRO_ON = d.MACRO_ON;
      }
    }
    if (riskByDate.size > 0) {
      for (const [date, risk] of riskByDate) {
        const entry = dateMap.get(date);
        if (entry) {
          entry.cqmRisk = risk;
          entry.riskPct = risk * 100;
        }
      }
    }
    return Array.from(dateMap.values()).sort(
      (a, b) => (a.ts as number) - (b.ts as number),
    );
  }, [baseline.series, inspected.series, signalData, riskByDate]);

  const rows = useMemo(
    () => chartData.map((d) => ({ ts: d.ts as number, date: d.date as string })),
    [chartData],
  );

  const performanceChartData = useMemo(() => {
    const byDate = new Map<string, {
      date: string;
      ts: number;
      fullDate: string;
      roi_Inspect: number | null;
      dd_Inspect: number | null;
      roi_Baseline: number | null;
      dd_Baseline: number | null;
    }>();

    for (const pt of buildReturnPath(baseline.series)) {
      const ts = new Date(pt.date).getTime();
      byDate.set(pt.date, {
        date: pt.date,
        ts,
        fullDate: pt.date,
        roi_Baseline: pt.roiPct,
        dd_Baseline: pt.drawdownPct,
        roi_Inspect: null,
        dd_Inspect: null,
      });
    }
    for (const pt of buildReturnPath(inspected.series)) {
      const existing = byDate.get(pt.date);
      if (existing) {
        existing.roi_Inspect = pt.roiPct;
        existing.dd_Inspect = pt.drawdownPct;
      } else {
        const ts = new Date(pt.date).getTime();
        byDate.set(pt.date, {
          date: pt.date,
          ts,
          fullDate: pt.date,
          roi_Inspect: pt.roiPct,
          dd_Inspect: pt.drawdownPct,
          roi_Baseline: null,
          dd_Baseline: null,
        });
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.ts - b.ts);
  }, [baseline.series, inspected.series]);

  const riskSpans = useMemo(() => buildRiskSpans(rows, riskByDate), [rows, riskByDate]);

  const lliFullSeries = useMemo(() => {
    if (strategyName !== 'LLI+CQM DCA') return [];
    const seriesPoints =
      lliSeries === 'risk'
        ? [...riskByDate.entries()]
            .filter(([, r]) => Number.isFinite(r))
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => a.date.localeCompare(b.date))
        : seriesData
            .filter((d) => Number.isFinite(d.BTCUSD) && d.BTCUSD > 0)
            .map((d) => ({ date: d.Date, value: d.BTCUSD }));
    return lliMode === 'ribbon4'
      ? computeLliSeries(seriesPoints, {
          mode: 'ribbon4',
          periods: parseLliPeriods(lliPeriods),
          minGap: lliSeries === 'risk' ? 0.002 : 0,
        })
      : computeLliSeries(seriesPoints, {
          mode: 'emaAtr',
          fastPeriod: lliFastPeriod,
          slowPeriod: lliSlowPeriod,
          atrPeriod: lliAtrPeriod,
          atrMult: lliAtrMult,
        });
  }, [
    strategyName, lliSeries, lliMode, lliPeriods, lliFastPeriod, lliSlowPeriod,
    lliAtrPeriod, lliAtrMult, riskByDate, seriesData,
  ]);

  const lliStateByDate = useMemo(() => {
    const map = new Map<string, LliState>();
    for (const row of lliFullSeries) map.set(row.date, row.state);
    return map;
  }, [lliFullSeries]);

  const lliSpans = useMemo(() => buildStateSpans(rows, lliStateByDate), [rows, lliStateByDate]);

  const ctSeries = useMemo(() => {
    if (strategyName !== 'CryptoTrend DCA') return [];
    return computeCryptoTrendSeries(
      seriesData.map((d) => ({ date: d.Date, price: d.BTCUSD })),
      cryptoTrendParams,
    );
  }, [strategyName, seriesData, cryptoTrendParams]);

  const ctStateByDate = useMemo(() => {
    const map = new Map<string, CryptoTrendState>();
    for (const row of ctSeries) map.set(row.date, row.state);
    return map;
  }, [ctSeries]);

  const ctSpans = useMemo(() => buildStateSpans(rows, ctStateByDate), [rows, ctStateByDate]);

  /** Inspect-window rows for the CryptoTrend ribbon chart. */
  const ctChartData = useMemo(() => {
    if (ctSeries.length === 0 || chartData.length === 0) return [];
    const byDate = new Map(ctSeries.map((r) => [r.date, r]));
    return chartData.flatMap((d) => {
      const row = byDate.get(d.date as string);
      if (!row) return [];
      return [{
        ts: d.ts as number,
        fullDate: d.fullDate as string,
        state: row.state,
        price: row.price,
        jaw: row.jaw,
        lips: row.lips,
        bandUpper: row.bandUpper,
        bandLower: row.bandLower,
        atr: row.atr,
      }];
    });
  }, [ctSeries, chartData]);

  /** Inspect-window rows: underlying series + MAs (risk shown as 0–100). */
  const lliRibbonChartData = useMemo(() => {
    if (lliFullSeries.length === 0 || chartData.length === 0) return [];
    const byDate = new Map(lliFullSeries.map((r) => [r.date, r]));
    const scale = lliSeries === 'risk' ? 100 : 1;
    return chartData.flatMap((d) => {
      const row = byDate.get(d.date as string);
      if (!row) return [];
      return [{
        ts: d.ts as number,
        fullDate: d.fullDate as string,
        lliState: row.state,
        series: row.value * scale,
        ema1: row.ema1 != null ? row.ema1 * scale : null,
        ema2: row.ema2 != null ? row.ema2 * scale : null,
        ema3: row.ema3 != null ? row.ema3 * scale : null,
        ema4: row.ema4 != null ? row.ema4 * scale : null,
        emaFast: row.emaFast != null ? row.emaFast * scale : null,
        emaSlow: row.emaSlow != null ? row.emaSlow * scale : null,
        atrBandUpper: row.atrBandUpper != null ? row.atrBandUpper * scale : null,
        atrBandLower: row.atrBandLower != null ? row.atrBandLower * scale : null,
      }];
    });
  }, [lliFullSeries, chartData, lliSeries]);

  /** Brush indices on the LLI Filter chart — Y domain rescales to the visible slice. */
  const [lliBrushIndices, setLliBrushIndices] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    // Reset zoom when the underlying series / window changes.
    setLliBrushIndices(null);
  }, [lliRibbonChartData, lliSeries, lliMode]);

  const lliRibbonDomain = useMemo(() => {
    const n = lliRibbonChartData.length;
    if (n === 0) return { y1: 0, y2: 1, log: false };
    const start = Math.max(0, Math.min(lliBrushIndices?.start ?? 0, n - 1));
    const end = Math.max(start, Math.min(lliBrushIndices?.end ?? n - 1, n - 1));
    const keys = ['series', 'ema1', 'ema2', 'ema3', 'ema4', 'emaFast', 'emaSlow', 'atrBandUpper', 'atrBandLower'] as const;
    const vals: number[] = [];
    for (let i = start; i <= end; i++) {
      const d = lliRibbonChartData[i];
      for (const key of keys) {
        const v = d[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        // Log price scale needs positives; risk scale is linear and may be 0.
        if (lliSeries !== 'risk' && v <= 0) continue;
        vals.push(v);
      }
    }
    if (!vals.length) {
      return lliSeries === 'risk' ? { y1: 0, y2: 1, log: false } : { y1: 1, y2: 10, log: true };
    }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (lliSeries === 'risk') {
      const y1 = Math.max(0, lo - 2);
      const y2 = Math.min(100, hi + 2);
      return { y1, y2: y2 > y1 ? y2 : y1 + 1, log: false };
    }
    return {
      y1: Math.max(lo * 0.96, 1e-6),
      y2: hi * 1.04,
      log: true,
    };
  }, [lliRibbonChartData, lliSeries, lliBrushIndices]);

  const emaSeries = useMemo(() => {
    if (strategyName !== 'EMA Trend DCA') return new Map();
    return computeEmaTrendSeries(
      seriesData,
      emaFastPeriod,
      emaSlowPeriod,
      EMA_DEFAULT_SIGNAL_SCALE,
    );
  }, [strategyName, seriesData, emaFastPeriod, emaSlowPeriod]);

  const emaChartData = useMemo(() => {
    if (emaSeries.size === 0) return [];
    return chartData.map((d) => {
      const pt = emaSeries.get(d.date as string);
      return {
        ...d,
        emaFast: pt?.emaFast ?? null,
        emaSlow: pt?.emaSlow ?? null,
        targetWeight: pt != null ? pt.weight * 100 : null,
      };
    });
  }, [chartData, emaSeries]);

  const lliChartData = useMemo(() => {
    if (lliStateByDate.size === 0) return chartData;
    return chartData.map((d) => {
      const s = lliStateByDate.get(d.date as string);
      return {
        ...d,
        lliState: s ?? null,
        lliCode: s === 'gold' ? 2 : s === 'blue' ? 0 : s === 'gray' ? 1 : null,
      };
    });
  }, [chartData, lliStateByDate]);

  const wfRiskData = useMemo(() => {
    return chartData
      .filter((d) => Number.isFinite(d.cqmRisk as number))
      .map((d) => ({
        ts: d.ts as number,
        fullDate: d.fullDate as string,
        riskPct: (d.cqmRisk as number) * 100,
        btcPrice: d.btcPrice as number,
      }));
  }, [chartData]);

  const wfRiskGradientStops = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of wfRiskData) {
      if (!Number.isFinite(d.riskPct)) continue;
      if (d.riskPct < lo) lo = d.riskPct;
      if (d.riskPct > hi) hi = d.riskPct;
    }
    return buildRiskGradientStops(lo, hi);
  }, [wfRiskData]);

  const btcDomain = useMemo(() => {
    const vals = chartData
      .map((d) => Number(d.btcPrice))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return { y1: 1, y2: 10 };
    return { y1: Math.max(Math.min(...vals) * 0.85, 1e-6), y2: Math.max(...vals) * 1.15 };
  }, [chartData]);

  const spanYears = useMemo(() => {
    if (!chartData.length) return 5;
    const first = chartData[0]?.ts as number;
    const last = chartData[chartData.length - 1]?.ts as number;
    return (last - first) / (365.25 * 24 * 60 * 60 * 1000);
  }, [chartData]);

  const useYearFormat = spanYears > 3;
  const tickCount = spanYears > 5 ? 10 : 8;
  const xTickFormatter = (value: unknown) => {
    try {
      const d = new Date(value as number);
      if (isNaN(d.getTime())) return String(value);
      return useYearFormat ? format(d, 'yyyy') : format(d, 'MMM yy');
    } catch {
      return String(value);
    }
  };

  const showRiskShading = strategyName === 'CQM Risk DCA' || strategyName === 'LLI+CQM DCA';
  const showLliShading = strategyName === 'LLI+CQM DCA';
  const showCtShading = strategyName === 'CryptoTrend DCA';
  const equityShading = showLliShading ? 'lli' : showCtShading ? 'ct' : showRiskShading ? 'risk' : 'none';

  const EquityTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload: Record<string, unknown> }> }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload ?? {};
    return (
      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
        <p className="mb-2 font-bold text-slate-100">{String(row.fullDate ?? '')}</p>
        <div className="space-y-1">
          {payload.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-8">
              <span className="text-xs text-slate-300" style={{ color: p.color }}>{p.name}:</span>
              <span className="text-xs font-mono font-bold text-slate-100">
                {typeof p.value === 'number' ? `$${p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : p.value}
              </span>
            </div>
          ))}
          {typeof row.cqmRisk === 'number' && (
            <div className="mt-1 flex items-center justify-between gap-8 border-t border-slate-700/60 pt-1">
              <span className="text-xs text-slate-300">CQM Risk:</span>
              <span className="text-xs font-mono font-bold text-slate-100">{((row.cqmRisk as number) * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Metric strip: inspected vs baseline */}
      <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{strategyName}</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: baseColor }} />
            <Typography variant="caption" color="text.secondary">Baseline DCA</Typography>
          </Stack>
        </Stack>
        <Grid container spacing={1.5}>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<TrendingUp className="h-4 w-4" style={{ color }} />}
              label="Total Return"
              value={`${(inspected.totalReturn * 100).toFixed(1)}%`}
              tone={inspected.totalReturn >= 0 ? 'positive' : 'negative'}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<TrendingUp className="h-4 w-4" style={{ color }} />}
              label="IRR (annualized)"
              value={fmtPctOrNa(inspected.annualizedIrr * 100)}
              tone={inspected.annualizedIrr >= 0 ? 'positive' : 'negative'}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<ShieldAlert className="h-4 w-4" style={{ color }} />}
              label="Max Drawdown"
              value={`-${(inspected.maxReturnDrawdown * 100).toFixed(1)}%`}
              tone="negative"
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<BarChart3 className="h-4 w-4" style={{ color }} />}
              label="Return / Max DD"
              value={Number.isFinite(inspected.returnOverMaxDrawdown) ? inspected.returnOverMaxDrawdown.toFixed(2) : 'n/a'}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<Coins className="h-4 w-4" style={{ color }} />}
              label="Final Value"
              value={fmtUsd(inspected.finalPortfolioValue)}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<DollarSign className="h-4 w-4" style={{ color: baseColor }} />}
              label="Baseline Final"
              value={fmtUsd(baseline.finalPortfolioValue)}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<Wallet className="h-4 w-4" style={{ color }} />}
              label="Cash Balance"
              value={fmtUsd(inspected.finalCashBalance)}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <MetricBox
              icon={<BarChart3 className="h-4 w-4" style={{ color }} />}
              label="BTC Accumulated"
              value={inspected.btcAccumulated.toFixed(4)}
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Equity vs Baseline */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Portfolio Value</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            {strategyName} versus Baseline DCA under identical deposits.
            {equityShading === 'lli' && ' Background: gold / blue / gray LLI state.'}
            {equityShading === 'risk' && ' Background: walk-forward CQM Risk bands.'}
            {equityShading === 'ct' && ' Background: CryptoTrend state (yellow up / purple down / orange neutral).'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label={strategyName} sx={{ borderColor: color, color }} />
          {strategyName !== 'Baseline DCA' && (
            <Chip size="small" variant="outlined" label="Baseline DCA" sx={{ borderColor: baseColor, color: baseColor }} />
          )}
          <Chip size="small" variant="outlined" label="BTC Price" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
        </Stack>
        <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={showLliShading ? lliChartData : chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              {equityShading === 'lli' && lliSpans.map((s, i) => {
                const c = lliColor(s.state);
                return (
                  <ReferenceArea
                    key={`lli-${i}-${s.x1}`}
                    yAxisId="pv"
                    x1={s.x1}
                    x2={s.x2}
                    ifOverflow="hidden"
                    fill={c.fill}
                    fillOpacity={c.alpha}
                    strokeOpacity={0}
                  />
                );
              })}
              {equityShading === 'ct' && ctSpans.map((s, i) => {
                const c = cryptoTrendColor(s.state);
                return (
                  <ReferenceArea
                    key={`ct-${i}-${s.x1}`}
                    yAxisId="pv"
                    x1={s.x1}
                    x2={s.x2}
                    ifOverflow="hidden"
                    fill={c.fill}
                    fillOpacity={c.alpha}
                    strokeOpacity={0}
                  />
                );
              })}
              {equityShading === 'risk' && riskSpans.map((s, i) => {
                const c = riskColor(s.band);
                return (
                  <ReferenceArea
                    key={`risk-${i}-${s.x1}`}
                    yAxisId="pv"
                    x1={s.x1}
                    x2={s.x2}
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
              <Tooltip content={<EquityTooltip />} />
              <Brush dataKey="ts" height={22} stroke="#60a5fa" fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
              <Line yAxisId="btcPrice" type="monotone" dataKey="btcPrice" name="BTC Price" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
              {strategyName !== 'Baseline DCA' && (
                <Line yAxisId="pv" type="monotone" dataKey="pv_Baseline" name="Baseline DCA" stroke={baseColor} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              )}
              <Line yAxisId="pv" type="monotone" dataKey="pv_Inspect" name={strategyName} stroke={color} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* ROI vs Baseline */}
      {performanceChartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>ROI</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Portfolio value ÷ cumulative deposits − 1. Matches the Total Return metric
              {strategyName !== 'Baseline DCA' ? ' · dashed = Baseline DCA' : ''}.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            <Chip size="small" variant="outlined" label={strategyName} sx={{ borderColor: color, color }} />
            {strategyName !== 'Baseline DCA' && (
              <Chip size="small" variant="outlined" label="Baseline DCA" sx={{ borderColor: baseColor, color: baseColor }} />
            )}
            <Chip
              size="small"
              variant="outlined"
              label={`Final ${(inspected.totalReturn * 100).toFixed(1)}%`}
              sx={{ borderColor: color, color }}
            />
          </Stack>
          <Box sx={{ height: { xs: 280, sm: 340 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={performanceChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="inspectRoiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')}
                />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 3" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload ?? {};
                    return (
                      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                        {typeof row.roi_Inspect === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color }}>{strategyName}:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{row.roi_Inspect.toFixed(1)}%</span>
                          </div>
                        )}
                        {strategyName !== 'Baseline DCA' && typeof row.roi_Baseline === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color: baseColor }}>Baseline DCA:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{row.roi_Baseline.toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Brush dataKey="ts" height={22} stroke={color} fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
                {strategyName !== 'Baseline DCA' && (
                  <Line type="monotone" dataKey="roi_Baseline" name="Baseline DCA" stroke={baseColor} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                )}
                <Area type="monotone" dataKey="roi_Inspect" name={strategyName} stroke={color} strokeWidth={2.2} fill="url(#inspectRoiFill)" dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* Return drawdown vs Baseline */}
      {performanceChartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Drawdown</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Peak-to-trough on value ÷ deposits (not raw portfolio value), so DCA inflows do not mask losses.
              Max {(-(inspected.maxReturnDrawdown * 100)).toFixed(1)}%
              {strategyName !== 'Baseline DCA' ? ` vs Baseline −${(baseline.maxReturnDrawdown * 100).toFixed(1)}%` : ''}.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            <Chip size="small" variant="outlined" label={strategyName} sx={{ borderColor: color, color }} />
            {strategyName !== 'Baseline DCA' && (
              <Chip size="small" variant="outlined" label="Baseline DCA" sx={{ borderColor: baseColor, color: baseColor }} />
            )}
          </Stack>
          <Box sx={{ height: { xs: 280, sm: 340 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={performanceChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="inspectDdFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={['auto', 0]}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')}
                />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 3" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload ?? {};
                    return (
                      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                        {typeof row.dd_Inspect === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color }}>{strategyName}:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{row.dd_Inspect.toFixed(1)}%</span>
                          </div>
                        )}
                        {strategyName !== 'Baseline DCA' && typeof row.dd_Baseline === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color: baseColor }}>Baseline DCA:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{row.dd_Baseline.toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Brush dataKey="ts" height={22} stroke={color} fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
                {strategyName !== 'Baseline DCA' && (
                  <Line type="monotone" dataKey="dd_Baseline" name="Baseline DCA" stroke={baseColor} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                )}
                <Area type="monotone" dataKey="dd_Inspect" name={strategyName} stroke={color} strokeWidth={2.2} fill="url(#inspectDdFill)" dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* Portfolio assets: cash + BTC (USD), stacked */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Portfolio Assets</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Cash balance and BTC marked to market (USD). Stacked areas sum to portfolio value
            {strategyName !== 'Baseline DCA' ? ' · dashed lines = Baseline DCA' : ''}.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Chip size="small" variant="outlined" label="Cash" sx={{ borderColor: '#64748b', color: '#cbd5e1' }} />
          <Chip size="small" variant="outlined" label="BTC (USD)" sx={{ borderColor: '#fbbf24', color: '#fde68a' }} />
          {strategyName !== 'Baseline DCA' && (
            <>
              <Chip size="small" variant="outlined" label="Baseline cash" sx={{ borderColor: baseColor, color: baseColor }} />
              <Chip size="small" variant="outlined" label="Baseline BTC" sx={{ borderColor: '#a78bfa', color: '#c4b5fd' }} />
            </>
          )}
        </Stack>
        <Box sx={{ height: { xs: 300, sm: 380 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="inspectCashFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#64748b" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#64748b" stopOpacity={0.12} />
                </linearGradient>
                <linearGradient id="inspectBtcFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.12} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="usd"
                domain={[0, 'auto']}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) =>
                  typeof val === 'number' ? `$${val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)}` : ''
                }
              />
              <YAxis
                yAxisId="btc"
                orientation="right"
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: color }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}₿` : '')}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload ?? {};
                  const fmtUsdVal = (v: unknown) =>
                    typeof v === 'number' ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
                  return (
                    <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                      <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-xs text-slate-300">Cash:</span>
                        <span className="text-xs font-mono font-bold text-slate-100">{fmtUsdVal(row.cashUsd_Inspect)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-xs" style={{ color: '#fbbf24' }}>BTC (USD):</span>
                        <span className="text-xs font-mono font-bold text-slate-100">{fmtUsdVal(row.btcUsd_Inspect)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-8">
                        <span className="text-xs" style={{ color }}>BTC held:</span>
                        <span className="text-xs font-mono font-bold text-slate-100">
                          {typeof row.btc_Inspect === 'number' ? `${row.btc_Inspect.toFixed(4)} BTC` : '—'}
                        </span>
                      </div>
                      {typeof row.pv_Inspect === 'number' && (
                        <div className="mt-1 flex items-center justify-between gap-8 border-t border-slate-700/60 pt-1">
                          <span className="text-xs text-slate-300">Total:</span>
                          <span className="text-xs font-mono font-bold text-slate-100">{fmtUsdVal(row.pv_Inspect)}</span>
                        </div>
                      )}
                      {strategyName !== 'Baseline DCA' && (
                        <div className="mt-1 border-t border-slate-700/60 pt-1">
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color: baseColor }}>Baseline cash:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{fmtUsdVal(row.cashUsd_Baseline)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color: '#a78bfa' }}>Baseline BTC:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{fmtUsdVal(row.btcUsd_Baseline)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Brush dataKey="ts" height={22} stroke="#60a5fa" fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
              <Area
                yAxisId="usd"
                type="monotone"
                dataKey="cashUsd_Inspect"
                name="Cash"
                stackId="inspect"
                stroke="#94a3b8"
                strokeWidth={1}
                fill="url(#inspectCashFill)"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Area
                yAxisId="usd"
                type="monotone"
                dataKey="btcUsd_Inspect"
                name="BTC (USD)"
                stackId="inspect"
                stroke="#fbbf24"
                strokeWidth={1.2}
                fill="url(#inspectBtcFill)"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              {strategyName !== 'Baseline DCA' && (
                <>
                  <Line yAxisId="usd" type="monotone" dataKey="cashUsd_Baseline" name="Baseline cash" stroke={baseColor} strokeWidth={1.4} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                  <Line yAxisId="usd" type="monotone" dataKey="btcUsd_Baseline" name="Baseline BTC" stroke="#a78bfa" strokeWidth={1.4} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                </>
              )}
              <Line
                yAxisId="btc"
                type="monotone"
                dataKey="btc_Inspect"
                name="BTC held"
                stroke={color}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* CQM Risk (for CQM and LLI-on-risk) */}
      {(strategyName === 'CQM Risk DCA' || (strategyName === 'LLI+CQM DCA' && lliSeries === 'risk')) && wfRiskData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>CQM Risk (walk-forward)</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Causal risk that sizes trades{strategyName === 'LLI+CQM DCA' ? ' (and feeds the LLI filter)' : ''}.
            </Typography>
          </Box>
          <Box sx={{ height: { xs: 300, sm: 380 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={wfRiskData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="inspectWfRiskGrad" x1="0" y1="0" x2="0" y2="1">
                    {wfRiskGradientStops.map((s, i) => (
                      <stop key={i} offset={`${(s.offset * 100).toFixed(2)}%`} stopColor={s.color} />
                    ))}
                  </linearGradient>
                </defs>
                <ReferenceArea yAxisId="risk" y1={0} y2={25} fill="#22c55e" fillOpacity={0.16} strokeOpacity={0} />
                <ReferenceArea yAxisId="risk" y1={25} y2={50} fill="#84cc16" fillOpacity={0.14} strokeOpacity={0} />
                <ReferenceArea yAxisId="risk" y1={50} y2={75} fill="#f59e0b" fillOpacity={0.14} strokeOpacity={0} />
                <ReferenceArea yAxisId="risk" y1={75} y2={100} fill="#ef4444" fillOpacity={0.16} strokeOpacity={0} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="btc" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
                <YAxis yAxisId="risk" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')} />
                <ReferenceLine yAxisId="risk" y={50} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.2} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload ?? {};
                    return (
                      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                        <div className="flex items-center justify-between gap-8">
                          <span className="text-xs text-slate-300">Risk:</span>
                          <span className="text-xs font-mono font-bold text-slate-100">
                            {typeof row.riskPct === 'number' ? `${row.riskPct.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Brush dataKey="ts" height={22} stroke="#a855f7" fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
                <Line yAxisId="btc" type="monotone" dataKey="btcPrice" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.4} dot={false} isAnimationActive={false} opacity={0.45} />
                <Line yAxisId="risk" type="monotone" dataKey="riskPct" name="CQM Risk %" stroke="url(#inspectWfRiskGrad)" strokeWidth={2.6} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* LLI ribbon: underlying series + MAs with gold/blue/gray state shading */}
      {strategyName === 'LLI+CQM DCA' && lliRibbonChartData.length > 0 && lliSpans.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>LLI Filter</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {lliSeries === 'risk' ? 'Walk-forward CQM Risk' : 'BTC price'} with{' '}
              {lliMode === 'ribbon4'
                ? `${lliPeriods.join('/')}-day EMA ribbon`
                : `${lliFastPeriod}/${lliSlowPeriod} EMA + ${lliAtrMult}×ATR${lliAtrPeriod} band`}
              . Gold = run CQM · Blue = cash · Gray = hold.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            <Chip size="small" variant="outlined" label="Gold" sx={{ borderColor: '#eab308', color: '#fde047' }} />
            <Chip size="small" variant="outlined" label="Gray" sx={{ borderColor: '#64748b', color: '#94a3b8' }} />
            <Chip size="small" variant="outlined" label="Blue" sx={{ borderColor: '#6366f1', color: '#a5b4fc' }} />
            <Chip
              size="small"
              variant="outlined"
              label={lliSeries === 'risk' ? 'Series (Risk %)' : 'Series (BTC)'}
              sx={{ borderColor: '#e2e8f0', color: '#e2e8f0' }}
            />
            {lliMode === 'ribbon4' ? (
              <>
                <Chip size="small" variant="outlined" label={`EMA ${lliPeriods[0]}`} sx={{ borderColor: '#22d3ee', color: '#22d3ee' }} />
                <Chip size="small" variant="outlined" label={`EMA ${lliPeriods[1]}`} sx={{ borderColor: '#38bdf8', color: '#38bdf8' }} />
                <Chip size="small" variant="outlined" label={`EMA ${lliPeriods[2]}`} sx={{ borderColor: '#818cf8', color: '#818cf8' }} />
                <Chip size="small" variant="outlined" label={`EMA ${lliPeriods[3]}`} sx={{ borderColor: '#c084fc', color: '#c084fc' }} />
              </>
            ) : (
              <>
                <Chip size="small" variant="outlined" label={`EMA ${lliFastPeriod}`} sx={{ borderColor: '#22d3ee', color: '#22d3ee' }} />
                <Chip size="small" variant="outlined" label={`EMA ${lliSlowPeriod}`} sx={{ borderColor: '#c084fc', color: '#c084fc' }} />
                <Chip size="small" variant="outlined" label="ATR band" sx={{ borderColor: '#94a3b8', color: '#94a3b8' }} />
              </>
            )}
          </Stack>
          <Box sx={{ height: { xs: 320, sm: 420 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lliRibbonChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                {lliSpans.map((s, i) => {
                  const c = lliColor(s.state);
                  return (
                    <ReferenceArea
                      key={`lli-ribbon-${i}`}
                      yAxisId="series"
                      x1={s.x1}
                      x2={s.x2}
                      ifOverflow="hidden"
                      fill={c.fill}
                      fillOpacity={c.alpha}
                      strokeOpacity={0}
                    />
                  );
                })}
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="series"
                  scale={lliRibbonDomain.log ? 'log' : 'linear'}
                  domain={[lliRibbonDomain.y1, lliRibbonDomain.y2]}
                  allowDataOverflow
                  tick={{ fontSize: 10, fill: '#e2e8f0' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => {
                    if (typeof val !== 'number') return '';
                    if (lliSeries === 'risk') return `${val.toFixed(0)}%`;
                    return `$${Math.round(val).toLocaleString()}`;
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload ?? {};
                    const fmt = (v: unknown) => {
                      if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
                      return lliSeries === 'risk'
                        ? `${v.toFixed(2)}%`
                        : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                    };
                    return (
                      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                        <div className="flex items-center justify-between gap-8">
                          <span className="text-xs text-slate-300">LLI:</span>
                          <span className="text-xs font-mono font-bold text-slate-100">{String(row.lliState ?? '—')}</span>
                        </div>
                        <div className="flex items-center justify-between gap-8">
                          <span className="text-xs text-slate-300">{lliSeries === 'risk' ? 'Risk:' : 'BTC:'}</span>
                          <span className="text-xs font-mono font-bold text-slate-100">{fmt(row.series)}</span>
                        </div>
                        {lliMode === 'ribbon4' ? (
                          <>
                            <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#22d3ee' }}>EMA {lliPeriods[0]}:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.ema1)}</span></div>
                            <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#38bdf8' }}>EMA {lliPeriods[1]}:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.ema2)}</span></div>
                            <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#818cf8' }}>EMA {lliPeriods[2]}:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.ema3)}</span></div>
                            <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#c084fc' }}>EMA {lliPeriods[3]}:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.ema4)}</span></div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#22d3ee' }}>EMA {lliFastPeriod}:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.emaFast)}</span></div>
                            <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#c084fc' }}>EMA {lliSlowPeriod}:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.emaSlow)}</span></div>
                          </>
                        )}
                      </div>
                    );
                  }}
                />
                <Brush
                  dataKey="ts"
                  height={22}
                  stroke="#f59e0b"
                  fill="rgba(15, 23, 42, 0.92)"
                  travellerWidth={10}
                  tickFormatter={xTickFormatter}
                  startIndex={lliBrushIndices?.start ?? 0}
                  endIndex={lliBrushIndices?.end ?? Math.max(0, lliRibbonChartData.length - 1)}
                  onChange={(range: { startIndex?: number; endIndex?: number }) => {
                    if (range?.startIndex !== undefined && range?.endIndex !== undefined) {
                      setLliBrushIndices({ start: range.startIndex, end: range.endIndex });
                    }
                  }}
                />
                <Line yAxisId="series" type="monotone" dataKey="series" name={lliSeries === 'risk' ? 'CQM Risk' : 'BTC'} stroke="#e2e8f0" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                {lliMode === 'ribbon4' ? (
                  <>
                    <Line yAxisId="series" type="monotone" dataKey="ema1" name={`EMA ${lliPeriods[0]}`} stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    <Line yAxisId="series" type="monotone" dataKey="ema2" name={`EMA ${lliPeriods[1]}`} stroke="#38bdf8" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    <Line yAxisId="series" type="monotone" dataKey="ema3" name={`EMA ${lliPeriods[2]}`} stroke="#818cf8" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    <Line yAxisId="series" type="monotone" dataKey="ema4" name={`EMA ${lliPeriods[3]}`} stroke="#c084fc" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  </>
                ) : (
                  <>
                    <Line yAxisId="series" type="monotone" dataKey="atrBandUpper" name="ATR upper" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls opacity={0.7} />
                    <Line yAxisId="series" type="monotone" dataKey="atrBandLower" name="ATR lower" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls opacity={0.7} />
                    <Line yAxisId="series" type="monotone" dataKey="emaFast" name={`EMA ${lliFastPeriod}`} stroke="#22d3ee" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
                    <Line yAxisId="series" type="monotone" dataKey="emaSlow" name={`EMA ${lliSlowPeriod}`} stroke="#c084fc" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* CryptoTrend ribbon: price + jaw/lips SMMAs + neutral band, state shading */}
      {strategyName === 'CryptoTrend DCA' && ctChartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>CryptoTrend Signal</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              BTC price with SMMA {cryptoTrendParams.jawLength} (jaw) and SMMA {cryptoTrendParams.lipsLength} (lips).
              Neutral band around the jaw:{' '}
              {cryptoTrendParams.bandMode === 'pct'
                ? `±${(cryptoTrendParams.pct * 100).toFixed(1)}%`
                : `±${cryptoTrendParams.atrMult}×ATR${cryptoTrendParams.atrPeriod}`}
              . Yellow = buy · Purple = cash · Orange = hold.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
            <Chip size="small" variant="outlined" label="Up" sx={{ borderColor: '#CCCC00', color: '#e5e56b' }} />
            <Chip size="small" variant="outlined" label="Neutral" sx={{ borderColor: '#DB6600', color: '#fb923c' }} />
            <Chip size="small" variant="outlined" label="Down" sx={{ borderColor: '#5D3FD3', color: '#a594f9' }} />
            <Chip size="small" variant="outlined" label={`Jaw ${cryptoTrendParams.jawLength}`} sx={{ borderColor: '#c084fc', color: '#c084fc' }} />
            <Chip size="small" variant="outlined" label={`Lips ${cryptoTrendParams.lipsLength}`} sx={{ borderColor: '#22d3ee', color: '#22d3ee' }} />
            <Chip size="small" variant="outlined" label="Neutral band" sx={{ borderColor: '#94a3b8', color: '#94a3b8' }} />
          </Stack>
          <Box sx={{ height: { xs: 320, sm: 420 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ctChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                {ctSpans.map((s, i) => {
                  const c = cryptoTrendColor(s.state);
                  return (
                    <ReferenceArea
                      key={`ct-ribbon-${i}`}
                      yAxisId="price"
                      x1={s.x1}
                      x2={s.x2}
                      ifOverflow="hidden"
                      fill={c.fill}
                      fillOpacity={c.alpha}
                      strokeOpacity={0}
                    />
                  );
                })}
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="price" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload ?? {};
                    const fmt = (v: unknown) =>
                      typeof v === 'number' && Number.isFinite(v)
                        ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : '—';
                    return (
                      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                        <div className="flex items-center justify-between gap-8">
                          <span className="text-xs text-slate-300">Trend:</span>
                          <span className="text-xs font-mono font-bold" style={{ color: cryptoTrendColor(row.state as CryptoTrendState).fill }}>{String(row.state ?? '—')}</span>
                        </div>
                        <div className="flex items-center justify-between gap-8"><span className="text-xs text-slate-300">BTC:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.price)}</span></div>
                        <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#c084fc' }}>Jaw:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.jaw)}</span></div>
                        <div className="flex items-center justify-between gap-8"><span className="text-xs" style={{ color: '#22d3ee' }}>Lips:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.lips)}</span></div>
                        {typeof row.jaw === 'number' && typeof row.lips === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs text-slate-300">Jaw ÷ Lips:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{(row.jaw / row.lips).toFixed(4)}</span>
                          </div>
                        )}
                        {cryptoTrendParams.bandMode === 'atr' && (
                          <div className="flex items-center justify-between gap-8"><span className="text-xs text-slate-300">ATR:</span><span className="text-xs font-mono font-bold text-slate-100">{fmt(row.atr)}</span></div>
                        )}
                      </div>
                    );
                  }}
                />
                <Brush dataKey="ts" height={22} stroke="#e879f9" fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
                <Line yAxisId="price" type="monotone" dataKey="price" name="BTC" stroke="#e2e8f0" strokeWidth={1.4} dot={false} isAnimationActive={false} opacity={0.55} />
                <Line yAxisId="price" type="monotone" dataKey="bandUpper" name="Band upper" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls opacity={0.7} />
                <Line yAxisId="price" type="monotone" dataKey="bandLower" name="Band lower" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls opacity={0.7} />
                <Line yAxisId="price" type="monotone" dataKey="jaw" name={`Jaw ${cryptoTrendParams.jawLength}`} stroke="#c084fc" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="price" type="monotone" dataKey="lips" name={`Lips ${cryptoTrendParams.lipsLength}`} stroke="#22d3ee" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* EMA Trend overlay */}
      {strategyName === 'EMA Trend DCA' && emaChartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>EMA Trend Signal</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {emaFastPeriod}/{emaSlowPeriod}-day EMAs and target BTC weight (0–100%).
            </Typography>
          </Box>
          <Box sx={{ height: { xs: 320, sm: 400 }, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={emaChartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2a44" />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xTickFormatter} tickCount={tickCount} minTickGap={24} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="price" scale="log" domain={[btcDomain.y1, btcDomain.y2]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')} />
                <YAxis yAxisId="w" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#2dd4bf' }} axisLine={false} tickLine={false} tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')} />
                <ReferenceLine yAxisId="w" y={50} stroke="#94a3b8" strokeDasharray="4 3" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload ?? {};
                    return (
                      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
                        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
                        {typeof row.targetWeight === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs" style={{ color: '#2dd4bf' }}>Target BTC:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">{row.targetWeight.toFixed(1)}%</span>
                          </div>
                        )}
                        {typeof row.btcPrice === 'number' && (
                          <div className="flex items-center justify-between gap-8">
                            <span className="text-xs text-slate-300">BTC:</span>
                            <span className="text-xs font-mono font-bold text-slate-100">
                              ${row.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Brush dataKey="ts" height={22} stroke="#2dd4bf" fill="rgba(15, 23, 42, 0.92)" travellerWidth={10} tickFormatter={xTickFormatter} />
                <Line yAxisId="price" type="monotone" dataKey="btcPrice" name="BTC" stroke="#fbbf24" strokeWidth={1.4} dot={false} isAnimationActive={false} opacity={0.5} />
                <Line yAxisId="price" type="monotone" dataKey="emaFast" name={`EMA ${emaFastPeriod}`} stroke="#2dd4bf" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                <Line yAxisId="price" type="monotone" dataKey="emaSlow" name={`EMA ${emaSlowPeriod}`} stroke="#0d9488" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                <Line yAxisId="w" type="monotone" dataKey="targetWeight" name="Target BTC %" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {tradesTable}
    </Box>
  );
};

export default LabInspectView;
