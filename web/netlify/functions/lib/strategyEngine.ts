import type { SignalRow } from './compute';
import {
  STRATEGY_SERIES_CATALOG,
  assertNever,
  describeComparator,
  type StrategyComparator,
  type StrategyConditionDefinition,
  type StrategyMetricDefinition,
  type StrategyPreviewResult,
  type StrategyPreviewRow,
  type StrategySeriesKey,
  type StrategySpec,
} from '../../../src/lib/strategyBuilder';

type NumericSeries = number[];
type BooleanSeries = boolean[];

function rollingMean(values: NumericSeries, window: number): NumericSeries {
  const result: NumericSeries = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < window - 1) {
      result.push(Number.NaN);
      continue;
    }
    let sum = 0;
    let valid = true;
    for (let j = i - window + 1; j <= i; j += 1) {
      if (!Number.isFinite(values[j])) {
        valid = false;
        break;
      }
      sum += values[j];
    }
    result.push(valid ? sum / window : Number.NaN);
  }
  return result;
}

function rollingMin(values: NumericSeries, window: number): NumericSeries {
  const result: NumericSeries = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < window - 1) {
      result.push(Number.NaN);
      continue;
    }
    let min = Number.POSITIVE_INFINITY;
    let valid = true;
    for (let j = i - window + 1; j <= i; j += 1) {
      if (!Number.isFinite(values[j])) {
        valid = false;
        break;
      }
      min = Math.min(min, values[j]);
    }
    result.push(valid ? min : Number.NaN);
  }
  return result;
}

function rollingMax(values: NumericSeries, window: number): NumericSeries {
  const result: NumericSeries = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < window - 1) {
      result.push(Number.NaN);
      continue;
    }
    let max = Number.NEGATIVE_INFINITY;
    let valid = true;
    for (let j = i - window + 1; j <= i; j += 1) {
      if (!Number.isFinite(values[j])) {
        valid = false;
        break;
      }
      max = Math.max(max, values[j]);
    }
    result.push(valid ? max : Number.NaN);
  }
  return result;
}

function pctChange(values: NumericSeries, periods: number, scale: 'ratio' | 'percent'): NumericSeries {
  const result: NumericSeries = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < periods || !Number.isFinite(values[i - periods]) || values[i - periods] === 0 || !Number.isFinite(values[i])) {
      result.push(Number.NaN);
      continue;
    }
    const ratio = (values[i] / values[i - periods]) - 1;
    result.push(scale === 'percent' ? ratio * 100 : ratio);
  }
  return result;
}

function diff(values: NumericSeries, periods: number): NumericSeries {
  const result: NumericSeries = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i < periods || !Number.isFinite(values[i]) || !Number.isFinite(values[i - periods])) {
      result.push(Number.NaN);
      continue;
    }
    result.push(values[i] - values[i - periods]);
  }
  return result;
}

function compareValues(comparator: StrategyComparator, previousLeft: number, left: number, previousRight: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (comparator) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'eq':
      return left === right;
    case 'crosses_above':
      return Number.isFinite(previousLeft) && Number.isFinite(previousRight) && previousLeft <= previousRight && left > right;
    case 'crosses_below':
      return Number.isFinite(previousLeft) && Number.isFinite(previousRight) && previousLeft >= previousRight && left < right;
    default:
      return assertNever(comparator);
  }
}

function applyPersistence(series: BooleanSeries, lookbackDays: number, minTrueDays: number): BooleanSeries {
  return series.map((value, index) => {
    if (!value) return false;
    const start = Math.max(0, index - lookbackDays + 1);
    let trueCount = 0;
    for (let i = start; i <= index; i += 1) {
      if (series[i]) trueCount += 1;
    }
    return trueCount >= minTrueDays;
  });
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function buildSourceSeries(rows: SignalRow[], seriesKey: StrategySeriesKey): NumericSeries {
  return rows.map((row) => normalizeNumber(row[seriesKey]));
}

function buildMetricSeries(metric: StrategyMetricDefinition, refs: Map<string, NumericSeries>): NumericSeries {
  const input = refs.get(metric.input);
  if (!input) throw new Error(`Unknown metric input ${metric.input}.`);

  switch (metric.operator) {
    case 'identity':
      return [...input];
    case 'rolling_mean':
      return rollingMean(input, metric.window ?? 2);
    case 'rolling_min':
      return rollingMin(input, metric.window ?? 2);
    case 'rolling_max':
      return rollingMax(input, metric.window ?? 2);
    case 'pct_change':
      return pctChange(input, metric.periods ?? 1, metric.scale ?? 'ratio');
    case 'diff':
      return diff(input, metric.periods ?? 1);
    default:
      return assertNever(metric.operator);
  }
}

function buildConditionSeries(condition: StrategyConditionDefinition, refs: Map<string, NumericSeries>): BooleanSeries {
  const leftSeries = refs.get(condition.left);
  if (!leftSeries) throw new Error(`Unknown condition left operand ${condition.left}.`);

  const rightSeries = condition.rightType === 'constant'
    ? leftSeries.map(() => condition.rightConstant ?? Number.NaN)
    : refs.get(condition.rightRef ?? '');

  if (!rightSeries) {
    throw new Error(`Unknown condition right operand for ${condition.id}.`);
  }

  const rawSeries = leftSeries.map((left, index) => {
    const previousLeft = index > 0 ? leftSeries[index - 1] : Number.NaN;
    const right = rightSeries[index];
    const previousRight = index > 0 ? rightSeries[index - 1] : Number.NaN;
    return compareValues(condition.comparator, previousLeft, left, previousRight, right);
  });

  if (condition.lookbackDays && condition.minTrueDays) {
    return applyPersistence(rawSeries, condition.lookbackDays, condition.minTrueDays);
  }
  return rawSeries;
}

export function evaluateStrategy(rows: SignalRow[], spec: StrategySpec): StrategyPreviewResult {
  const refs = new Map<string, NumericSeries>();

  for (const source of spec.sources) {
    refs.set(source.id, buildSourceSeries(rows, source.seriesKey));
  }

  for (const metric of spec.metrics) {
    refs.set(metric.id, buildMetricSeries(metric, refs));
  }

  const conditionSeries = new Map<string, BooleanSeries>();
  for (const condition of spec.conditions) {
    conditionSeries.set(condition.id, buildConditionSeries(condition, refs));
  }

  const outputConditionSeries = spec.output.conditionIds.map((conditionId) => {
    const series = conditionSeries.get(conditionId);
    if (!series) throw new Error(`Missing condition series ${conditionId}.`);
    return series;
  });

  const signalSeries = rows.map((_, index) => {
    const values = outputConditionSeries.map((series) => series[index]);
    const signal = spec.output.mode === 'all'
      ? values.every(Boolean)
      : values.some(Boolean);
    return signal ? 1 : 0;
  });

  const previewRows: StrategyPreviewRow[] = rows.map((row, index) => ({
    Date: row.Date,
    BTCUSD: normalizeNumber(row.BTCUSD),
    signal: signalSeries[index],
  }));

  const transitions = previewRows.flatMap((row, index) => {
    if (index === 0) return [];
    const previous = previewRows[index - 1].signal;
    if (previous === row.signal) return [];
    return [{
      Date: row.Date,
      previous,
      next: row.signal,
    }];
  });

  const activeDays = signalSeries.filter((value) => value === 1).length;
  const latestRow = previewRows[previewRows.length - 1];

  return {
    currentState: latestRow?.signal ?? 0,
    latestDate: latestRow?.Date ?? null,
    rows: previewRows,
    transitions,
    metrics: spec.metrics.map((metric) => {
      const series = refs.get(metric.id) ?? [];
      const latestValue = series.length > 0 ? series[series.length - 1] : Number.NaN;
      return {
        id: metric.id,
        label: metric.label,
        latestValue: Number.isFinite(latestValue) ? latestValue : null,
      };
    }),
    conditions: spec.conditions.map((condition) => {
      const series = conditionSeries.get(condition.id) ?? [];
      return {
        id: condition.id,
        label: `${condition.label} (${describeComparator(condition.comparator)})`,
        latestValue: Boolean(series[series.length - 1]),
      };
    }),
    summary: {
      activeDays,
      inactiveDays: Math.max(0, signalSeries.length - activeDays),
      transitionCount: transitions.length,
    },
  };
}

export function buildStrategyRegistry() {
  return {
    series: STRATEGY_SERIES_CATALOG,
  };
}
