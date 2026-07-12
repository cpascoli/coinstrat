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
 * Deposits are replayed against the settings history
 * (`cqm_bot_settings_history`): each cadence slot deposits the base amount
 * in effect at that slot's start, and the gap to the next slot uses that
 * slot's frequency. Changing the base therefore only affects slots from the
 * change onward — it does NOT retroactively rewrite the funding line (which
 * previously inflated the virtual cash pile and could trigger an oversized
 * %-of-cash buy). When no history is supplied, the current settings apply
 * across the whole span, matching the pre-history behavior.
 *
 * Lump deposits (`cqm_bot_deposits`) are explicit capital injections on top
 * of the drip: each row's amount joins the funding line from its
 * `deposited_at` onward (future-dated rows are ignored until due). Negative
 * amounts withdraw idle cash from the mandate; the cash balance stays
 * floored at 0.
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
  /** Total funding line: dripped base deposits + lump deposits. */
  depositsGbp: number;
  /** Lump deposits due so far (net; negatives are withdrawals). */
  lumpDepositsGbp: number;
  buysGbp: number;
  sellsGbp: number;
  /** Cadence slots accrued (≥ 1; the current slot counts). */
  periodsAccrued: number;
}

/** One settings-history entry: the parameters in force from `effective_at`. */
export interface LedgerSettingsChange {
  base_amount_gbp: number;
  frequency: LedgerFrequency;
  /** ISO timestamp from which these settings apply. */
  effective_at: string;
}

/** One lump capital injection (negative = withdraw idle cash from the mandate). */
export interface LedgerDeposit {
  amount_gbp: number | string;
  /** ISO timestamp from which this amount is part of the funding line. */
  deposited_at: string;
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

/**
 * Replay the deposit schedule from `firstTs` through `nowTs`. Slots are
 * walked sequentially: each slot deposits the base amount of the settings in
 * effect at its start time, and the next slot follows after that settings'
 * cadence interval. Slots before the first history entry use the earliest
 * known settings (best available guess).
 */
function accrueDeposits(
  history: LedgerSettingsChange[],
  firstTs: number,
  nowTs: number,
): { depositsGbp: number; periodsAccrued: number } {
  const changes = history
    .map((h) => ({
      base: Number(h.base_amount_gbp),
      interval: LEDGER_INTERVAL_MS[h.frequency],
      ts: new Date(h.effective_at).getTime(),
    }))
    .filter((h) => Number.isFinite(h.base) && h.base > 0 && Number.isFinite(h.ts))
    .sort((a, b) => a.ts - b.ts);

  if (changes.length === 0) return { depositsGbp: 0, periodsAccrued: 0 };

  let deposits = 0;
  let periods = 0;
  let idx = 0;
  let slotTs = firstTs;
  while (slotTs <= nowTs) {
    while (idx + 1 < changes.length && changes[idx + 1].ts <= slotTs) idx++;
    deposits += changes[idx].base;
    periods += 1;
    slotTs += changes[idx].interval;
  }
  // The current slot always counts, even if `now` precedes the first slot.
  if (periods === 0) {
    deposits = changes[0].base;
    periods = 1;
  }
  return { depositsGbp: deposits, periodsAccrued: periods };
}

export function computeVirtualBalances(
  orders: LedgerOrderRow[],
  settings: { base_amount_gbp: number; frequency: LedgerFrequency },
  now: Date = new Date(),
  settingsHistory?: LedgerSettingsChange[],
  lumpDeposits?: LedgerDeposit[],
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

  const fallbackHistory: LedgerSettingsChange[] = [{
    base_amount_gbp: settings.base_amount_gbp,
    frequency: settings.frequency,
    effective_at: new Date(0).toISOString(),
  }];
  const history = settingsHistory && settingsHistory.length > 0 ? settingsHistory : fallbackHistory;
  const accrualStart = Number.isFinite(firstTs) ? firstTs : now.getTime();
  let accrual = accrueDeposits(history, accrualStart, now.getTime());
  if (accrual.periodsAccrued === 0) {
    // History rows were all invalid — accrue on the current settings instead.
    accrual = accrueDeposits(fallbackHistory, accrualStart, now.getTime());
  }
  const { periodsAccrued } = accrual;

  let lumpGbp = 0;
  for (const d of lumpDeposits ?? []) {
    const amount = toFinite(d.amount_gbp);
    const ts = new Date(d.deposited_at).getTime();
    if (amount === null || amount === 0 || !Number.isFinite(ts)) continue;
    if (ts > now.getTime()) continue; // future-dated: not funded yet
    lumpGbp += amount;
  }

  const depositsGbp = accrual.depositsGbp + lumpGbp;

  return {
    cashGbp: Math.max(0, round2(depositsGbp - buysGbp + sellsGbp)),
    btcHeld: Math.max(0, btcNet),
    depositsGbp: round2(depositsGbp),
    lumpDepositsGbp: round2(lumpGbp),
    buysGbp: round2(buysGbp),
    sellsGbp: round2(sellsGbp),
    periodsAccrued,
  };
}
