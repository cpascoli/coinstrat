/**
 * Virtual GBP/BTC ledger for the CQM Risk DCA bot.
 *
 * The dynamic sizing rule needs the cash and BTC balances the *strategy*
 * controls — not the exchange balances, which can include assets the bot
 * must not manage. So the ledger is reconstructed from the bot's own state:
 *
 *   deposits  = one base amount per cadence slot, from the first executed
 *               order through the current slot (the strategy's funding line)
 *   cash      = deposits − GBP spent on buys (incl. fees) + GBP sell proceeds
 *   BTC held  = filled buys − filled sells
 *
 * Orders that reached Coinbase ('filled' | 'submitted' | 'open') count;
 * 'pending' / 'cancelled' / 'failed' rows do not. When fills are missing
 * (e.g. still open), the target amount and reference price stand in.
 *
 * Simplification: deposits accrue at the *current* base amount and frequency
 * across the whole history; past settings changes are not replayed.
 */

export type LedgerFrequency = 'daily' | 'weekly' | 'monthly';

export interface LedgerOrderRow {
  side: 'BUY' | 'SELL';
  triggered_at: string;
  coinbase_status: string;
  target_amount_gbp: number | string;
  btc_gbp_ref: number | string;
  base_filled: number | string | null;
  quote_filled: number | string | null;
  fees_gbp: number | string | null;
}

export interface VirtualBalances {
  /** GBP available to the strategy, including the current slot's deposit. */
  cashGbp: number;
  /** BTC accumulated by the strategy. */
  btcHeld: number;
  depositsGbp: number;
  buysGbp: number;
  sellsGbp: number;
  /** Cadence slots accrued (≥ 1; the current slot counts). */
  periodsAccrued: number;
}

const LEDGER_INTERVAL_MS: Record<LedgerFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/** Statuses that represent orders actually sent to (and held by) Coinbase. */
export const LEDGER_ORDER_STATUSES = ['filled', 'submitted', 'open'] as const;

function toFinite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeVirtualBalances(
  orders: LedgerOrderRow[],
  settings: { base_amount_gbp: number; frequency: LedgerFrequency },
  now: Date = new Date(),
): VirtualBalances {
  const allowed = new Set<string>(LEDGER_ORDER_STATUSES);

  let firstTs = Infinity;
  let buysGbp = 0;
  let sellsGbp = 0;
  let btcNet = 0;

  for (const o of orders) {
    if (!allowed.has(o.coinbase_status)) continue;
    const ts = new Date(o.triggered_at).getTime();
    if (Number.isFinite(ts) && ts < firstTs) firstTs = ts;

    const targetAbs = Math.abs(toFinite(o.target_amount_gbp) ?? 0);
    const quote = toFinite(o.quote_filled);
    const fees = toFinite(o.fees_gbp) ?? 0;
    const base = toFinite(o.base_filled);
    const ref = toFinite(o.btc_gbp_ref) ?? 0;
    const btcEstimate = ref > 0 ? targetAbs / ref : 0;

    if (o.side === 'BUY') {
      // A quote-size market buy spends filled_value + fees ≈ the quote size.
      buysGbp += quote !== null ? quote + fees : targetAbs;
      btcNet += base ?? btcEstimate;
    } else {
      sellsGbp += quote !== null ? Math.max(0, quote - fees) : targetAbs;
      btcNet -= base ?? btcEstimate;
    }
  }

  const interval = LEDGER_INTERVAL_MS[settings.frequency];
  const periodsAccrued = Number.isFinite(firstTs)
    ? Math.max(1, Math.floor((now.getTime() - firstTs) / interval) + 1)
    : 1;
  const depositsGbp = periodsAccrued * settings.base_amount_gbp;

  return {
    cashGbp: Math.max(0, round2(depositsGbp - buysGbp + sellsGbp)),
    btcHeld: Math.max(0, btcNet),
    depositsGbp: round2(depositsGbp),
    buysGbp: round2(buysGbp),
    sellsGbp: round2(sellsGbp),
    periodsAccrued,
  };
}
