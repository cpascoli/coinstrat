import type { SignalRow } from './compute';
import {
  STRATEGY_SERIES_CATALOG,
  assertNever,
  describeComparator,
  type StrategyComparator,
  type StrategyConditionDefinition,
  type StrategyMetricDefinition,
  type StrategyPreviewTrace,
  type StrategyMetricTimeframe,
  type StrategyPreviewResult,
  type StrategyPreviewRow,
  type StrategySnapshotRow,
  type StrategySeriesKey,
  type StrategySpec,
} from '../../../src/lib/strategyBuilder';

type NumericSeries = number[];
type BooleanSeries = boolean[];
type NumericRef = {
  values: NumericSeries;
  updates: BooleanSeries;
  timeframe: StrategyMetricTimeframe;
};

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

function rsi(values: NumericSeries, length: number): NumericSeries {
  const result: NumericSeries = values.map(() => Number.NaN);
  if (values.length <= length) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= length; i += 1) {
    const current = values[i];
    const previous = values[i - 1];
    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      return result;
    }
    const delta = current - previous;
    gainSum += Math.max(delta, 0);
    lossSum += Math.max(-delta, 0);
  }

  let avgGain = gainSum / length;
  let avgLoss = lossSum / length;
  result[length] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = length + 1; i < values.length; i += 1) {
    const current = values[i];
    const previous = values[i - 1];
    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      result[i] = Number.NaN;
      continue;
    }
    const delta = current - previous;
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    avgGain = ((avgGain * (length - 1)) + gain) / length;
    avgLoss = ((avgLoss * (length - 1)) + loss) / length;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return result;
}

function stochRsi(values: NumericSeries, length: number, stochWindow: number): NumericSeries {
  const rsiValues = rsi(values, length);
  const result: NumericSeries = rsiValues.map(() => Number.NaN);

  for (let i = 0; i < rsiValues.length; i += 1) {
    if (i < stochWindow - 1 || !Number.isFinite(rsiValues[i])) {
      continue;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let valid = true;
    for (let j = i - stochWindow + 1; j <= i; j += 1) {
      if (!Number.isFinite(rsiValues[j])) {
        valid = false;
        break;
      }
      min = Math.min(min, rsiValues[j]);
      max = Math.max(max, rsiValues[j]);
    }

    if (!valid || max === min) {
      result[i] = Number.NaN;
      continue;
    }

    result[i] = ((rsiValues[i] - min) / (max - min)) * 100;
  }

  return result;
}

function timeframeKey(date: string, timeframe: StrategyMetricTimeframe): string {
  if (timeframe === 'day') return date;

  const dt = new Date(`${date}T00:00:00Z`);
  if (timeframe === 'month') {
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  const weekEnd = new Date(dt);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + ((7 - weekEnd.getUTCDay()) % 7));
  return weekEnd.toISOString().slice(0, 10);
}

function applyMetricOperator(values: NumericSeries, metric: StrategyMetricDefinition): NumericSeries {
  switch (metric.operator) {
    case 'identity':
      return [...values];
    case 'rolling_mean':
      return rollingMean(values, metric.window ?? 2);
    case 'rolling_min':
      return rollingMin(values, metric.window ?? 2);
    case 'rolling_max':
      return rollingMax(values, metric.window ?? 2);
    case 'pct_change':
      return pctChange(values, metric.periods ?? 1, metric.scale ?? 'ratio');
    case 'diff':
      return diff(values, metric.periods ?? 1);
    case 'rsi':
      return rsi(values, metric.length ?? 14);
    case 'stoch_rsi':
      return stochRsi(values, metric.length ?? 14, metric.stochWindow ?? 14);
    default:
      return assertNever(metric.operator);
  }
}

function applyTimeframeMetric(
  values: NumericSeries,
  rows: SignalRow[],
  metric: StrategyMetricDefinition,
): NumericRef {
  const timeframe = metric.timeframe ?? 'day';
  if (timeframe === 'day') {
    return {
      values: applyMetricOperator(values, metric),
      updates: values.map(() => true),
      timeframe,
    };
  }

  const periodEndIndices: number[] = [];
  const compactInput: NumericSeries = [];
  for (let i = 0; i < rows.length; i += 1) {
    const currentKey = timeframeKey(rows[i].Date, timeframe);
    const nextKey = i < rows.length - 1 ? timeframeKey(rows[i + 1].Date, timeframe) : null;
    if (nextKey !== currentKey) {
      periodEndIndices.push(i);
      compactInput.push(values[i]);
    }
  }

  const compactOutput = applyMetricOperator(compactInput, metric);
  const expanded: NumericSeries = [];
  const updates: BooleanSeries = [];
  let compactIndex = 0;
  let lastValue = Number.NaN;

  for (let i = 0; i < rows.length; i += 1) {
    let updated = false;
    if (compactIndex < periodEndIndices.length && i === periodEndIndices[compactIndex]) {
      const nextValue = compactOutput[compactIndex];
      if (Number.isFinite(nextValue)) {
        lastValue = nextValue;
        updated = true;
      }
      compactIndex += 1;
    }
    expanded.push(lastValue);
    updates.push(updated);
  }

  return { values: expanded, updates, timeframe };
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

function formatSnapshotValue(value: number | boolean | null): string {
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4).replace(/\.?0+$/, '');
  }
  return 'n/a';
}

function normalizeTraceValues(values: NumericSeries): Array<number | null> {
  return values.map((value) => (Number.isFinite(value) ? value : null));
}

function buildSourceSeries(rows: SignalRow[], seriesKey: StrategySeriesKey): NumericRef {
  return {
    values: rows.map((row) => normalizeNumber(row[seriesKey])),
    updates: rows.map(() => true),
    timeframe: 'day',
  };
}

function buildMetricSeries(
  metric: StrategyMetricDefinition,
  refs: Map<string, NumericRef>,
  rows: SignalRow[],
) : NumericRef {
  const input = refs.get(metric.input);
  if (!input) throw new Error(`Unknown metric input ${metric.input}.`);
  return applyTimeframeMetric(input.values, rows, metric);
}

function buildConditionSeries(condition: StrategyConditionDefinition, refs: Map<string, NumericRef>): BooleanSeries {
  const leftRef = refs.get(condition.left);
  if (!leftRef) throw new Error(`Unknown condition left operand ${condition.left}.`);

  const rightSeries = condition.rightType === 'constant'
    ? leftRef.values.map(() => condition.rightConstant ?? Number.NaN)
    : refs.get(condition.rightRef ?? '')?.values;

  if (!rightSeries) {
    throw new Error(`Unknown condition right operand for ${condition.id}.`);
  }

  const rawSeries = leftRef.values.map((left, index) => {
    const previousLeft = index > 0 ? leftRef.values[index - 1] : Number.NaN;
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
  const refs = new Map<string, NumericRef>();

  for (const source of spec.sources) {
    refs.set(source.id, buildSourceSeries(rows, source.seriesKey));
  }

  for (const metric of spec.metrics) {
    refs.set(metric.id, buildMetricSeries(metric, refs, rows));
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
  const snapshot: StrategySnapshotRow[] = [];

  for (const source of spec.sources) {
    const series = refs.get(source.id) ?? { values: [], updates: [], timeframe: 'day' as const };
    const latestValue = series.values.length > 0 ? series.values[series.values.length - 1] : Number.NaN;
    const normalized = Number.isFinite(latestValue) ? latestValue : null;
    snapshot.push({
      kind: 'source',
      id: source.id,
      label: source.label,
      reference: source.seriesKey,
      currentValue: normalized,
      displayValue: formatSnapshotValue(normalized),
    });
  }

  for (const metric of spec.metrics) {
    const series = refs.get(metric.id) ?? { values: [], updates: [], timeframe: 'day' as const };
    const latestValue = series.values.length > 0 ? series.values[series.values.length - 1] : Number.NaN;
    const normalized = Number.isFinite(latestValue) ? latestValue : null;
    snapshot.push({
      kind: 'metric',
      id: metric.id,
      label: metric.label,
      reference: metric.operator,
      currentValue: normalized,
      displayValue: formatSnapshotValue(normalized),
    });
  }

  for (const condition of spec.conditions) {
    const series = conditionSeries.get(condition.id) ?? [];
    const latestValue = Boolean(series[series.length - 1]);
    snapshot.push({
      kind: 'condition',
      id: condition.id,
      label: condition.label,
      reference: describeComparator(condition.comparator),
      currentValue: latestValue,
      displayValue: formatSnapshotValue(latestValue),
    });
  }

  snapshot.push({
    kind: 'output',
    id: 'output',
    label: spec.output.label,
    reference: spec.output.mode,
    currentValue: latestRow?.signal ?? 0,
    displayValue: (latestRow?.signal ?? 0) === 1 ? 'ON' : 'OFF',
  });

  const traces: StrategyPreviewTrace[] = [
    ...spec.sources.map((source) => {
      const series = refs.get(source.id) ?? { values: [], updates: [], timeframe: 'day' as const };
      return {
        kind: 'source' as const,
        id: source.id,
        label: source.label,
        reference: source.seriesKey,
        values: normalizeTraceValues(series.values),
      };
    }),
    ...spec.metrics.map((metric) => {
      const series = refs.get(metric.id) ?? { values: [], updates: [], timeframe: 'day' as const };
      return {
        kind: 'metric' as const,
        id: metric.id,
        label: metric.label,
        reference: metric.operator,
        values: normalizeTraceValues(series.values),
      };
    }),
    ...spec.conditions.map((condition) => {
      const series = conditionSeries.get(condition.id) ?? [];
      return {
        kind: 'condition' as const,
        id: condition.id,
        label: condition.label,
        reference: describeComparator(condition.comparator),
        values: series,
      };
    }),
    {
      kind: 'output' as const,
      id: 'output',
      label: spec.output.label,
      reference: spec.output.mode,
      values: signalSeries,
    },
  ];

  return {
    currentState: latestRow?.signal ?? 0,
    latestDate: latestRow?.Date ?? null,
    rows: previewRows,
    transitions,
    snapshot,
    traces,
    metrics: spec.metrics.map((metric) => {
      const series = refs.get(metric.id) ?? { values: [], updates: [], timeframe: 'day' as const };
      const latestValue = series.values.length > 0 ? series.values[series.values.length - 1] : Number.NaN;
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
