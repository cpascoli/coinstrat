/**
 * CQM dynamic DCA sizing — shared by the backtest simulator and live bot.
 *
 * Tuned defaults (walk-forward grid on five windows, Jun 2026):
 *   maxCashFraction = 6%  — deploy up to 6% of the cash pile per period at Risk 0,
 *                           tapering linearly to 0 at fair value (50%).
 *   sellThreshold   = 75% — dead zone 50–75%; sell only above 75%, scaled to full
 *                           base (or 1% of BTC value) at Risk 100%.
 */

export const CQM_DEFAULT_MAX_CASH_FRACTION = 0.06;
export const CQM_DEFAULT_SELL_THRESHOLD = 0.75;
export const CQM_DEFAULT_BTC_SELL_FRACTION = 0.01;
export const CQM_FAIR_RISK = 0.5;

export interface CqmSizingInput {
  baseAmount: number;
  risk: number;
  cashBalance: number;
  btcHeld: number;
  btcPrice: number;
  maxCashFraction?: number;
  sellThreshold?: number;
  btcSellFraction?: number;
}

export interface CqmSizingResult {
  buyAmount: number;
  sellAmount: number;
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Dynamic CQM trade sizing for one DCA period.
 * Returns non-negative buy/sell amounts in the same currency as `baseAmount`.
 * Buys are capped at the available cash balance and sells at the value of the
 * BTC held, so the result is always executable against the provided ledger.
 */
export function computeCqmDynamicTrade(input: CqmSizingInput): CqmSizingResult {
  const base = input.baseAmount;
  const r = clamp(input.risk, 0, 1);
  const maxCashFrac = input.maxCashFraction ?? CQM_DEFAULT_MAX_CASH_FRACTION;
  const sellThreshold = input.sellThreshold ?? CQM_DEFAULT_SELL_THRESHOLD;
  const btcSellFrac = input.btcSellFraction ?? CQM_DEFAULT_BTC_SELL_FRACTION;
  const cash = Math.max(0, input.cashBalance);

  if (r < CQM_FAIR_RISK) {
    const taper = (CQM_FAIR_RISK - r) / CQM_FAIR_RISK;
    const cashFrac = maxCashFrac * taper;
    const buy = Math.max(base * (1 - 2 * r), cashFrac * cash);
    return { buyAmount: Math.min(Math.max(0, buy), cash), sellAmount: 0 };
  }

  if (r > sellThreshold && sellThreshold < 1) {
    const btcValue = Math.max(0, input.btcHeld) * Math.max(0, input.btcPrice);
    const sellScale = (r - sellThreshold) / (1 - sellThreshold);
    const size = Math.max(base, btcSellFrac * btcValue);
    const sell = Math.min(size * sellScale, btcValue);
    return { buyAmount: 0, sellAmount: Math.max(0, sell) };
  }

  return { buyAmount: 0, sellAmount: 0 };
}
