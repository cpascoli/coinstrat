import { describe, it, expect } from 'vitest';
import { validateStrategySpec, type StrategySpec } from '../src/lib/strategyBuilder';
import {
  autoFixMetrics,
  buildHeuristicSpec,
  buildValidatedDraftFromCandidate,
} from '../netlify/functions/lib/strategyLlm';
import { evaluateStrategy } from '../netlify/functions/lib/strategyEngine';

const UPTREND_PROMPT =
  'Alert me when bitcoin is above the 200 day moving average, and the 200 day moving average is going up (uptrend) and the dollar is weak.';

/**
 * Simulates the exact LLM response that caused the production failure:
 * a diff metric without the required `periods` field.
 */
function buildBrokenLlmResponse() {
  return {
    spec: {
      version: 1,
      name: 'BTC uptrend with weak dollar',
      description: 'Signal on when BTC is above a rising 200d MA and the dollar is weak.',
      prompt: UPTREND_PROMPT,
      sources: [
        { id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' },
        { id: 'dxy_score', seriesKey: 'DXY_SCORE', label: 'Dollar Score' },
      ],
      metrics: [
        { id: 'btc_ma_200', label: 'BTC 200d MA', operator: 'rolling_mean', input: 'btcusd', window: 200 },
        { id: 'btc_ma_200_diff', label: '200d MA daily change', operator: 'diff', input: 'btc_ma_200' },
        // ^^^ missing `periods` — this is the exact bug the LLM produced
      ],
      conditions: [
        { id: 'btc_above_ma', label: 'BTC above 200d MA', left: 'btcusd', comparator: 'gt', rightType: 'reference', rightRef: 'btc_ma_200' },
        { id: 'ma_rising', label: '200d MA rising', left: 'btc_ma_200_diff', comparator: 'gt', rightType: 'constant', rightConstant: 0 },
        { id: 'dollar_weak', label: 'Dollar is weak', left: 'dxy_score', comparator: 'gte', rightType: 'constant', rightConstant: 1 },
      ],
      output: {
        label: 'BTC Uptrend + Weak Dollar',
        mode: 'all',
        conditionIds: ['btc_above_ma', 'ma_rising', 'dollar_weak'],
      },
      alerts: { mode: 'state_change' },
    },
    warnings: [],
  };
}

/**
 * Builds a correct spec (what the LLM should have returned).
 */
function buildCorrectSpec(): StrategySpec {
  return {
    version: 1,
    name: 'BTC uptrend with weak dollar',
    description: 'Signal on when BTC is above a rising 200d MA and the dollar is weak.',
    prompt: UPTREND_PROMPT,
    sources: [
      { id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' },
      { id: 'dxy_score', seriesKey: 'DXY_SCORE', label: 'Dollar Score' },
    ],
    metrics: [
      { id: 'btc_ma_200', label: 'BTC 200d MA', operator: 'rolling_mean', input: 'btcusd', window: 200 },
      { id: 'btc_ma_200_slope', label: '200d MA daily change', operator: 'diff', input: 'btc_ma_200', periods: 1 },
    ],
    conditions: [
      { id: 'btc_above_ma', label: 'BTC above 200d MA', left: 'btcusd', comparator: 'gt', rightType: 'reference', rightRef: 'btc_ma_200' },
      { id: 'ma_rising', label: '200d MA rising', left: 'btc_ma_200_slope', comparator: 'gt', rightType: 'constant', rightConstant: 0 },
      { id: 'dollar_weak', label: 'Dollar is weak', left: 'dxy_score', comparator: 'gte', rightType: 'constant', rightConstant: 1 },
    ],
    output: {
      label: 'BTC Uptrend + Weak Dollar',
      mode: 'all',
      conditionIds: ['btc_above_ma', 'ma_rising', 'dollar_weak'],
    },
    alerts: { mode: 'state_change' },
  };
}

function generateSyntheticRows(count: number) {
  const rows: any[] = [];
  const startDate = new Date('2021-01-01');
  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const btc = 30000 + Math.sin(i / 60) * 20000 + i * 10;
    rows.push({
      Date: date.toISOString().slice(0, 10),
      BTCUSD: btc,
      DXY_SCORE: i % 50 < 30 ? 1 : 0,
      MVRV: 1.5 + Math.sin(i / 40) * 0.8,
      VAL_SCORE: 2,
      LIQ_SCORE: 1,
      CYCLE_SCORE: 1,
      US_LIQ: 6e12,
      US_LIQ_YOY: 5,
      US_LIQ_13W_DELTA: 1e11,
      ACCUM_ON: 1,
      CORE_ON: 1,
      MACRO_ON: 0,
      PRICE_REGIME_ON: 1,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('strategyLlm — uptrend prompt regression', () => {
  describe('reproducing the original failure', () => {
    it('broken LLM response (diff without periods) fails validation', () => {
      const broken = buildBrokenLlmResponse();
      const validation = validateStrategySpec(broken.spec);
      expect(validation.ok).toBe(false);
      expect(validation.errors.some((e) => e.includes('periods'))).toBe(true);
    });
  });

  describe('autoFixMetrics', () => {
    it('adds periods=1 to diff metrics missing periods', () => {
      const metrics: StrategySpec['metrics'] = [
        { id: 'ma', label: 'MA', operator: 'rolling_mean', input: 'btcusd', window: 200 },
        { id: 'slope', label: 'Slope', operator: 'diff', input: 'ma' },
      ];
      const warnings: string[] = [];
      const fixed = autoFixMetrics(metrics, warnings);

      expect(fixed[1].periods).toBe(1);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('periods=1');
    });

    it('adds scale="ratio" to pct_change metrics missing scale', () => {
      const metrics: StrategySpec['metrics'] = [
        { id: 'chg', label: 'Change', operator: 'pct_change', input: 'btcusd', periods: 5 },
      ];
      const warnings: string[] = [];
      const fixed = autoFixMetrics(metrics, warnings);

      expect(fixed[0].scale).toBe('ratio');
      expect(warnings.length).toBe(1);
    });

    it('adds periods=1 and scale="ratio" to pct_change missing both', () => {
      const metrics: StrategySpec['metrics'] = [
        { id: 'chg', label: 'Change', operator: 'pct_change', input: 'btcusd' },
      ];
      const warnings: string[] = [];
      const fixed = autoFixMetrics(metrics, warnings);

      expect(fixed[0].periods).toBe(1);
      expect(fixed[0].scale).toBe('ratio');
      expect(warnings.length).toBe(2);
    });

    it('adds window=200 to rolling_mean metrics missing window', () => {
      const metrics: StrategySpec['metrics'] = [
        { id: 'ma', label: 'MA', operator: 'rolling_mean', input: 'btcusd' },
      ];
      const warnings: string[] = [];
      const fixed = autoFixMetrics(metrics, warnings);

      expect(fixed[0].window).toBe(200);
      expect(warnings.length).toBe(1);
    });

    it('does not touch metrics that are already correct', () => {
      const metrics: StrategySpec['metrics'] = [
        { id: 'ma', label: 'MA', operator: 'rolling_mean', input: 'btcusd', window: 50 },
        { id: 'slope', label: 'Slope', operator: 'diff', input: 'ma', periods: 3 },
      ];
      const warnings: string[] = [];
      const fixed = autoFixMetrics(metrics, warnings);

      expect(fixed[0].window).toBe(50);
      expect(fixed[1].periods).toBe(3);
      expect(warnings.length).toBe(0);
    });
  });

  describe('buildValidatedDraftFromCandidate with auto-fix', () => {
    it('recovers the broken LLM response instead of falling back to heuristic', () => {
      const broken = buildBrokenLlmResponse();
      const result = buildValidatedDraftFromCandidate(UPTREND_PROMPT, broken, []);

      expect(result.provider).toBe('openai');
      expect(result.spec.metrics.length).toBe(2);

      const diffMetric = result.spec.metrics.find((m) => m.operator === 'diff');
      expect(diffMetric).toBeDefined();
      expect(diffMetric!.periods).toBe(1);

      const validation = validateStrategySpec(result.spec);
      expect(validation.ok).toBe(true);

      expect(result.warnings.some((w) => w.includes('Auto-fixed'))).toBe(true);
      expect(result.warnings.every((w) => !w.includes('fell back to a safe heuristic'))).toBe(true);
    });

    it('preserves correct LLM output without adding warnings', () => {
      const correct = { spec: buildCorrectSpec(), warnings: [] };
      const result = buildValidatedDraftFromCandidate(UPTREND_PROMPT, correct, []);

      expect(result.provider).toBe('openai');
      expect(result.warnings.length).toBe(0);

      const validation = validateStrategySpec(result.spec);
      expect(validation.ok).toBe(true);
    });
  });

  describe('heuristic fallback', () => {
    it('produces a valid (albeit simpler) strategy for the uptrend prompt', () => {
      const result = buildHeuristicSpec(UPTREND_PROMPT);
      expect(result.provider).toBe('heuristic');

      const validation = validateStrategySpec(result.spec);
      expect(validation.ok).toBe(true);

      expect(result.spec.sources.some((s) => s.seriesKey === 'BTCUSD')).toBe(true);
      expect(result.spec.sources.some((s) => s.seriesKey === 'DXY')).toBe(true);
    });
  });

  describe('engine evaluation with the corrected spec', () => {
    it('evaluates the uptrend strategy on synthetic data without errors', () => {
      const spec = buildCorrectSpec();
      const rows = generateSyntheticRows(400);
      const result = evaluateStrategy(rows, spec);

      expect(result.rows.length).toBe(400);
      expect(result.latestDate).toBe(rows[rows.length - 1].Date);
      expect(typeof result.currentState).toBe('number');
      expect(result.snapshot.length).toBeGreaterThan(0);
      expect(result.summary.activeDays + result.summary.inactiveDays).toBe(400);
    });

    it('evaluates the auto-fixed spec identically to the correct spec', () => {
      const broken = buildBrokenLlmResponse();
      const fixed = buildValidatedDraftFromCandidate(UPTREND_PROMPT, broken, []);
      const correct = buildCorrectSpec();
      const rows = generateSyntheticRows(400);

      const fixedResult = evaluateStrategy(rows, fixed.spec);
      const correctResult = evaluateStrategy(rows, correct);

      expect(fixedResult.currentState).toBe(correctResult.currentState);
      expect(fixedResult.summary.activeDays).toBe(correctResult.summary.activeDays);
      expect(fixedResult.summary.transitionCount).toBe(correctResult.summary.transitionCount);
    });
  });
});
