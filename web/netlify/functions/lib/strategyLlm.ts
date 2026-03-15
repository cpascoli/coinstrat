import fetch from 'node-fetch';
import {
  createEmptyStrategySpec,
  getStrategySeriesMeta,
  validateStrategySpec,
  type StrategyComparator,
  type StrategyInterpretationResult,
  type StrategySeriesKey,
  type StrategySpec,
} from '../../../src/lib/strategyBuilder';
import { buildStrategyRegistry } from './strategyEngine';

const DEFAULT_MODEL = process.env.OPENAI_STRATEGY_MODEL || 'gpt-4.1-mini';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'item';
}

function makeSourceId(seriesKey: StrategySeriesKey): string {
  return sanitizeId(seriesKey);
}

function heuristicSeries(prompt: string): StrategySeriesKey[] {
  const lower = prompt.toLowerCase();
  const matches: StrategySeriesKey[] = [];
  const entries: Array<{ seriesKey: StrategySeriesKey; keywords: string[] }> = [
    { seriesKey: 'BTCUSD', keywords: ['btc', 'bitcoin', 'price'] },
    { seriesKey: 'MVRV', keywords: ['mvrv'] },
    { seriesKey: 'LTH_SOPR', keywords: ['sopr'] },
    { seriesKey: 'NUPL', keywords: ['nupl'] },
    { seriesKey: 'SIP', keywords: ['supply in profit', 'sip'] },
    { seriesKey: 'DXY', keywords: ['dxy', 'dollar'] },
    { seriesKey: 'SAHM', keywords: ['sahm'] },
    { seriesKey: 'YC_M', keywords: ['yield curve', '10y3m', '10y-3m'] },
    { seriesKey: 'NO', keywords: ['new orders', 'ism'] },
    { seriesKey: 'US_LIQ', keywords: ['us liquidity', 'net liquidity'] },
    { seriesKey: 'US_LIQ_YOY', keywords: ['liquidity yoy', 'net liquidity yoy'] },
    { seriesKey: 'US_LIQ_13W_DELTA', keywords: ['13w', '13-week liquidity'] },
    { seriesKey: 'G3_ASSETS', keywords: ['g3 assets', 'g3 liquidity'] },
    { seriesKey: 'VAL_SCORE', keywords: ['valuation score', 'val score'] },
    { seriesKey: 'LIQ_SCORE', keywords: ['liquidity score', 'liq score'] },
    { seriesKey: 'DXY_SCORE', keywords: ['dxy score', 'dollar score'] },
    { seriesKey: 'CYCLE_SCORE', keywords: ['cycle score'] },
    { seriesKey: 'CORE_ON', keywords: ['core_on', 'core signal'] },
    { seriesKey: 'MACRO_ON', keywords: ['macro_on', 'macro signal'] },
    { seriesKey: 'PRICE_REGIME_ON', keywords: ['price regime'] },
  ];

  for (const entry of entries) {
    if (entry.keywords.some((keyword) => lower.includes(keyword))) {
      matches.push(entry.seriesKey);
    }
  }

  if (!matches.includes('BTCUSD')) {
    matches.unshift('BTCUSD');
  }

  return Array.from(new Set(matches)).slice(0, 5);
}

function firstWindow(prompt: string, fallback: number): number {
  const match = prompt.match(/(\d{1,3})\s*(day|d|week|wk|w)/i);
  if (!match) return fallback;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('w')) return value * 7;
  return value;
}

function heuristicComparator(prompt: string): StrategyComparator {
  const lower = prompt.toLowerCase();
  if (lower.includes('cross above') || lower.includes('crosses above')) return 'crosses_above';
  if (lower.includes('cross below') || lower.includes('crosses below')) return 'crosses_below';
  if (lower.includes('below') || lower.includes('under') || lower.includes('less than')) return 'lt';
  if (lower.includes('at least') || lower.includes('greater than or equal')) return 'gte';
  if (lower.includes('at most') || lower.includes('less than or equal')) return 'lte';
  return 'gt';
}

function buildHeuristicSpec(prompt: string): StrategyInterpretationResult {
  const spec = createEmptyStrategySpec(prompt);
  const sources = heuristicSeries(prompt);
  spec.name = 'Prompt strategy';
  spec.description = 'LLM fallback draft generated from the supplied prompt.';
  spec.sources = sources.map((seriesKey) => ({
    id: makeSourceId(seriesKey),
    seriesKey,
    label: getStrategySeriesMeta(seriesKey)?.label ?? seriesKey,
  }));

  const btcSource = spec.sources.find((source) => source.seriesKey === 'BTCUSD') ?? spec.sources[0];
  const window = firstWindow(prompt, 200);
  const comparator = heuristicComparator(prompt);

  spec.metrics = [{
    id: 'btc_trend',
    label: `BTC ${window}d average`,
    operator: 'rolling_mean',
    input: btcSource.id,
    window,
  }];

  const leftRef = btcSource.id;
  const rightRef = 'btc_trend';
  const label = comparator === 'lt' || comparator === 'lte' || comparator === 'crosses_below'
    ? 'BTC trend weakness'
    : 'BTC trend strength';

  spec.conditions = [{
    id: 'price_vs_trend',
    label,
    left: leftRef,
    comparator,
    rightType: 'reference',
    rightRef,
  }];

  if (prompt.toLowerCase().includes('and') && spec.sources.some((source) => source.seriesKey === 'MVRV')) {
    const mvrvSource = spec.sources.find((source) => source.seriesKey === 'MVRV');
    if (mvrvSource) {
      spec.conditions.push({
        id: 'valuation_filter',
        label: 'MVRV below 2',
        left: mvrvSource.id,
        comparator: 'lt',
        rightType: 'constant',
        rightConstant: 2,
      });
    }
  }

  spec.output = {
    label: 'Custom Signal',
    mode: prompt.toLowerCase().includes(' or ') ? 'any' : 'all',
    conditionIds: spec.conditions.map((condition) => condition.id),
  };

  const validation = validateStrategySpec(spec);
  if (!validation.ok) {
    throw new Error(`Heuristic strategy generation failed: ${validation.errors.join(' ')}`);
  }

  return {
    spec,
    warnings: ['Using fallback heuristic interpretation because no LLM provider is configured. Review the generated strategy before saving.'],
    provider: 'heuristic',
  };
}

function buildValidatedDraftFromCandidate(
  prompt: string,
  candidate: unknown,
  warnings: string[],
): StrategyInterpretationResult {
  const heuristic = buildHeuristicSpec(prompt);
  const baseSpec = heuristic.spec;

  const candidateSpec = isObject(candidate) && isObject(candidate.spec)
    ? candidate.spec
    : candidate;

  if (!isObject(candidateSpec)) {
    return {
      ...heuristic,
      warnings: [
        ...warnings,
        'The model response was not a valid strategy object, so CoinStrat used a safe heuristic draft instead.',
      ],
    };
  }

  const mergedSpec: StrategySpec = {
    version: 1,
    name: typeof candidateSpec.name === 'string' && candidateSpec.name.trim()
      ? candidateSpec.name
      : baseSpec.name,
    description: typeof candidateSpec.description === 'string' && candidateSpec.description.trim()
      ? candidateSpec.description
      : baseSpec.description,
    prompt,
    sources: Array.isArray(candidateSpec.sources) && candidateSpec.sources.length > 0
      ? candidateSpec.sources as StrategySpec['sources']
      : baseSpec.sources,
    metrics: Array.isArray(candidateSpec.metrics)
      ? candidateSpec.metrics as StrategySpec['metrics']
      : baseSpec.metrics,
    conditions: Array.isArray(candidateSpec.conditions) && candidateSpec.conditions.length > 0
      ? candidateSpec.conditions as StrategySpec['conditions']
      : baseSpec.conditions,
    output: isObject(candidateSpec.output)
      ? {
          label: typeof candidateSpec.output.label === 'string' && candidateSpec.output.label.trim()
            ? candidateSpec.output.label
            : baseSpec.output.label,
          mode: candidateSpec.output.mode === 'all' || candidateSpec.output.mode === 'any'
            ? candidateSpec.output.mode
            : baseSpec.output.mode,
          conditionIds: Array.isArray(candidateSpec.output.conditionIds) && candidateSpec.output.conditionIds.length > 0
            ? candidateSpec.output.conditionIds as string[]
            : baseSpec.output.conditionIds,
        }
      : baseSpec.output,
    alerts: isObject(candidateSpec.alerts)
      ? {
          mode:
            candidateSpec.alerts.mode === 'disabled'
            || candidateSpec.alerts.mode === 'state_change'
            || candidateSpec.alerts.mode === 'turns_on'
            || candidateSpec.alerts.mode === 'turns_off'
              ? candidateSpec.alerts.mode
              : baseSpec.alerts.mode,
        }
      : baseSpec.alerts,
  };

  const validation = validateStrategySpec(mergedSpec);
  if (!validation.ok) {
    return {
      ...heuristic,
      warnings: [
        ...warnings,
        'The model returned an incomplete draft, so CoinStrat fell back to a safe heuristic strategy.',
        `Validation details: ${validation.errors.join(' ')}`,
      ],
      provider: 'openai',
    };
  }

  return {
    spec: mergedSpec,
    warnings,
    provider: 'openai',
  };
}

function extractJsonObject(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return text.slice(first, last + 1);
}

function buildOpenAiMessages(prompt: string, registry: ReturnType<typeof buildStrategyRegistry>) {
  const examplePrompt = 'Alert me when BTC is above its 50 day moving average and MVRV is above 1.3';
  const exampleResponse = {
    spec: {
      version: 1,
      name: 'BTC above 50d MA with MVRV > 1.3',
      description: 'Signal turns on when BTC trades above its 50 day moving average and MVRV is above 1.3.',
      prompt: examplePrompt,
      sources: [
        { id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' },
        { id: 'mvrv', seriesKey: 'MVRV', label: 'MVRV' },
      ],
      metrics: [
        { id: 'btc_ma_50', label: 'BTC 50d average', operator: 'rolling_mean', input: 'btcusd', window: 50 },
      ],
      conditions: [
        { id: 'btc_above_ma', label: 'BTC above 50d average', left: 'btcusd', comparator: 'gt', rightType: 'reference', rightRef: 'btc_ma_50' },
        { id: 'mvrv_above_1_3', label: 'MVRV above 1.3', left: 'mvrv', comparator: 'gt', rightType: 'constant', rightConstant: 1.3 },
      ],
      output: {
        label: 'Custom Signal',
        mode: 'all',
        conditionIds: ['btc_above_ma', 'mvrv_above_1_3'],
      },
      alerts: {
        mode: 'state_change',
      },
    },
    warnings: [],
  };

  return [
    {
      role: 'system' as const,
      content: [
        'You are a strategy-spec generator for a Bitcoin macro app.',
        'Return only JSON with top-level keys: spec and warnings.',
        'The spec must exactly conform to version 1 of the constrained strategy schema.',
        'Use only series keys that exist in the provided registry.',
        'Use only these metric operators: identity, rolling_mean, pct_change, diff, rolling_min, rolling_max.',
        'Use only these comparators: gt, gte, lt, lte, eq, crosses_above, crosses_below.',
        'The spec MUST include every required field: version, name, description, prompt, sources, metrics, conditions, output, alerts.',
        'Do not invent a different AST shape such as strategy/operator/operands.',
        'Do not use operators like sma. Use rolling_mean instead.',
        'Do not omit alerts. Use alerts.mode = state_change unless the prompt clearly implies otherwise.',
        'Keep strategies simple enough for retail users to understand.',
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        task: 'Convert the prompt into the required StrategySpec schema.',
        prompt,
        registry,
        constraints: {
          maxMetrics: 5,
          maxConditions: 8,
          oneBooleanSignal: true,
        },
        forbiddenShapes: [
          { strategy: { operator: 'and', operands: [] } },
          { operator: 'sma' },
        ],
        requiredSpecShape: {
          version: 1,
          name: 'string',
          description: 'string',
          prompt: 'string',
          sources: [{ id: 'string', seriesKey: 'one of registry.series[].key', label: 'string' }],
          metrics: [{ id: 'string', label: 'string', operator: 'rolling_mean|pct_change|diff|identity|rolling_min|rolling_max', input: 'source-or-metric-id' }],
          conditions: [{ id: 'string', label: 'string', left: 'source-or-metric-id', comparator: 'gt|gte|lt|lte|eq|crosses_above|crosses_below', rightType: 'constant|reference' }],
          output: { label: 'string', mode: 'all|any', conditionIds: ['condition-id'] },
          alerts: { mode: 'disabled|state_change|turns_on|turns_off' },
        },
        examplePrompt,
        exampleResponse,
      }),
    },
  ];
}

async function requestOpenAiJson(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      messages,
      response_format: {
        type: 'json_object',
      },
    }),
  });

  return response;
}

async function buildOpenAiSpec(prompt: string): Promise<StrategyInterpretationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildHeuristicSpec(prompt);
  }

  const registry = buildStrategyRegistry();
  const response = await requestOpenAiJson(buildOpenAiMessages(prompt, registry));

  if (!response.ok) {
    const fallback = buildHeuristicSpec(prompt);
    return {
      ...fallback,
      provider: 'openai',
      warnings: [
        `OpenAI request failed with HTTP ${response.status}, so CoinStrat used the built-in heuristic interpreter instead.`,
        ...fallback.warnings,
      ],
    };
  }

  const json = await response.json() as any;
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    const fallback = buildHeuristicSpec(prompt);
    return {
      ...fallback,
      provider: 'openai',
      warnings: [
        'OpenAI returned an empty response, so CoinStrat used the built-in heuristic interpreter instead.',
        ...fallback.warnings,
      ],
    };
  }

  const parsed = JSON.parse(extractJsonObject(text)) as {
    spec?: StrategySpec;
    warnings?: string[];
    name?: string;
    description?: string;
  };

  const modelWarnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  const candidate = buildValidatedDraftFromCandidate(prompt, parsed, modelWarnings);
  const validation = validateStrategySpec(candidate.spec);
  if (validation.ok && candidate.warnings.length === modelWarnings.length) {
    return candidate;
  }

  const repairResponse = await requestOpenAiJson([
    {
      role: 'system',
      content: [
        'You are repairing a previously invalid strategy spec.',
        'Return only JSON with top-level keys spec and warnings.',
        'You must return the exact StrategySpec schema, not a custom AST.',
        'Do not explain. Do not wrap in markdown.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt,
        registry,
        validationErrors: validation.errors,
        previousModelResponse: parsed,
        requiredReminder: 'spec must contain version, name, description, prompt, sources, metrics, conditions, output, alerts',
      }),
    },
  ]);

  if (!repairResponse.ok) {
    return {
      ...candidate,
      warnings: [
        ...candidate.warnings,
        `OpenAI repair request failed with HTTP ${repairResponse.status}.`,
      ],
    };
  }

  const repairJson = await repairResponse.json() as any;
  const repairText = repairJson.choices?.[0]?.message?.content;
  if (typeof repairText !== 'string' || !repairText.trim()) {
    return {
      ...candidate,
      warnings: [
        ...candidate.warnings,
        'OpenAI repair request returned an empty response.',
      ],
    };
  }

  const repairedParsed = JSON.parse(extractJsonObject(repairText)) as {
    spec?: StrategySpec;
    warnings?: string[];
  };
  const repairedWarnings = Array.isArray(repairedParsed.warnings)
    ? repairedParsed.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  return buildValidatedDraftFromCandidate(prompt, repairedParsed, repairedWarnings);
}

export async function interpretStrategyPrompt(prompt: string): Promise<StrategyInterpretationResult> {
  if (!prompt.trim()) {
    throw new Error('Prompt is required.');
  }
  try {
    return await buildOpenAiSpec(prompt);
  } catch (error) {
    const fallback = buildHeuristicSpec(prompt);
    return {
      ...fallback,
      provider: 'openai',
      warnings: [
        `OpenAI interpretation failed (${error instanceof Error ? error.message : 'unknown error'}), so CoinStrat used the built-in heuristic interpreter instead.`,
        ...fallback.warnings,
      ],
    };
  }
}
