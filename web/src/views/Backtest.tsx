import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Brush, ReferenceArea, ReferenceLine,
} from 'recharts';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { SignalData } from '../App';
import {
  runBacktest, BacktestConfig, StrategyResult, DcaFrequency, OffSignalMode, Trade,
} from '../services/backtest';
import {
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../utils/cqmSizing';
import { buildWalkForwardRiskMap } from '../utils/cqmWalkForward';
import { fitCQM, riskForPriceFairProjected } from '../utils/cqm';
import { generateForwardPrices } from '../utils/cqmForwardSim';
import { usePersistentState } from '../utils/usePersistentState';
import { buildRiskGradientStops } from '../utils/cqmRiskGradient';
import ChartsView from './ChartsView';
import { format } from 'date-fns';
import { FlaskConical, TrendingUp, Coins, BarChart3, ShieldAlert, DollarSign, ArrowDownToLine, Wallet, Download, ArrowUpDown } from 'lucide-react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputAdornment,
  Link as MuiLink,
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
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

export type BacktestVariant = 'core-macro' | 'cqm';

interface Props {
  data: SignalData[];
  /**
   * When set, the simulator is locked to a single model's strategies and the
   * irrelevant controls are hidden. Undefined = the full cross-model Lab.
   */
  variant?: BacktestVariant;
}

type RangeKey = 'all' | '5y' | '4y' | '3y' | '2y' | '1y' | 'custom';

const ALL_START_DATE = '2013-01-01';
// Furthest the CQM simulator will project synthetic future prices (end of the
// next ~4-year cycle: lows 2026 / 2030 / 2034).
const FUTURE_MAX_DATE = '2034-12-31';

const STRATEGY_COLORS: Record<string, string> = {
  'Baseline DCA': '#94a3b8',
  'CORE DCA': '#60a5fa',
  'CORE DCA + MACRO 3x': '#22c55e',
  'CQM Risk DCA': '#a855f7',
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

// CQM Risk shading: split [0,1] into the same 4 bands used on the CQM Risk
// chart (cool / warm / hot / euphoric) and shade the chart background by the
// per-day risk value over time.
type RiskBand = 0 | 1 | 2 | 3;
type RiskSpan = { x1: number; x2: number; band: RiskBand };

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

function buildRiskSpans(
  rows: Array<{ ts: number; date: string }>,
  riskByDate: Map<string, number>,
): RiskSpan[] {
  const spans: RiskSpan[] = [];
  if (!rows.length || riskByDate.size === 0) return spans;

  let current: RiskBand | null = null;
  let startTs: number | null = null;
  // ts of the previous row that carried a finite risk value.
  let prevTs: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const r = riskByDate.get(rows[i].date);
    const ts = rows[i].ts;
    if (!Number.isFinite(r)) continue;
    const b = riskBand(r as number);

    if (current === null) {
      current = b;
      startTs = ts;
      prevTs = ts;
      continue;
    }

    if (b !== current && startTs !== null && prevTs !== null) {
      // Split the gap at the midpoint of the transition so the previous band
      // ends exactly where the next one begins — adjacent colored areas are
      // juxtaposed with no unshaded seam between them.
      const boundary = (prevTs + ts) / 2;
      if (boundary > startTs) spans.push({ x1: startTs, x2: boundary, band: current });
      current = b;
      startTs = boundary;
    }

    prevTs = ts;
  }

  if (current !== null && startTs !== null && prevTs !== null) {
    if (prevTs > startTs) spans.push({ x1: startTs, x2: prevTs, band: current });
  }

  return spans;
}

const Backtest: React.FC<Props> = ({ data, variant }) => {
  // Optional URL overrides take priority over persisted state (and are written
  // back to it). When absent, the persisted value (or default) is used.
  //   ?start-date=YYYY-MM-DD   → simulation start date
  //   ?end-date=YYYY-MM-DD     → simulation end date (defaults to today)
  //   ?dca-amount=100          → base DCA amount (USD)
  //   ?dca-frequency=daily     → daily | weekly | monthly
  const [searchParams] = useSearchParams();
  const startDateParam = searchParams.get('start-date');
  const endDateParam = searchParams.get('end-date');
  const dcaAmountParam = searchParams.get('dca-amount');
  const dcaFrequencyParam = searchParams.get('dca-frequency');

  const startDateOverride = useMemo<string | undefined>(() => {
    if (!startDateParam || !/^\d{4}-\d{2}-\d{2}$/.test(startDateParam)) return undefined;
    return startDateParam < ALL_START_DATE ? ALL_START_DATE : startDateParam;
  }, [startDateParam]);
  // A start-date in the URL implies a custom range.
  const rangeOverride = startDateOverride !== undefined ? ('custom' as RangeKey) : undefined;
  const endDateOverride = useMemo<string | undefined>(
    () => (endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam) ? endDateParam : undefined),
    [endDateParam],
  );
  const dcaAmountOverride = useMemo<number | undefined>(() => {
    if (dcaAmountParam === null) return undefined;
    const v = parseFloat(dcaAmountParam);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }, [dcaAmountParam]);
  const frequencyOverride = useMemo<DcaFrequency | undefined>(() => {
    const v = (dcaFrequencyParam ?? '').toLowerCase();
    return v === 'daily' || v === 'weekly' || v === 'monthly' ? (v as DcaFrequency) : undefined;
  }, [dcaFrequencyParam]);

  // Form parameters are persisted to localStorage per simulator variant so a
  // page refresh keeps the same simulation setup.
  const ps = `cqm-backtest:${variant ?? 'lab'}`;
  const [range, setRange] = usePersistentState<RangeKey>(`${ps}:range`, '5y', rangeOverride);
  const [customDate, setCustomDate] = usePersistentState<string>(`${ps}:customDate`, ALL_START_DATE, startDateOverride);
  // End of the simulation window. Empty string = "today" (last available date).
  const [customEndDate, setCustomEndDate] = usePersistentState<string>(`${ps}:customEndDate`, '', endDateOverride);
  // CQM defaults to a daily $100 base DCA; other variants/Lab keep weekly.
  const [frequency, setFrequency] = usePersistentState<DcaFrequency>(`${ps}:frequency`, () => (variant === 'cqm' ? 'daily' : 'weekly'), frequencyOverride);
  const [dcaAmount, setDcaAmount] = usePersistentState<number>(`${ps}:dcaAmount`, 100, dcaAmountOverride);

  const [offSignalMode, setOffSignalMode] = usePersistentState<OffSignalMode>(`${ps}:offSignalMode`, 'pause');
  const [macroAccel, setMacroAccel] = usePersistentState<boolean>(`${ps}:macroAccel`, true);
  const [cqmDca, setCqmDca] = usePersistentState<boolean>(`${ps}:cqmDca`, false);
  // Tuned dynamic sizing knobs (6% cash-frac @ R=0, sell above 75%).
  const [cqmMaxCashFraction, setCqmMaxCashFraction] = usePersistentState<number>(`${ps}:cqmMaxCashFraction`, CQM_DEFAULT_MAX_CASH_FRACTION);
  const [cqmSellThreshold, setCqmSellThreshold] = usePersistentState<number>(`${ps}:cqmSellThreshold`, CQM_DEFAULT_SELL_THRESHOLD);
  // Legacy flat reserve-scaling (Lab only). When enabled, disables dynamic sizing.
  const [cqmTradeFraction, setCqmTradeFraction] = usePersistentState<number>(`${ps}:cqmTradeFraction`, 0.01);
  const [cqmFractionEnabled, setCqmFractionEnabled] = usePersistentState<boolean>(`${ps}:cqmFractionEnabled`, false);
  const [cqmRiskByDate, setCqmRiskByDate] = useState<Map<string, number>>(new Map());
  const [cqmRiskLoading, setCqmRiskLoading] = useState(false);
  const [cqmRiskProgress, setCqmRiskProgress] = useState(0); // 0..1
  // Annual yield on idle cash (APY %), accrued daily across all strategies.
  const [cashYieldPct, setCashYieldPct] = usePersistentState<number>(`${ps}:cashYieldPct`, 0);
  // CQM Risk chart: 'walkforward' = the causal risk that drives the sim;
  // 'lookback' = the full-sample fit shown on models/cqm/charts (hindsight).
  const [riskChartMode, setRiskChartMode] = usePersistentState<'walkforward' | 'lookback'>(`${ps}:riskChartMode`, 'walkforward');
  // Seed for the forward price simulation. "Re-roll" bumps it for a new path.
  // Persisted so a refresh keeps the same simulated future path.
  const [forwardSeed, setForwardSeed] = usePersistentState<number>(`${ps}:forwardSeed`, () => (Math.random() * 0x7fffffff) >>> 0);

  // --- Per-model variant -------------------------------------------------
  // Locks the simulator to a single model's strategies and hides the
  // controls that don't apply to it. Undefined = the cross-model Lab.
  const isLab = !variant;
  const isCore = variant === 'core-macro';
  const isCqm = variant === 'cqm';
  // Effective config flags after applying the variant's locks.
  const effMacroAccel = isCqm ? false : macroAccel;
  const effCqmDca = isCqm ? true : isCore ? false : cqmDca;
  const effCqmDynamicSizing = isCqm || !cqmFractionEnabled;
  const effCqmTradeFraction = cqmFractionEnabled ? cqmTradeFraction : 0;

  // --- CoinStrat Quantile Model (CQM) -------------------------------------
  // Walk-forward risk: causal expanding-window refits (no look-ahead).
  // First run can take ~1 minute on the full BTC history.
  const cqmPricePoints = useMemo(() => {
    if (!effCqmDca || !data.length) return [];
    const points: { date: string; ts: number; price: number }[] = [];
    for (const d of data) {
      const price = Number((d as { BTCUSD?: number }).BTCUSD);
      if (!Number.isFinite(price) || price <= 0) continue;
      const ts = new Date(d.Date).getTime();
      if (!Number.isFinite(ts)) continue;
      points.push({ date: d.Date, ts, price });
    }
    return points;
  }, [data, effCqmDca]);

  useEffect(() => {
    if (!effCqmDca || cqmPricePoints.length < 365) {
      setCqmRiskByDate(new Map());
      setCqmRiskLoading(false);
      setCqmRiskProgress(0);
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;
    let fallbackTimer = 0;

    setCqmRiskLoading(true);
    setCqmRiskProgress(0);

    const finish = (map: Map<string, number>) => {
      if (cancelled) return;
      setCqmRiskByDate(map);
      setCqmRiskLoading(false);
      setCqmRiskProgress(1);
    };

    // The expanding-window refits take ~1–2 minutes on full history, so prefer
    // the server-side precomputed map (identical for everyone, refreshed daily).
    // Fall back to an in-browser Web Worker — or a main-thread compute if
    // workers are unavailable — when the cache can't be reached.
    const runLocalCompute = () => {
      try {
        worker = new Worker(
          new URL('../workers/cqmWalkForwardWorker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch {
        worker = null;
      }

      if (worker) {
        worker.onmessage = (event) => {
          if (cancelled) return;
          const msg = event.data as
            | { type: 'progress'; done: number; total: number }
            | { type: 'result'; entries: Array<[string, number]> }
            | { type: 'error'; message: string };
          if (msg.type === 'progress') {
            setCqmRiskProgress(msg.total > 0 ? msg.done / msg.total : 0);
          } else if (msg.type === 'result') {
            finish(new Map(msg.entries));
          } else {
            console.warn('CQM walk-forward worker failed:', msg.message);
            finish(new Map());
          }
        };
        worker.onerror = (err) => {
          console.warn('CQM walk-forward worker error:', err.message);
          finish(new Map());
        };
        worker.postMessage({ points: cqmPricePoints });
      } else {
        fallbackTimer = window.setTimeout(() => {
          try {
            finish(buildWalkForwardRiskMap(cqmPricePoints));
          } catch (err) {
            console.warn('CQM walk-forward risk failed:', err);
            finish(new Map());
          }
        }, 0);
      }
    };

    (async () => {
      try {
        const res = await fetch('/api/v1/signals/cqm-walkforward');
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          if (cancelled) return;
          const entries: Array<{ date?: string; risk?: number }> = Array.isArray(json?.data)
            ? json.data
            : [];
          if (entries.length > 0) {
            const map = new Map<string, number>();
            for (const e of entries) {
              const r = Number(e.risk);
              if (e.date && Number.isFinite(r)) map.set(e.date, r);
            }
            if (map.size > 0) {
              finish(map);
              return;
            }
          }
        }
      } catch {
        // Precomputed map unavailable (offline / not yet seeded) — compute locally.
      }
      if (!cancelled) runLocalCompute();
    })();

    return () => {
      cancelled = true;
      worker?.terminate();
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
  }, [cqmPricePoints, effCqmDca]);

  // Last day of real BTC history ("today" for the simulator).
  const lastHistoryDate = useMemo(
    () => (data.length ? data[data.length - 1].Date : ''),
    [data],
  );

  // End of the simulation window. Defaults to the last available date ("today").
  // The CQM tab may run into the future (up to FUTURE_MAX_DATE) by simulating
  // synthetic prices; other variants stay clamped to available history.
  const endDate = useMemo(() => {
    const last = lastHistoryDate;
    if (!last) return customEndDate;
    if (customEndDate && /^\d{4}-\d{2}-\d{2}$/.test(customEndDate)) {
      const cap = isCqm ? FUTURE_MAX_DATE : last;
      if (customEndDate > cap) return cap;
      if (customEndDate < ALL_START_DATE) return ALL_START_DATE;
      return customEndDate;
    }
    return last;
  }, [lastHistoryDate, customEndDate, isCqm]);

  // --- Forward (future) price simulation ---------------------------------
  // When the CQM tab's end date runs past the last real day, generate a
  // semi-random but model-consistent BTC path: a halving-cycle drift along the
  // QR-50% median, OU volatility that diminishes into the future, all squashed
  // to stay strictly inside the projected 0.1% / 99.9% QR fan.
  const isFuture = isCqm && !!lastHistoryDate && endDate > lastHistoryDate;

  const forwardSim = useMemo(() => {
    if (!isFuture) return null;
    const hist: { date: string; ts: number; price: number }[] = [];
    for (const d of data) {
      const price = Number((d as { BTCUSD?: number }).BTCUSD);
      if (!Number.isFinite(price) || price <= 0) continue;
      const ts = new Date(d.Date).getTime();
      if (!Number.isFinite(ts)) continue;
      hist.push({ date: d.Date, ts, price });
    }
    if (hist.length < 365) return null;
    try {
      const fit = fitCQM(hist);
      const points = generateForwardPrices(fit, { endDate, seed: forwardSeed });
      return points.length > 0 ? { fit, points } : null;
    } catch (err) {
      console.warn('CQM forward simulation failed:', err);
      return null;
    }
  }, [isFuture, data, endDate, forwardSeed]);

  // History plus the synthetic future tail, used for the backtest and charts.
  const simData = useMemo<SignalData[]>(() => {
    if (!forwardSim) return data;
    const extra = forwardSim.points.map(
      (p) => ({ Date: p.date, BTCUSD: p.price }) as unknown as SignalData,
    );
    return [...data, ...extra];
  }, [data, forwardSim]);

  // Causal risk for the synthetic future days (frozen residual distribution +
  // projected median). Merged onto the historical walk-forward risk map.
  const forwardRiskByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (!forwardSim) return map;
    for (const p of forwardSim.points) {
      const r = riskForPriceFairProjected(forwardSim.fit, p.ts, p.price);
      if (Number.isFinite(r)) map.set(p.date, Math.max(0, Math.min(1, r)));
    }
    return map;
  }, [forwardSim]);

  const effectiveRiskByDate = useMemo(() => {
    if (forwardRiskByDate.size === 0) return cqmRiskByDate;
    const merged = new Map(cqmRiskByDate);
    for (const [date, risk] of forwardRiskByDate) merged.set(date, risk);
    return merged;
  }, [cqmRiskByDate, forwardRiskByDate]);

  // Timestamps bounding the simulated future region, for chart shading.
  const projectedSpan = useMemo(() => {
    if (!isFuture || !lastHistoryDate) return null;
    const x1 = new Date(lastHistoryDate).getTime();
    const x2 = new Date(endDate).getTime();
    return Number.isFinite(x1) && Number.isFinite(x2) && x2 > x1 ? { x1, x2 } : null;
  }, [isFuture, lastHistoryDate, endDate]);

  // Compute start date from range selection or custom date. Presets are anchored
  // to the (possibly past) end date so "5Y" means the 5 years before endDate.
  const startDate = useMemo(() => {
    if (!data.length) return ALL_START_DATE;
    if (range === 'custom') return customDate;
    if (range === 'all') return ALL_START_DATE;
    const end = new Date(endDate || data[data.length - 1].Date);
    const years = range === '5y' ? 5 : range === '4y' ? 4 : range === '3y' ? 3 : range === '2y' ? 2 : 1;
    const start = new Date(
      Date.UTC(end.getUTCFullYear() - years, end.getUTCMonth(), end.getUTCDate())
    );
    return start.toISOString().split('T')[0];
  }, [data, range, customDate, endDate]);

  // Strategies to surface for the active variant (Lab shows everything).
  const allowedStrategies = useMemo<Set<string> | null>(() => {
    if (isCore) return new Set(['Baseline DCA', 'CORE DCA', 'CORE DCA + MACRO 3x']);
    if (isCqm) return new Set(['Baseline DCA', 'CQM Risk DCA']);
    return null;
  }, [isCore, isCqm]);

  // Run backtest
  const results = useMemo<StrategyResult[]>(() => {
    if (!simData.length) return [];
    const config: BacktestConfig = {
      startDate,
      endDate,
      dcaAmount,
      frequency,
      offSignalMode,
      macroAccel: effMacroAccel,
      accelMultiplier: 3,
      cqmDca: effCqmDca && effectiveRiskByDate.size > 0 && !cqmRiskLoading,
      cqmRiskByDate: effectiveRiskByDate.size > 0 ? effectiveRiskByDate : undefined,
      cqmDynamicSizing: effCqmDynamicSizing,
      cqmMaxCashFraction,
      cqmSellThreshold,
      cqmTradeFraction: effCqmTradeFraction,
      cashAnnualYieldPct: cashYieldPct,
    };
    const all = runBacktest(simData, config);
    return allowedStrategies ? all.filter((r) => allowedStrategies.has(r.name)) : all;
  }, [
    simData, startDate, endDate, dcaAmount, frequency, offSignalMode, effMacroAccel,
    effCqmDca, effectiveRiskByDate, cqmRiskLoading, effCqmDynamicSizing, cqmMaxCashFraction,
    cqmSellThreshold, effCqmTradeFraction, cashYieldPct, allowedStrategies,
  ]);

  // For the CQM tab's tested-vs-baseline comparison tiles.
  const cqmResult = useMemo(() => results.find((r) => r.name === 'CQM Risk DCA'), [results]);
  const baselineResult = useMemo(() => results.find((r) => r.name === 'Baseline DCA'), [results]);

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

    // Merge per-day CQM Risk (0..1) so tooltips can surface it (history + future).
    if (effectiveRiskByDate.size > 0) {
      for (const [date, risk] of effectiveRiskByDate) {
        const entry = dateMap.get(date);
        if (entry) entry.cqmRisk = risk;
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
  }, [results, data, effectiveRiskByDate]);

  const systemSpans = useMemo(() => buildSystemSpans(chartData), [chartData]);

  // CQM variant shades the background by per-day CQM Risk instead of the
  // CORE/MACRO regime (which is irrelevant to the CQM model).
  const riskSpans = useMemo(
    () => (isCqm ? buildRiskSpans(chartData, effectiveRiskByDate) : []),
    [isCqm, chartData, effectiveRiskByDate],
  );
  const useRiskShading = isCqm && riskSpans.length > 0;

  // Per-day walk-forward risk series (the exact values driving the sim),
  // windowed to the simulation interval, for the CQM Risk chart. Rendered as a
  // single line whose stroke is a continuous green→red gradient mapped to the
  // risk value (see wfRiskGradientStops).
  const wfRiskData = useMemo(() => {
    return chartData
      .filter((d: any) => Number.isFinite(d.cqmRisk))
      .map((d: any) => ({
        ts: d.ts,
        fullDate: d.fullDate,
        riskPct: (d.cqmRisk as number) * 100,
        btcPrice: d.btcPrice,
      }));
  }, [chartData]);

  // Gradient stops for the walk-forward risk line, derived from its min/max so
  // the green→red colours track true risk values (SVG gradients map to the path
  // bounding box, not the 0–100 axis).
  const wfRiskGradientStops = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of wfRiskData) {
      const v = Number(d.riskPct);
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return buildRiskGradientStops(lo, hi);
  }, [wfRiskData]);

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

  const RiskTooltipRow = ({ payload }: { payload: any }) => {
    const risk = payload?.[0]?.payload?.cqmRisk;
    if (!isCqm || typeof risk !== 'number') return null;
    const c = riskColor(riskBand(risk));
    return (
      <div className="mt-1 flex items-center justify-between gap-8 border-t border-slate-700/60 pt-1">
        <span className="text-xs text-slate-300" style={{ color: c.fill }}>CQM Risk:</span>
        <span className="text-xs font-mono font-bold text-slate-100">{(risk * 100).toFixed(1)}%</span>
      </div>
    );
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
            <RiskTooltipRow payload={payload} />
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
            <RiskTooltipRow payload={payload} />
          </div>
        </div>
      );
    }
    return null;
  };

  const WfRiskTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload ?? {};
    const risk = typeof row.riskPct === 'number' ? row.riskPct : null;
    const c = risk != null ? riskColor(riskBand(risk / 100)) : { fill: '#a855f7' };
    return (
      <div className="rounded-lg border border-slate-700/60 bg-slate-950/90 p-4 shadow-xl">
        <p className="mb-2 font-bold text-slate-100">{row.fullDate}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-8">
            <span className="text-xs" style={{ color: c.fill }}>Walk-forward Risk:</span>
            <span className="text-xs font-mono font-bold text-slate-100">
              {risk != null ? `${risk.toFixed(1)}%` : '—'}
            </span>
          </div>
          {typeof row.btcPrice === 'number' && (
            <div className="flex items-center justify-between gap-8">
              <span className="text-xs text-slate-300">BTCUSD:</span>
              <span className="text-xs font-mono font-bold text-slate-100">
                ${row.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
        </div>
      </div>
    );
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
      <Box sx={{ pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <FlaskConical className="h-8 w-8 text-blue-400" />
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
            {isCore ? 'CORE / MACRO Backtest' : isCqm ? 'CQM Backtest' : 'Backtest'}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {isCore
            ? 'How CORE accumulation (with the optional MACRO 3× accelerator) would have performed versus a plain baseline DCA.'
            : isCqm
            ? 'CQM Risk DCA deposits the same base amount as Baseline each period, then sizes trades dynamically from walk-forward Risk (no look-ahead): it deploys a risk-scaled fraction of its cash pile when Risk is low, holds between 50% and the sell threshold, and trims BTC above it. Sells are capped by holdings.'
            : 'Compare how different DCA strategies would have performed using CoinStrat signals over historical data.'}
        </Typography>
        {!isLab && (
          <MuiLink component={RouterLink} to="/lab" sx={{ display: 'inline-block', mt: 1, fontSize: 13, fontWeight: 700 }}>
            Compare all models in the Lab →
          </MuiLink>
        )}
      </Box>

      {/* Controls */}
      <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Grid container spacing={2} alignItems="flex-start">
          {/* Time Range Presets */}
          <Grid item xs={12} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                Time Range
              </Typography>
              <Stack direction="row" alignItems="flex-start" spacing={1} useFlexGap flexWrap="wrap" rowGap={1}>
                <ToggleButtonGroup
                  color="primary"
                  exclusive
                  value={range === 'custom' ? null : range}
                  onChange={(_, next) => {
                    if (next) setRange(next);
                  }}
                  size="small"
                  sx={{ flexWrap: 'wrap' }}
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
                    max: endDate || (data.length ? data[data.length - 1].Date : undefined),
                  }}
                  sx={{ width: 155 }}
                />
                <TextField
                  type="date"
                  size="small"
                  label="End Date"
                  value={endDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{
                    min: startDate,
                    max: isCqm ? FUTURE_MAX_DATE : (lastHistoryDate || undefined),
                  }}
                  helperText={isCqm ? `Up to ${FUTURE_MAX_DATE} simulates the future` : undefined}
                  FormHelperTextProps={{ sx: { fontSize: '0.6rem', m: 0, mt: 0.25 } }}
                  sx={{ width: 155 }}
                />
                {isCqm && isFuture && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<ArrowUpDown size={14} />}
                    onClick={() => setForwardSeed((s) => (s * 1664525 + 1013904223) >>> 0)}
                    sx={{ whiteSpace: 'nowrap', height: 40 }}
                  >
                    Re-roll
                  </Button>
                )}
              </Stack>
              {isCqm && isFuture && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', maxWidth: 520 }}>
                  Prices after {lastHistoryDate} are a semi-random simulation — a halving-cycle
                  path with diminishing volatility, kept inside the model&apos;s 0.1%–99.9% quantile
                  band. Illustrative only, not a forecast. Press Re-roll for another scenario.
                </Typography>
              )}
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
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                DCA Amount
              </Typography>
              <TextField
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
                sx={{ width: { xs: '100%', sm: 120 } }}
              />
            </Stack>
          </Grid>

          {/* Cash yield on idle USD (applies to every strategy's cash balance) */}
          <Grid item xs={6} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                Cash APY
              </Typography>
              <TextField
                type="number"
                size="small"
                value={cashYieldPct}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0 && v <= 20) setCashYieldPct(v);
                }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                }}
                inputProps={{ step: 0.5, min: 0, max: 20 }}
                sx={{ width: { xs: '100%', sm: 110 } }}
                title="Annual yield earned on idle cash (accrued daily). Set to a T-bill rate (e.g. 4%) so cash-holding strategies aren't unfairly penalized."
              />
            </Stack>
          </Grid>

          {/* Off-Signal Mode (CORE-based strategies only) */}
          {!isCqm && (
          <Grid item xs={6} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                When Signal OFF
              </Typography>
              <FormControl size="small" sx={{ minWidth: 160, width: { xs: '100%', sm: 160 } }}>
                <Select
                  value={offSignalMode}
                  onChange={(e) => setOffSignalMode(e.target.value as OffSignalMode)}
                >
                  <MenuItem value="pause">Pause Buys</MenuItem>
                  <MenuItem value="sell_matching">Sell Matching</MenuItem>
                  <MenuItem value="sell_all">Sell All</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Grid>
          )}

          {/* MACRO 3x Toggle (CORE-based strategies only) */}
          {!isCqm && (
          <Grid item xs={6} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" aria-hidden sx={{ fontSize: '0.65rem', visibility: 'hidden', userSelect: 'none' }}>
                .
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ height: 40 }}>
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
            </Stack>
          </Grid>
          )}

          {/* CQM Risk DCA Toggle (Lab only — locked on in the CQM model tab) */}
          {isLab && (
          <Grid item xs={6} sm="auto">
            <Stack spacing={0.5}>
              <Typography variant="overline" aria-hidden sx={{ fontSize: '0.65rem', visibility: 'hidden', userSelect: 'none' }}>
                .
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ height: 40 }}>
              <Switch
                checked={cqmDca}
                onChange={(_, checked) => setCqmDca(checked)}
                size="small"
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': { color: '#a855f7' },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: '#a855f7',
                  },
                }}
              />
              <Typography
                variant="body2"
                sx={{ fontWeight: 700 }}
                title="CoinStrat Quantile Model — Risk-Weighted DCA: size = max(base, fraction × cash) on BUYs, max(base, fraction × btc_value) on SELLs; trade = size × (1 − 2 × Risk)"
              >
                CQM Risk DCA
              </Typography>
              </Stack>
            </Stack>
          </Grid>
          )}

          {/* CQM dynamic sizing knobs (tuned defaults; walk-forward risk) */}
          {effCqmDca && effCqmDynamicSizing && (
            <Grid item xs={12}>
              <Stack spacing={0.5}>
                <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                  CQM Dynamic Sizing
                </Typography>
                <Stack direction="row" alignItems="center" spacing={2} useFlexGap flexWrap="wrap">
                  <Stack direction="row" alignItems="center" spacing={0.5} useFlexGap flexWrap="wrap">
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                      Cash deploy @ R=0:
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      value={cqmMaxCashFraction}
                      onChange={(_, next) => {
                        if (typeof next === 'number') setCqmMaxCashFraction(next);
                      }}
                      size="small"
                      sx={{
                        flexWrap: 'wrap',
                        '& .MuiToggleButton-root.Mui-selected': {
                          color: '#a855f7',
                          borderColor: '#a855f7',
                          backgroundColor: 'rgba(168, 85, 247, 0.12)',
                        },
                      }}
                    >
                      <ToggleButton value={0.04}>4%</ToggleButton>
                      <ToggleButton value={0.05}>5%</ToggleButton>
                      <ToggleButton value={0.06}>6%</ToggleButton>
                      <ToggleButton value={0.07}>7%</ToggleButton>
                      <ToggleButton value={0.08}>8%</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  <Stack direction="row" alignItems="center" spacing={0.5} useFlexGap flexWrap="wrap">
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                      Sell above:
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      value={cqmSellThreshold}
                      onChange={(_, next) => {
                        if (typeof next === 'number') setCqmSellThreshold(next);
                      }}
                      size="small"
                      sx={{
                        flexWrap: 'wrap',
                        '& .MuiToggleButton-root.Mui-selected': {
                          color: '#a855f7',
                          borderColor: '#a855f7',
                          backgroundColor: 'rgba(168, 85, 247, 0.12)',
                        },
                      }}
                    >
                      <ToggleButton value={0.65}>65%</ToggleButton>
                      <ToggleButton value={0.70}>70%</ToggleButton>
                      <ToggleButton value={0.75}>75%</ToggleButton>
                      <ToggleButton value={0.80}>80%</ToggleButton>
                      <ToggleButton value={1}>Buy-only</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  {cqmRiskLoading && (
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <CircularProgress size={14} sx={{ color: '#a855f7' }} />
                      <Typography variant="caption" color="text.secondary">
                        Computing walk-forward risk… {Math.round(cqmRiskProgress * 100)}%
                      </Typography>
                    </Stack>
                  )}
                </Stack>
              </Stack>
            </Grid>
          )}

          {/* Legacy flat reserve-scaling (Lab only) */}
          {effCqmDca && !isCqm && (
            <Grid item xs={12} sm="auto">
              <Stack spacing={0.5}>
                <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                  Legacy Flat Fraction
                </Typography>
                <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap">
                  <Switch
                    checked={cqmFractionEnabled}
                    onChange={(_, checked) => setCqmFractionEnabled(checked)}
                    size="small"
                    sx={{
                      '& .MuiSwitch-switchBase.Mui-checked': { color: '#a855f7' },
                      '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                        backgroundColor: '#a855f7',
                      },
                    }}
                  />
                  {cqmFractionEnabled ? (
                    <ToggleButtonGroup
                      exclusive
                      value={cqmTradeFraction}
                      onChange={(_, next) => {
                        if (typeof next === 'number') setCqmTradeFraction(next);
                      }}
                      size="small"
                      sx={{
                        flexWrap: 'wrap',
                        '& .MuiToggleButton-root.Mui-selected': {
                          color: '#a855f7',
                          borderColor: '#a855f7',
                          backgroundColor: 'rgba(168, 85, 247, 0.12)',
                        },
                        '& .MuiToggleButton-root.Mui-selected:hover': {
                          backgroundColor: 'rgba(168, 85, 247, 0.18)',
                        },
                      }}
                    >
                      <ToggleButton value={0.01}>1%</ToggleButton>
                      <ToggleButton value={0.02}>2%</ToggleButton>
                      <ToggleButton value={0.03}>3%</ToggleButton>
                      <ToggleButton value={0.04}>4%</ToggleButton>
                      <ToggleButton value={0.05}>5%</ToggleButton>
                      <ToggleButton value={0.20}>20%</ToggleButton>
                      <ToggleButton value={0.25}>25%</ToggleButton>
                      <ToggleButton value={0.50}>50%</ToggleButton>
                      <ToggleButton value={0.75}>75%</ToggleButton>
                      <ToggleButton value={1.00}>100%</ToggleButton>
                    </ToggleButtonGroup>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Off — dynamic sizing (risk-scaled cash deploy + dead-zone sells)
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Summary — CQM tab uses comparison tiles (tested vs baseline); other
          variants keep the per-strategy cards. */}
      {cqmRiskLoading && isCqm ? (
        <Paper sx={{ p: 3, mb: 2, textAlign: 'center' }}>
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={1.5}>
            <CircularProgress size={22} sx={{ color: '#a855f7' }} />
            <Typography variant="body2" color="text.secondary">
              Computing walk-forward CQM risk…
              {' '}{Math.round(cqmRiskProgress * 100)}%
            </Typography>
          </Stack>
        </Paper>
      ) : results.length > 0 && (
        isCqm && cqmResult && baselineResult ? (
          <ComparisonTiles cqm={cqmResult} baseline={baselineResult} />
        ) : (
        <Grid container spacing={2}>
          {results.map((r) => {
            const color = STRATEGY_COLORS[r.name] ?? '#94a3b8';
            // 2 strategies → md=6; 3 → md=4; 4 → md=3 (1 row of 4 on desktop, 2x2 on tablet)
            const colSize = results.length >= 4 ? 3 : results.length === 3 ? 4 : 6;
            return (
              <Grid item xs={12} sm={6} md={colSize} key={r.name}>
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
                          value={`-${(r.maxReturnDrawdown * 100).toFixed(1)}%`}
                          tone="negative"
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<TrendingUp className="h-4 w-4" style={{ color }} />}
                          label="IRR (annualized)"
                          value={fmtPctOrNa(r.annualizedIrr * 100)}
                          tone={r.annualizedIrr >= 0 ? 'positive' : 'negative'}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <MetricBox
                          icon={<BarChart3 className="h-4 w-4" style={{ color }} />}
                          label="Return / Max DD"
                          value={Number.isFinite(r.returnOverMaxDrawdown) ? r.returnOverMaxDrawdown.toFixed(2) : 'n/a'}
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
        )
      )}

      {/* Chart 1: Portfolio Value */}
      {chartData.length > 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Portfolio Value
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {isCqm ? (
                <>
                  CQM Risk DCA uses walk-forward risk (no look-ahead) and
                  dynamic sizing: deploy up to {(cqmMaxCashFraction * 100).toFixed(0)}% of the cash pile per
                  period when Risk is low (tapering to 0 at 50%), hold in the dead zone (50%–{(cqmSellThreshold * 100).toFixed(0)}%),
                  {cqmSellThreshold >= 1
                    ? ' and never sell (buy-only).'
                    : ` and sell above ${(cqmSellThreshold * 100).toFixed(0)}% risk.`}
                  {' '}All strategies receive the same DCA deposits for a fair comparison.
                </>
              ) : (
                <>
                  Total portfolio value (BTC holdings at market price + cash reserves) for each strategy.
                  All strategies receive the same DCA deposits; CoinStrat holds cash as dry powder when CORE is OFF and deploys reserves on re-entry.
                  Max Drawdown is measured on portfolio value relative to cumulative deposits (not raw portfolio value, which ongoing deposits can inflate).
                  {effCqmDca && effCqmDynamicSizing && (
                    <> CQM Risk DCA uses dynamic sizing with walk-forward risk (see knobs above).</>
                  )}
                  {effCqmDca && !effCqmDynamicSizing && cqmFractionEnabled && (
                    <> CQM Risk DCA uses legacy flat fraction scaling.</>
                  )}
                </>
              )}
              {' '}{isCqm
                ? (useRiskShading
                    ? 'Background shading shows the daily walk-forward CQM Risk band: green (cool, <25%) → lime (warm, 25–50%) → amber (hot, 50–75%) → red (euphoric, >75%).'
                    : 'Background risk shading appears once the walk-forward risk finishes computing.')
                : 'Background shading shows the CoinStrat system state (CORE = accumulation permission; MACRO = 3× intensity modifier).'}
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
                {isCqm
                  ? riskSpans.map((s, i) => {
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
                    })
                  : systemSpans.map((s, i) => {
                      const c = systemColor(s.value);
                      return (
                        <ReferenceArea
                          key={`sys-${i}-${s.x1}`}
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
                {isCqm && (
                  <ReferenceLine yAxisId="pv" y={0} stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={1} />
                )}
                {projectedSpan && (
                  <ReferenceLine
                    yAxisId="pv"
                    x={projectedSpan.x1}
                    stroke="#a855f7"
                    strokeDasharray="5 4"
                    strokeWidth={1.2}
                    label={{ value: 'simulated →', position: 'insideTopRight', fill: '#c4b5fd', fontSize: 10 }}
                  />
                )}
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
                {renderChartBrush()}
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
              BTC Holdings
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {isCqm
                ? 'BTC position over time. CQM DCA accumulates when Risk is low and trims above the sell threshold; sells are capped by holdings.'
                : 'Cumulative BTC accumulated by each strategy over the backtest period.'}
              {isCqm && (useRiskShading
                ? ' Background shading shows the daily walk-forward CQM Risk band.'
                : ' Background risk shading appears once the walk-forward risk finishes computing.')}
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
                {isCqm
                  ? riskSpans.map((s, i) => {
                      const c = riskColor(s.band);
                      return (
                        <ReferenceArea
                          key={`btc-risk-${i}-${s.x1}`}
                          yAxisId="btcHoldings"
                          x1={s.x1}
                          x2={s.x2}
                          ifOverflow="hidden"
                          fill={c.fill}
                          fillOpacity={c.alpha}
                          strokeOpacity={0}
                        />
                      );
                    })
                  : systemSpans.map((s, i) => {
                      const c = systemColor(s.value);
                      return (
                        <ReferenceArea
                          key={`btc-sys-${i}-${s.x1}`}
                          yAxisId="btcHoldings"
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
                {isCqm && (
                  <ReferenceLine yAxisId="btcHoldings" y={0} stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={1} />
                )}
                {projectedSpan && (
                  <ReferenceLine
                    yAxisId="btcHoldings"
                    x={projectedSpan.x1}
                    stroke="#a855f7"
                    strokeDasharray="5 4"
                    strokeWidth={1.2}
                    label={{ value: 'simulated →', position: 'insideTopRight', fill: '#c4b5fd', fontSize: 10 }}
                  />
                )}
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
                {renderChartBrush()}
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

      {/* CQM Risk chart (CQM variant only). Toggle between the walk-forward
          risk that actually drives the simulation (causal, no look-ahead) and
          the full-sample "lookback" fit shown on models/cqm/charts (hindsight).
          Both are windowed to the simulation interval for easy comparison. */}
      {isCqm && (
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="flex-end"
            spacing={1}
            sx={{ mb: 1 }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              Risk model
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={riskChartMode}
              onChange={(_e, v) => v && setRiskChartMode(v)}
            >
              <ToggleButton value="walkforward" sx={{ textTransform: 'none', py: 0.25 }}>
                Walk-forward
              </ToggleButton>
              <ToggleButton value="lookback" sx={{ textTransform: 'none', py: 0.25 }}>
                Lookback
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {riskChartMode === 'lookback' ? (
            <ChartsView data={data} sections={['cqm-risk']} embedded showRange={false} startDate={startDate} endDate={endDate} />
          ) : (
            <Paper sx={{ p: { xs: 2, sm: 3 } }}>
              <Box sx={{ mb: 2.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  CQM Risk (walk-forward)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  The model is refit on past data only (no look-ahead), so these are the exact daily
                  Risk values that drive the simulation above — what a live bot could have known at
                  the time. Switch to “Lookback” to compare against the full-sample fit.
                </Typography>
              </Box>

              {cqmRiskLoading ? (
                <Stack direction="row" alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 8 }}>
                  <CircularProgress size={22} sx={{ color: '#a855f7' }} />
                  <Typography variant="body2" color="text.secondary">
                    Computing walk-forward CQM risk… {Math.round(cqmRiskProgress * 100)}%
                  </Typography>
                </Stack>
              ) : wfRiskData.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                  Enable CQM Risk DCA to compute the walk-forward risk series.
                </Typography>
              ) : (
                <>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                    <Chip size="small" variant="outlined" label="0–25% Buy zone" sx={{ borderColor: '#22c55e', color: '#bbf7d0' }} />
                    <Chip size="small" variant="outlined" label="25–50% Accumulate" sx={{ borderColor: '#84cc16', color: '#d9f99d' }} />
                    <Chip size="small" variant="outlined" label="50–75% Trim" sx={{ borderColor: '#f59e0b', color: '#fde68a' }} />
                    <Chip size="small" variant="outlined" label="75–100% Sell zone" sx={{ borderColor: '#ef4444', color: '#fecaca' }} />
                    <Chip size="small" variant="outlined" label="BTCUSD (log)" sx={{ borderColor: '#e5e7eb', color: '#e5e7eb' }} />
                  </Stack>

                  <Box sx={{ height: { xs: 340, sm: 420 }, width: '100%', minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={wfRiskData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                        <defs>
                          <linearGradient id="wfRiskLineGradient" x1="0" y1="0" x2="0" y2="1">
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
                          domain={[btcDomain.y1, btcDomain.y2]}
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(val) => (typeof val === 'number' ? `$${Math.round(val).toLocaleString()}` : '')}
                        />
                        <YAxis
                          yAxisId="risk"
                          orientation="right"
                          domain={[0, 100]}
                          tick={{ fontSize: 10, fill: '#94a3b8' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}%` : '')}
                        />
                        <ReferenceLine yAxisId="risk" y={50} stroke="#94a3b8" strokeDasharray="6 3" strokeWidth={1.2} />
                        {projectedSpan && (
                          <ReferenceLine
                            yAxisId="risk"
                            x={projectedSpan.x1}
                            stroke="#a855f7"
                            strokeDasharray="5 4"
                            strokeWidth={1.2}
                            label={{ value: 'simulated →', position: 'insideTopRight', fill: '#c4b5fd', fontSize: 10 }}
                          />
                        )}
                        <Tooltip content={<WfRiskTooltip />} />
                        {renderChartBrush()}
                        <Line yAxisId="btc" type="monotone" dataKey="btcPrice" name="BTCUSD" stroke="#e5e7eb" strokeWidth={1.4} dot={false} isAnimationActive={false} opacity={0.45} />
                        <Line yAxisId="risk" type="monotone" dataKey="riskPct" name="CQM Risk %" stroke="url(#wfRiskLineGradient)" strokeWidth={2.6} dot={false} isAnimationActive={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                </>
              )}
            </Paper>
          )}
        </Box>
      )}

      {/* Comparison Table — redundant on the CQM tab (covered by the tiles). */}
      {results.length > 0 && !isCqm && (
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
                <CompRow label="Max Drawdown" values={results.map(r => `-${(r.maxReturnDrawdown * 100).toFixed(1)}%`)} />
                <CompRow label="Max DD (portfolio)" values={results.map(r => `-${(r.maxDrawdown * 100).toFixed(1)}%`)} />
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Trade log — every executed buy/sell for the CQM strategy. */}
      {isCqm && cqmResult && cqmResult.trades.length > 0 && (
        <TradesTable trades={cqmResult.trades} strategyName={cqmResult.name} />
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

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

// --- Trade log ---

function fmtUsdExact(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  const sign = x < 0 ? '-' : '';
  return `${sign}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Rounded USD (no decimals) for the on-screen trade log — these amounts are
// large and the cents add noise. The CSV keeps full precision.
function fmtUsdRound(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  const sign = x < 0 ? '-' : '';
  return `${sign}$${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function buildTradesCsv(trades: Trade[]): string {
  const header = [
    'date',
    'side',
    'btc_amount',
    'usd_amount',
    'btc_price',
    'total_btc_held',
    'total_usd_held',
    'total_portfolio_value',
  ];
  const rows = trades.map((t) => [
    t.date,
    t.side,
    t.btcAmount.toFixed(8),
    t.usdAmount.toFixed(2),
    t.price.toFixed(2),
    t.btcHeld.toFixed(8),
    t.cashBalance.toFixed(2),
    t.portfolioValue.toFixed(2),
  ]);
  return [header, ...rows].map((r) => r.join(',')).join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Paginated, sortable trade log with CSV export. Trades are stored chronologically
// by the engine; here we sort a shallow copy and slice the active page.
function TradesTable({ trades, strategyName }: { trades: Trade[]; strategyName: string }) {
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const sorted = useMemo(() => {
    const copy = trades.slice();
    copy.sort((a, b) => (order === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    return copy;
  }, [trades, order]);

  const pageRows = useMemo(
    () => sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sorted, page, rowsPerPage],
  );

  const toggleOrder = () => {
    setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    setPage(0);
  };

  const handleDownload = () => {
    // CSV always exports the full set in chronological (ascending) order.
    const chronological = trades.slice().sort((a, b) => a.date.localeCompare(b.date));
    downloadCsv(`${strategyName.replace(/\s+/g, '_').toLowerCase()}_trades.csv`, buildTradesCsv(chronological));
  };

  const cellSx = { fontFamily: MONO, whiteSpace: 'nowrap' as const };

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Trade Log
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {trades.length.toLocaleString()} executed {trades.length === 1 ? 'trade' : 'trades'} for {strategyName}.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ArrowUpDown className="h-4 w-4" />}
            onClick={toggleOrder}
          >
            {order === 'desc' ? 'Newest first' : 'Oldest first'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download className="h-4 w-4" />}
            onClick={handleDownload}
          >
            CSV
          </Button>
        </Stack>
      </Stack>

      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 900 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Side</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>Amount (BTC)</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>Value (USD)</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>BTC Price</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>BTC Held</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>USD Held</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>Portfolio Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((t, i) => {
              const isBuy = t.side === 'buy';
              return (
                <TableRow hover key={`${t.date}-${i}-${t.side}`}>
                  <TableCell sx={cellSx}>{t.date}</TableCell>
                  <TableCell>
                    <Chip
                      label={isBuy ? 'Buy' : 'Sell'}
                      size="small"
                      sx={{
                        fontWeight: 800,
                        height: 20,
                        color: isBuy ? '#16a34a' : '#dc2626',
                        bgcolor: isBuy ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                      }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={cellSx}>{t.btcAmount.toFixed(6)}</TableCell>
                  <TableCell align="right" sx={cellSx}>{fmtUsdExact(t.usdAmount)}</TableCell>
                  <TableCell align="right" sx={cellSx}>{fmtUsdRound(t.price)}</TableCell>
                  <TableCell align="right" sx={{ ...cellSx, color: t.btcHeld < 0 ? 'error.main' : 'text.primary' }}>
                    {t.btcHeld.toFixed(6)}
                  </TableCell>
                  <TableCell align="right" sx={cellSx}>{fmtUsdRound(t.cashBalance)}</TableCell>
                  <TableCell align="right" sx={cellSx}>{fmtUsdRound(t.portfolioValue)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={sorted.length}
        page={page}
        onPageChange={(_e, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[25, 50, 100, 250, 500]}
      />
    </Paper>
  );
}

interface TileSpec {
  label: string;
  primary: string;
  tone?: 'positive' | 'negative';
  baseline?: string;
  note?: string;
}

// CQM-tab summary: one tile per metric. The big centred value is the tested
// strategy (CQM Risk DCA); a small muted value underneath is Baseline DCA for
// reference. Percentages are coloured green/red by sign.
function ComparisonTiles({ cqm, baseline }: { cqm: StrategyResult; baseline: StrategyResult }) {
  const cqmColor = STRATEGY_COLORS['CQM Risk DCA'] ?? '#a855f7';
  const baseColor = STRATEGY_COLORS['Baseline DCA'] ?? '#94a3b8';

  const tiles: TileSpec[] = [
    {
      label: 'Total Return',
      primary: fmtPct(cqm.totalReturn * 100),
      tone: cqm.totalReturn >= 0 ? 'positive' : 'negative',
      baseline: fmtPct(baseline.totalReturn * 100),
    },
    {
      label: 'IRR (annualized)',
      primary: fmtPctOrNa(cqm.annualizedIrr * 100),
      tone: cqm.annualizedIrr >= 0 ? 'positive' : 'negative',
      baseline: fmtPctOrNa(baseline.annualizedIrr * 100),
    },
    {
      label: 'Max Drawdown',
      primary: `-${(cqm.maxReturnDrawdown * 100).toFixed(1)}%`,
      tone: 'negative',
      baseline: `-${(baseline.maxReturnDrawdown * 100).toFixed(1)}%`,
    },
    {
      label: 'Return / Max DD',
      primary: Number.isFinite(cqm.returnOverMaxDrawdown) ? cqm.returnOverMaxDrawdown.toFixed(2) : 'n/a',
      baseline: Number.isFinite(baseline.returnOverMaxDrawdown) ? baseline.returnOverMaxDrawdown.toFixed(2) : 'n/a',
    },
    {
      label: 'Total Invested',
      primary: fmtUsd(cqm.totalInvested),
      note: 'Same for both (equal funding)',
    },
    {
      label: 'Final Value',
      primary: fmtUsd(cqm.finalPortfolioValue),
      baseline: fmtUsd(baseline.finalPortfolioValue),
    },

    {
      label: 'BTC Position',
      primary: cqm.btcAccumulated.toFixed(4),
      baseline: baseline.btcAccumulated.toFixed(4),
    },
    {
      label: 'Cash Balance',
      primary: fmtUsd(cqm.finalCashBalance),
      baseline: fmtUsd(baseline.finalCashBalance),
    },
    {
      label: 'Avg Idle Cash',
      primary: fmtUsd(cqm.avgCashBalance),
      baseline: fmtUsd(baseline.avgCashBalance),
    },
  ];

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          CQM Risk DCA vs Baseline DCA
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cqmColor }} />
            <Typography variant="caption" color="text.secondary">CQM Risk DCA (tested)</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: baseColor }} />
            <Typography variant="caption" color="text.secondary">Simple DCA (benchmark)</Typography>
          </Stack>
        </Stack>
      </Box>
      <Grid container spacing={1.5}>
        {tiles.map((t) => (
          <Grid item xs={6} sm={4} md={2} key={t.label}>
            <ComparisonTile spec={t} baselineColor={baseColor} />
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}

function ComparisonTile({ spec, baselineColor }: { spec: TileSpec; baselineColor: string }) {
  const { label, primary, tone, baseline, note } = spec;
  const color = tone === 'positive' ? 'success.main' : tone === 'negative' ? 'error.main' : 'text.primary';
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 1.5,
        height: '100%',
        minHeight: 128,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        bgcolor: 'rgba(2,6,23,0.10)',
      }}
    >
      <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.6rem', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 900, fontFamily: MONO, fontSize: '1.5rem', color, my: 'auto', py: 0.5 }}>
        {primary}
      </Typography>
      {baseline !== undefined ? (
        <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center">
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: baselineColor, flexShrink: 0 }} />
          <Typography variant="caption" color="text.secondary">Baseline</Typography>
          <Typography variant="caption" sx={{ fontFamily: MONO, fontWeight: 700, color: baselineColor }}>
            {baseline}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
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

function fmtPctOrNa(x: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
}

export default Backtest;
