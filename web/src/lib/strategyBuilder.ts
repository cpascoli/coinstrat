export const STRATEGY_SERIES_CATALOG = [
  { key: 'BTCUSD', label: 'BTC Price (USD)', kind: 'raw', group: 'market', description: 'Daily BTC spot price in USD.' },
  { key: 'MVRV', label: 'MVRV', kind: 'raw', group: 'valuation', description: 'BTC market value to realized value ratio.' },
  { key: 'LTH_SOPR', label: 'LTH SOPR', kind: 'raw', group: 'valuation', description: 'Long-term holder SOPR.' },
  { key: 'NUPL', label: 'NUPL', kind: 'raw', group: 'valuation', description: 'Net unrealized profit/loss.' },
  { key: 'SIP', label: 'Supply In Profit', kind: 'raw', group: 'valuation', description: 'Supply in profit percentage.' },
  { key: 'DXY', label: 'DXY', kind: 'raw', group: 'macro', description: 'US Dollar Index.' },
  { key: 'SAHM', label: 'Sahm Rule', kind: 'raw', group: 'macro', description: 'Realtime Sahm Rule value.' },
  { key: 'YC_M', label: 'Yield Curve', kind: 'raw', group: 'macro', description: '10Y minus 3M Treasury spread.' },
  { key: 'NO', label: 'Manufacturing New Orders', kind: 'raw', group: 'macro', description: 'ISM manufacturing new orders index.' },
  { key: 'WALCL', label: 'Fed Balance Sheet', kind: 'raw', group: 'liquidity', description: 'Federal Reserve total assets.' },
  { key: 'WTREGEN', label: 'Treasury General Account', kind: 'raw', group: 'liquidity', description: 'US Treasury cash balance.' },
  { key: 'RRPONTSYD', label: 'Reverse Repo', kind: 'raw', group: 'liquidity', description: 'ON RRP balance in millions USD.' },
  { key: 'US_LIQ', label: 'US Net Liquidity', kind: 'derived', group: 'liquidity', description: 'WALCL minus TGA minus reverse repo.' },
  { key: 'US_LIQ_YOY', label: 'US Net Liquidity YoY', kind: 'derived', group: 'liquidity', description: 'Year-over-year change in US net liquidity.' },
  { key: 'US_LIQ_13W_DELTA', label: 'US Net Liquidity 13W Delta', kind: 'derived', group: 'liquidity', description: '13-week change in US net liquidity.' },
  { key: 'ECB_RAW', label: 'ECB Assets', kind: 'raw', group: 'liquidity', description: 'ECB balance sheet in EUR.' },
  { key: 'BOJ_RAW', label: 'BOJ Assets', kind: 'raw', group: 'liquidity', description: 'BOJ balance sheet in 100M JPY.' },
  { key: 'EURUSD', label: 'EURUSD', kind: 'raw', group: 'fx', description: 'USD per EUR.' },
  { key: 'JPYUSD', label: 'JPYUSD', kind: 'raw', group: 'fx', description: 'JPY per USD.' },
  { key: 'G3_ASSETS', label: 'G3 Assets', kind: 'derived', group: 'liquidity', description: 'Fed + ECB + BOJ balance sheets normalized to USD.' },
  { key: 'G3_YOY', label: 'G3 Assets YoY', kind: 'derived', group: 'liquidity', description: 'Year-over-year change in the G3 asset composite.' },
  { key: 'VAL_SCORE', label: 'Valuation Score', kind: 'signal', group: 'scores', description: 'CoinStrat valuation score.' },
  { key: 'LIQ_SCORE', label: 'Liquidity Score', kind: 'signal', group: 'scores', description: 'CoinStrat liquidity score.' },
  { key: 'DXY_SCORE', label: 'Dollar Score', kind: 'signal', group: 'scores', description: 'CoinStrat DXY score.' },
  { key: 'CYCLE_SCORE', label: 'Business Cycle Score', kind: 'signal', group: 'scores', description: 'CoinStrat business cycle score.' },
  { key: 'CORE_ON', label: 'CORE_ON', kind: 'signal', group: 'signals', description: 'Core accumulation signal.' },
  { key: 'MACRO_ON', label: 'MACRO_ON', kind: 'signal', group: 'signals', description: 'Macro acceleration signal.' },
  { key: 'ACCUM_ON', label: 'ACCUM_ON', kind: 'signal', group: 'signals', description: 'Composite accumulation signal.' },
  { key: 'PRICE_REGIME_ON', label: 'PRICE_REGIME_ON', kind: 'signal', group: 'signals', description: 'Price regime signal.' },
  { key: 'SIP_EXHAUSTED', label: 'SIP Exhausted', kind: 'signal', group: 'signals', description: 'Euphoria exhaustion exit flag.' },
] as const;

export type StrategySeriesKey = typeof STRATEGY_SERIES_CATALOG[number]['key'];
export type StrategySeriesKind = typeof STRATEGY_SERIES_CATALOG[number]['kind'];
export type StrategyMetricOperator =
  | 'identity'
  | 'rolling_mean'
  | 'pct_change'
  | 'diff'
  | 'rolling_min'
  | 'rolling_max';
export type StrategyComparator =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'crosses_above'
  | 'crosses_below';
export type StrategyConditionMode = 'all' | 'any';
export type StrategyAlertMode = 'disabled' | 'state_change' | 'turns_on' | 'turns_off';
export type StrategyStatus = 'draft' | 'active' | 'paused' | 'invalid';

export interface StrategySourceDefinition {
  id: string;
  seriesKey: StrategySeriesKey;
  label: string;
}

export interface StrategyMetricDefinition {
  id: string;
  label: string;
  operator: StrategyMetricOperator;
  input: string;
  window?: number;
  periods?: number;
  scale?: 'ratio' | 'percent';
}

export interface StrategyConditionDefinition {
  id: string;
  label: string;
  left: string;
  comparator: StrategyComparator;
  rightType: 'constant' | 'reference';
  rightConstant?: number;
  rightRef?: string;
  lookbackDays?: number;
  minTrueDays?: number;
}

export interface StrategyOutputDefinition {
  label: string;
  mode: StrategyConditionMode;
  conditionIds: string[];
}

export interface StrategyAlertDefinition {
  mode: StrategyAlertMode;
}

export interface StrategySpec {
  version: 1;
  name: string;
  description: string;
  prompt: string;
  sources: StrategySourceDefinition[];
  metrics: StrategyMetricDefinition[];
  conditions: StrategyConditionDefinition[];
  output: StrategyOutputDefinition;
  alerts: StrategyAlertDefinition;
}

export interface StrategyValidationResult {
  ok: boolean;
  errors: string[];
}

export interface StrategyInterpretationResult {
  spec: StrategySpec;
  warnings: string[];
  provider: 'openai' | 'heuristic';
}

export interface StrategyPreviewRow {
  Date: string;
  BTCUSD?: number;
  signal: number;
}

export interface StrategyTransition {
  Date: string;
  previous: number;
  next: number;
}

export interface StrategyPreviewResult {
  currentState: number;
  latestDate: string | null;
  rows: StrategyPreviewRow[];
  transitions: StrategyTransition[];
  metrics: Array<{ id: string; label: string; latestValue: number | null }>;
  conditions: Array<{ id: string; label: string; latestValue: boolean }>;
  summary: {
    activeDays: number;
    inactiveDays: number;
    transitionCount: number;
  };
}

export const STRATEGY_LIMITS = {
  maxSources: 8,
  maxMetrics: 5,
  maxConditions: 8,
  maxLookbackDays: 365,
  maxWindow: 400,
} as const;

export const STRATEGY_METRIC_OPERATORS: Array<{
  key: StrategyMetricOperator;
  label: string;
  description: string;
}> = [
  { key: 'identity', label: 'Identity', description: 'Use the input series directly.' },
  { key: 'rolling_mean', label: 'Rolling mean', description: 'Simple moving average over a fixed window.' },
  { key: 'pct_change', label: 'Percent change', description: 'Percent or ratio change over a fixed period.' },
  { key: 'diff', label: 'Difference', description: 'Absolute difference over a fixed period.' },
  { key: 'rolling_min', label: 'Rolling min', description: 'Rolling minimum over a fixed window.' },
  { key: 'rolling_max', label: 'Rolling max', description: 'Rolling maximum over a fixed window.' },
];

export function getStrategySeriesMeta(seriesKey: StrategySeriesKey) {
  return STRATEGY_SERIES_CATALOG.find((entry) => entry.key === seriesKey) ?? null;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

export function createEmptyStrategySpec(prompt = ''): StrategySpec {
  return {
    version: 1,
    name: 'Untitled strategy',
    description: 'Custom Pro strategy',
    prompt,
    sources: [],
    metrics: [],
    conditions: [],
    output: {
      label: 'Custom Signal',
      mode: 'all',
      conditionIds: [],
    },
    alerts: {
      mode: 'state_change',
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStrategySeriesKey(value: unknown): value is StrategySeriesKey {
  return typeof value === 'string' && STRATEGY_SERIES_CATALOG.some((entry) => entry.key === value);
}

function isMetricOperator(value: unknown): value is StrategyMetricOperator {
  return typeof value === 'string' && STRATEGY_METRIC_OPERATORS.some((entry) => entry.key === value);
}

function isComparator(value: unknown): value is StrategyComparator {
  return typeof value === 'string'
    && ['gt', 'gte', 'lt', 'lte', 'eq', 'crosses_above', 'crosses_below'].includes(value);
}

function isConditionMode(value: unknown): value is StrategyConditionMode {
  return value === 'all' || value === 'any';
}

function isAlertMode(value: unknown): value is StrategyAlertMode {
  return value === 'disabled'
    || value === 'state_change'
    || value === 'turns_on'
    || value === 'turns_off';
}

function requiresWindow(operator: StrategyMetricOperator): boolean {
  switch (operator) {
    case 'rolling_mean':
    case 'rolling_min':
    case 'rolling_max':
      return true;
    case 'identity':
    case 'pct_change':
    case 'diff':
      return false;
    default:
      return assertNever(operator);
  }
}

function requiresPeriods(operator: StrategyMetricOperator): boolean {
  switch (operator) {
    case 'pct_change':
    case 'diff':
      return true;
    case 'identity':
    case 'rolling_mean':
    case 'rolling_min':
    case 'rolling_max':
      return false;
    default:
      return assertNever(operator);
  }
}

export function validateStrategySpec(input: unknown): StrategyValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ['Strategy spec must be an object.'] };
  }

  if (input.version !== 1) {
    errors.push('Strategy version must be 1.');
  }

  if (!isNonEmptyString(input.name)) {
    errors.push('Strategy name is required.');
  }

  if (!isNonEmptyString(input.description)) {
    errors.push('Strategy description is required.');
  }

  if (!isNonEmptyString(input.prompt)) {
    errors.push('Original prompt is required.');
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const metrics = Array.isArray(input.metrics) ? input.metrics : [];
  const conditions = Array.isArray(input.conditions) ? input.conditions : [];

  if (sources.length === 0) {
    errors.push('At least one source is required.');
  }
  if (sources.length > STRATEGY_LIMITS.maxSources) {
    errors.push(`A strategy can use at most ${STRATEGY_LIMITS.maxSources} sources.`);
  }
  if (metrics.length > STRATEGY_LIMITS.maxMetrics) {
    errors.push(`A strategy can use at most ${STRATEGY_LIMITS.maxMetrics} metrics.`);
  }
  if (conditions.length === 0) {
    errors.push('At least one condition is required.');
  }
  if (conditions.length > STRATEGY_LIMITS.maxConditions) {
    errors.push(`A strategy can use at most ${STRATEGY_LIMITS.maxConditions} conditions.`);
  }

  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!isObject(source)) {
      errors.push('Each source must be an object.');
      continue;
    }
    if (!isNonEmptyString(source.id)) {
      errors.push('Each source must have an id.');
      continue;
    }
    if (sourceIds.has(source.id)) {
      errors.push(`Duplicate source id: ${source.id}`);
    }
    sourceIds.add(source.id);
    if (!isStrategySeriesKey(source.seriesKey)) {
      errors.push(`Invalid source series key for ${source.id}.`);
    }
    if (!isNonEmptyString(source.label)) {
      errors.push(`Source ${source.id} must have a label.`);
    }
  }

  const metricIds = new Set<string>();
  const availableRefs = new Set<string>(sourceIds);
  for (const metric of metrics) {
    if (!isObject(metric)) {
      errors.push('Each metric must be an object.');
      continue;
    }
    if (!isNonEmptyString(metric.id)) {
      errors.push('Each metric must have an id.');
      continue;
    }
    if (metricIds.has(metric.id)) {
      errors.push(`Duplicate metric id: ${metric.id}`);
    }
    metricIds.add(metric.id);
    availableRefs.add(metric.id);
    if (!isNonEmptyString(metric.label)) {
      errors.push(`Metric ${metric.id} must have a label.`);
    }
    if (!isMetricOperator(metric.operator)) {
      errors.push(`Metric ${metric.id} has an invalid operator.`);
      continue;
    }
    if (!isNonEmptyString(metric.input)) {
      errors.push(`Metric ${metric.id} must reference an input.`);
    } else if (!availableRefs.has(metric.input) && !sourceIds.has(metric.input)) {
      errors.push(`Metric ${metric.id} references unknown input ${metric.input}.`);
    }
    if (requiresWindow(metric.operator)) {
      if (!isFiniteNumber(metric.window) || metric.window < 2 || metric.window > STRATEGY_LIMITS.maxWindow) {
        errors.push(`Metric ${metric.id} requires a window between 2 and ${STRATEGY_LIMITS.maxWindow}.`);
      }
    }
    if (requiresPeriods(metric.operator)) {
      if (!isFiniteNumber(metric.periods) || metric.periods < 1 || metric.periods > STRATEGY_LIMITS.maxWindow) {
        errors.push(`Metric ${metric.id} requires periods between 1 and ${STRATEGY_LIMITS.maxWindow}.`);
      }
    }
    if (metric.operator === 'pct_change' && metric.scale !== 'ratio' && metric.scale !== 'percent') {
      errors.push(`Metric ${metric.id} percent change must declare scale "ratio" or "percent".`);
    }
  }

  const conditionIds = new Set<string>();
  const availableConditionRefs = new Set<string>([...sourceIds, ...metricIds]);
  for (const condition of conditions) {
    if (!isObject(condition)) {
      errors.push('Each condition must be an object.');
      continue;
    }
    if (!isNonEmptyString(condition.id)) {
      errors.push('Each condition must have an id.');
      continue;
    }
    if (conditionIds.has(condition.id)) {
      errors.push(`Duplicate condition id: ${condition.id}`);
    }
    conditionIds.add(condition.id);
    if (!isNonEmptyString(condition.label)) {
      errors.push(`Condition ${condition.id} must have a label.`);
    }
    if (!isNonEmptyString(condition.left) || !availableConditionRefs.has(condition.left)) {
      errors.push(`Condition ${condition.id} references unknown left operand ${String(condition.left)}.`);
    }
    if (!isComparator(condition.comparator)) {
      errors.push(`Condition ${condition.id} has an invalid comparator.`);
    }
    if (condition.rightType !== 'constant' && condition.rightType !== 'reference') {
      errors.push(`Condition ${condition.id} must use a constant or reference right operand.`);
    } else if (condition.rightType === 'constant') {
      if (!isFiniteNumber(condition.rightConstant)) {
        errors.push(`Condition ${condition.id} must provide a numeric rightConstant.`);
      }
    } else if (!isNonEmptyString(condition.rightRef) || !availableConditionRefs.has(condition.rightRef)) {
      errors.push(`Condition ${condition.id} references unknown right operand ${String(condition.rightRef)}.`);
    }

    const hasLookback = condition.lookbackDays !== undefined || condition.minTrueDays !== undefined;
    if (hasLookback) {
      if (!isFiniteNumber(condition.lookbackDays) || condition.lookbackDays < 1 || condition.lookbackDays > STRATEGY_LIMITS.maxLookbackDays) {
        errors.push(`Condition ${condition.id} lookbackDays must be between 1 and ${STRATEGY_LIMITS.maxLookbackDays}.`);
      }
      if (!isFiniteNumber(condition.minTrueDays) || condition.minTrueDays < 1) {
        errors.push(`Condition ${condition.id} minTrueDays must be at least 1.`);
      }
      if (isFiniteNumber(condition.lookbackDays) && isFiniteNumber(condition.minTrueDays) && condition.minTrueDays > condition.lookbackDays) {
        errors.push(`Condition ${condition.id} minTrueDays cannot exceed lookbackDays.`);
      }
    }
  }

  if (!isObject(input.output)) {
    errors.push('Output configuration is required.');
  } else {
    if (!isNonEmptyString(input.output.label)) {
      errors.push('Output label is required.');
    }
    if (!isConditionMode(input.output.mode)) {
      errors.push('Output mode must be "all" or "any".');
    }
    const outputConditionIds = Array.isArray(input.output.conditionIds) ? input.output.conditionIds : [];
    if (outputConditionIds.length === 0) {
      errors.push('Output must reference at least one condition.');
    }
    for (const conditionId of outputConditionIds) {
      if (typeof conditionId !== 'string' || !conditionIds.has(conditionId)) {
        errors.push(`Output references unknown condition id ${String(conditionId)}.`);
      }
    }
  }

  if (!isObject(input.alerts) || !isAlertMode(input.alerts.mode)) {
    errors.push('Alerts mode must be one of disabled, state_change, turns_on, or turns_off.');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function summarizeStrategySpec(spec: StrategySpec): string {
  const sourceLabels = spec.sources.map((source) => source.label).join(', ');
  const metricLabels = spec.metrics.map((metric) => metric.label).join(', ');
  return `${spec.output.label}: ${spec.output.mode.toUpperCase()} of ${spec.conditions.length} conditions using ${sourceLabels}${metricLabels ? ` with ${metricLabels}` : ''}.`;
}

export function describeComparator(comparator: StrategyComparator): string {
  switch (comparator) {
    case 'gt':
      return '>';
    case 'gte':
      return '>=';
    case 'lt':
      return '<';
    case 'lte':
      return '<=';
    case 'eq':
      return '=';
    case 'crosses_above':
      return 'crosses above';
    case 'crosses_below':
      return 'crosses below';
    default:
      return assertNever(comparator);
  }
}
