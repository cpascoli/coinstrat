import { validateStrategySpec, type StrategySpec } from './strategyBuilder';

/** Curated Signal Builder templates: load-only (not persisted; no delete). */
export type SystemStrategyTemplate = {
  id: string;
  /** Short label in the modal list */
  name: string;
  /** Purpose, reasoning, and how to read the signal (shown in the modal) */
  modalDescription: string;
  prompt: string;
  spec: StrategySpec;
  /** Distinctive traits for chips in the Load strategy modal (not a generic “built-in” label). */
  characteristicChips: readonly string[];
};

const ALERT_DEFAULT = { enabled: false, mode: 'state_change' as const };

function assertValidSpec(spec: StrategySpec, label: string): StrategySpec {
  const v = validateStrategySpec(spec);
  if (!v.ok) {
    throw new Error(`Invalid system strategy "${label}": ${v.errors.join('; ')}`);
  }
  return spec;
}

/** Monthly stochastic RSI > 20 on completed monthly bars (forward-filled to daily preview). */
const monthlyStochRsiThresholdSpec = assertValidSpec(
  {
    version: 1,
    name: 'Monthly Stochastic RSI threshold',
    description:
      'Uses the latest completed monthly Stochastic RSI on BTC; signal is on while that value stays above 20 until the next monthly update.',
    prompt: 'Alert me when the bitcoin monthly stochastic RSI is above 20.',
    sources: [{ id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' }],
    metrics: [
      {
        id: 'btc_monthly_stoch_rsi',
        label: 'BTC monthly Stochastic RSI',
        operator: 'stoch_rsi',
        input: 'btcusd',
        timeframe: 'month',
        length: 14,
        stochWindow: 14,
      },
    ],
    conditions: [
      {
        id: 'monthly_stoch_above_20',
        label: 'Monthly Stoch RSI above 20',
        left: 'btc_monthly_stoch_rsi',
        comparator: 'gt',
        rightType: 'constant',
        rightConstant: 20,
      },
    ],
    output: {
      label: 'Monthly Stoch RSI above 20',
      mode: 'all',
      conditionIds: ['monthly_stoch_above_20'],
    },
    alerts: { mode: 'state_change' },
  },
  'Monthly Stochastic RSI threshold',
);

/** Spot below long-term holder cost basis while short-term holder basis is also below LTH (compressed holder structure). */
const holderCostBasisSpreadSpec = assertValidSpec(
  {
    version: 1,
    name: 'Holder cost-basis spread',
    description:
      'Requires BTC below long-term holder realized price and short-term holder realized price below the same LTH anchor.',
    prompt:
      'BUY when BTC is below LTH Realized Price and the short-term holder realized price is below the LTH Realized Price.',
    sources: [
      { id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' },
      { id: 'sth_rp', seriesKey: 'STH_REALIZED_PRICE', label: 'STH Realized Price' },
      { id: 'lth_rp', seriesKey: 'LTH_REALIZED_PRICE', label: 'LTH Realized Price' },
    ],
    metrics: [],
    conditions: [
      {
        id: 'btc_below_lth',
        label: 'BTC below LTH realized price',
        left: 'btcusd',
        comparator: 'lt',
        rightType: 'reference',
        rightRef: 'lth_rp',
      },
      {
        id: 'sth_below_lth',
        label: 'STH realized price below LTH realized price',
        left: 'sth_rp',
        comparator: 'lt',
        rightType: 'reference',
        rightRef: 'lth_rp',
      },
    ],
    output: {
      label: 'Holder cost-basis spread',
      mode: 'all',
      conditionIds: ['btc_below_lth', 'sth_below_lth'],
    },
    alerts: { mode: 'state_change' },
  },
  'Holder cost-basis spread',
);

/**
 * MVRV vs its 90-day rolling minimum. The schema has no “reference + constant” RHS; this encodes the documented
 * “near the local floor” idea as price-based MVRV below that trailing minimum (tighten or rephrase in the prompt
 * and use Interpret if you need an explicit +0.1 buffer).
 */
const meanReversionSetupSpec = assertValidSpec(
  {
    version: 1,
    name: 'Mean-reversion setup',
    description:
      'Fires when MVRV trades below its 90-day rolling low — a simple “at or under the recent MVRV floor” proxy for washed-out sentiment.',
    prompt: 'Alert me when MVRV drops below its 90-day rolling minimum plus 0.1.',
    sources: [{ id: 'mvrv', seriesKey: 'MVRV', label: 'MVRV' }],
    metrics: [
      {
        id: 'mvrv_90d_min',
        label: 'MVRV 90-day rolling minimum',
        operator: 'rolling_min',
        input: 'mvrv',
        window: 90,
      },
    ],
    conditions: [
      {
        id: 'mvrv_below_recent_floor',
        label: 'MVRV below 90-day rolling minimum',
        left: 'mvrv',
        comparator: 'lt',
        rightType: 'reference',
        rightRef: 'mvrv_90d_min',
      },
    ],
    output: {
      label: 'MVRV mean-reversion',
      mode: 'all',
      conditionIds: ['mvrv_below_recent_floor'],
    },
    alerts: { mode: 'state_change' },
  },
  'Mean-reversion setup',
);

const trendDirectionSpec = assertValidSpec(
  {
    version: 1,
    name: 'Trend direction detection',
    description:
      'Combines a classic 200-day trend filter with slope (MA rising) and a soft dollar headwind via CoinStrat’s dollar score.',
    prompt:
      'Alert me when bitcoin is above the 200-day moving average, the 200-day MA is going up, and the dollar is weak.',
    sources: [
      { id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' },
      { id: 'dxy_score', seriesKey: 'DXY_SCORE', label: 'Dollar Score' },
    ],
    metrics: [
      { id: 'btc_ma_200', label: 'BTC 200d MA', operator: 'rolling_mean', input: 'btcusd', window: 200 },
      { id: 'btc_ma_200_slope', label: '200d MA daily change', operator: 'diff', input: 'btc_ma_200', periods: 1 },
    ],
    conditions: [
      {
        id: 'btc_above_ma',
        label: 'BTC above 200d MA',
        left: 'btcusd',
        comparator: 'gt',
        rightType: 'reference',
        rightRef: 'btc_ma_200',
      },
      {
        id: 'ma_rising',
        label: '200d MA rising',
        left: 'btc_ma_200_slope',
        comparator: 'gt',
        rightType: 'constant',
        rightConstant: 0,
      },
      {
        id: 'dollar_weak',
        label: 'Dollar weak (score ≥ 1)',
        left: 'dxy_score',
        comparator: 'gte',
        rightType: 'constant',
        rightConstant: 1,
      },
    ],
    output: {
      label: 'Uptrend + weak dollar',
      mode: 'all',
      conditionIds: ['btc_above_ma', 'ma_rising', 'dollar_weak'],
    },
    alerts: { mode: 'state_change' },
  },
  'Trend direction detection',
);

const liquidityDrivenAccumulationSpec = assertValidSpec(
  {
    version: 1,
    name: 'Liquidity-driven accumulation',
    description:
      'Layers short-term US liquidity momentum (30-day % change), positive year-over-year liquidity, and BTC above its 50-day MA so risk-on liquidity lines up with price trend.',
    prompt:
      'Accumulate when the 30-day percent change in US net liquidity is above 2% and US net liquidity year-over-year is positive and BTC is above its 50-day moving average.',
    sources: [
      { id: 'btcusd', seriesKey: 'BTCUSD', label: 'BTC Price (USD)' },
      { id: 'us_liq', seriesKey: 'US_LIQ', label: 'US Net Liquidity' },
      { id: 'us_liq_yoy', seriesKey: 'US_LIQ_YOY', label: 'US Net Liquidity YoY' },
    ],
    metrics: [
      {
        id: 'us_liq_30d_pct',
        label: 'US net liquidity 30d % change',
        operator: 'pct_change',
        input: 'us_liq',
        periods: 30,
        scale: 'percent',
      },
      { id: 'btc_ma_50', label: 'BTC 50d MA', operator: 'rolling_mean', input: 'btcusd', window: 50 },
    ],
    conditions: [
      {
        id: 'liq_momentum',
        label: '30d US liquidity change > 2%',
        left: 'us_liq_30d_pct',
        comparator: 'gt',
        rightType: 'constant',
        rightConstant: 2,
      },
      {
        id: 'liq_yoy_positive',
        label: 'US liquidity YoY positive',
        left: 'us_liq_yoy',
        comparator: 'gt',
        rightType: 'constant',
        rightConstant: 0,
      },
      {
        id: 'btc_above_50ma',
        label: 'BTC above 50d MA',
        left: 'btcusd',
        comparator: 'gt',
        rightType: 'reference',
        rightRef: 'btc_ma_50',
      },
    ],
    output: {
      label: 'Liquidity + trend accumulation',
      mode: 'all',
      conditionIds: ['liq_momentum', 'liq_yoy_positive', 'btc_above_50ma'],
    },
    alerts: { mode: 'state_change' },
  },
  'Liquidity-driven accumulation',
);

export const SYSTEM_STRATEGY_TEMPLATES: SystemStrategyTemplate[] = [
  {
    id: 'system:monthly-stoch-rsi-threshold',
    name: 'Monthly Stochastic RSI threshold',
    modalDescription:
      'Uses the monthly Stochastic RSI on BTC to flag when the oscillator sits above 20 after the latest monthly close. '
      + 'The idea is to catch longer-horizon momentum recovery without reacting to daily noise. Monthly values are forward-filled on the daily preview so you see a stable regime until the next month prints.',
    prompt: monthlyStochRsiThresholdSpec.prompt,
    spec: monthlyStochRsiThresholdSpec,
    characteristicChips: ['Monthly timeframe', 'Stoch RSI', 'Forward-filled preview'],
  },
  {
    id: 'system:holder-cost-basis-spread',
    name: 'Holder cost-basis spread',
    modalDescription:
      'Combines spot price with short- and long-term holder cost bases. When BTC is under the LTH realized price and STH realized price is also below that LTH level, recent buyers are not inflated versus long-dated holders and spot is trading under a key on-chain anchor — a structure some traders watch for “reset” or value-style entries. Not investment advice; use Preview to see how often it has fired historically.',
    prompt: holderCostBasisSpreadSpec.prompt,
    spec: holderCostBasisSpreadSpec,
    characteristicChips: ['On-chain', 'LTH vs STH', 'Realized price'],
  },
  {
    id: 'system:mean-reversion-setup',
    name: 'Mean-reversion setup',
    modalDescription:
      'Watches MVRV against its own 90-day trailing minimum. When MVRV falls under that rolling low, the market is pricing realized-cap valuation near a short-term floor — a classic mean-reversion style cue (capitulation / washed-out positioning). '
      + 'The example prompt mentions a +0.1 buffer; the engine compares directly to the rolling min — use Interpret on the prompt if you want that buffer expressed differently.',
    prompt: meanReversionSetupSpec.prompt,
    spec: meanReversionSetupSpec,
    characteristicChips: ['MVRV', '90d rolling min', 'Sentiment'],
  },
  {
    id: 'system:trend-direction-detection',
    name: 'Trend direction detection',
    modalDescription:
      'Requires three things at once: price above the 200-day average, that average rising day-over-day (trend, not just a static cross), and a weak-dollar regime via DXY_SCORE ≥ 1. That mirrors a macro-aware trend filter: risk assets often behave better when the dollar isn’t headwinding and the long MA slope confirms direction.',
    prompt: trendDirectionSpec.prompt,
    spec: trendDirectionSpec,
    characteristicChips: ['200d MA', 'MA slope', 'Dollar score'],
  },
  {
    id: 'system:liquidity-driven-accumulation',
    name: 'Liquidity-driven accumulation',
    modalDescription:
      'Stacks liquidity momentum (30-day % change in US net liquidity above 2%), structural expansion (YoY net liquidity positive), and a medium-term BTC trend filter (above 50-day MA). The reasoning is to accumulate only when both the plumbing (liquidity) and the tape (BTC vs 50d) agree — reducing signals driven by a single factor.',
    prompt: liquidityDrivenAccumulationSpec.prompt,
    spec: liquidityDrivenAccumulationSpec,
    characteristicChips: ['US liquidity', '30d momentum', '50d MA'],
  },
];

/** Alert defaults for applying a system template (not stored until user saves). */
export const SYSTEM_STRATEGY_ALERT_DEFAULT = ALERT_DEFAULT;
