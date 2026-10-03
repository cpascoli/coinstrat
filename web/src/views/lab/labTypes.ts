export type LabMode = 'compare' | 'inspect';

export const LAB_INSPECT_STRATEGIES = [
  'Baseline DCA',
  'CORE DCA',
  'CORE DCA + MACRO 3x',
  'CQM Risk DCA',
  'EMA Trend DCA',
  'LLI+CQM DCA',
  'CryptoTrend DCA',
] as const;

export type LabInspectStrategy = (typeof LAB_INSPECT_STRATEGIES)[number];

export const STRATEGY_COLORS: Record<string, string> = {
  'Baseline DCA': '#94a3b8',
  'CORE DCA': '#60a5fa',
  'CORE DCA + MACRO 3x': '#22c55e',
  'CQM Risk DCA': '#a855f7',
  'EMA Trend DCA': '#2dd4bf',
  'LLI+CQM DCA': '#f59e0b',
  'CryptoTrend DCA': '#e879f9',
};

/** Short blurbs for the Lab Inspect strategy picker. */
export const STRATEGY_DESCRIPTIONS: Record<LabInspectStrategy, string> = {
  'Baseline DCA':
    'Buy the full deposit every period — always in BTC. The fair benchmark for equal-funding comparisons.',
  'CORE DCA':
    'Buy when the CORE accumulation signal is on; hold cash (or sell) when it is off. Reserves deploy on re-entry.',
  'CORE DCA + MACRO 3x':
    'Same as CORE DCA, but when MACRO is also on the buy size is 3× the base deposit (extra capital injected).',
  'CQM Risk DCA':
    'Sizes buys and sells from walk-forward CQM Risk: deploy cash when Risk is low, hold in the mid zone, trim when high.',
  'EMA Trend DCA':
    'Rebalances the whole portfolio toward a BTC weight proportional to the fast/slow EMA spread (normalized by price).',
  'LLI+CQM DCA':
    'A gold/blue/gray trend filter gates CQM sizing: gold runs CQM, blue goes to cash, gray freezes trades (anti-whipsaw).',
  'CryptoTrend DCA':
    'SMMA 29/16 trend ribbon (your Pine indicator): DCA in uptrends, sell to cash in downtrends, freeze inside the neutral band.',
};

export function isLabInspectStrategy(name: string): name is LabInspectStrategy {
  return (LAB_INSPECT_STRATEGIES as readonly string[]).includes(name);
}
