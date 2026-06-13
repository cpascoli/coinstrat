/**
 * Shared helpers for the CQM Risk DCA bot Netlify functions.
 *
 * Centralizes:
 *  - Settings I/O against `public.cqm_bot_settings`.
 *  - Last-order lookup against `public.cqm_bot_orders` (for the frequency
 *    hard-guard).
 *  - Server-side CQM Risk: `fitCQM()` on signal-cache BTCUSD (global fair-value
 *    risk vs auto-calibrated QR 50% — same model as the in-app charts).
 *  - Virtual strategy balances reconstructed from the bot's own order ledger
 *    plus accrued base deposits (never the raw exchange balances, which can
 *    include assets the bot must not manage).
 *  - Computing the target_trade_gbp from the dynamic sizing rule and the
 *    next-allowed-slot timestamp from the configured frequency.
 *
 * All access uses the service-role Supabase client and runs only inside
 * admin-gated Netlify functions, so PostgREST RLS doesn't get involved.
 */

import { serviceSupabase } from './auth';
import { fitCQM } from '../../../src/utils/cqm';
import {
  computeCqmDynamicTrade,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../../../src/utils/cqmSizing';
import { loadBtcPricePoints } from './cqmSnapshot';
import {
  computeVirtualBalances,
  LEDGER_ORDER_STATUSES,
  type LedgerOrderRow,
  type VirtualBalances,
} from './cqmLedger';

export type { VirtualBalances } from './cqmLedger';

export type BotFrequency = 'daily' | 'weekly' | 'monthly';

export interface BotSettings {
  base_amount_gbp: number;
  frequency: BotFrequency;
  enabled: boolean;
  updated_at?: string;
}

export interface BotOrder {
  id: string;
  triggered_at: string;
  side: 'BUY' | 'SELL';
  signal_date: string;
  cqm_risk: number;
  base_amount_gbp: number;
  target_amount_gbp: number;
  btc_gbp_ref: number;
  base_filled: number | null;
  quote_filled: number | null;
  fees_gbp: number | null;
  coinbase_order_id: string | null;
  coinbase_status: string;
  error_summary: string | null;
  raw_response?: unknown;
}

export interface RiskSnapshot {
  risk: number;       // 0..1
  signalDate: string; // YYYY-MM-DD
  btcUsd: number;     // BTC-USD price the model saw on that date
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: BotSettings = {
  base_amount_gbp: 100,
  frequency: 'daily',
  enabled: false,
};

export async function loadSettings(): Promise<BotSettings> {
  const { data, error } = await serviceSupabase
    .from('cqm_bot_settings')
    .select('base_amount_gbp, frequency, enabled, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load CQM bot settings: ${error.message}`);
  }
  if (!data) return DEFAULT_SETTINGS;

  return {
    base_amount_gbp: Number(data.base_amount_gbp ?? DEFAULT_SETTINGS.base_amount_gbp),
    frequency: (data.frequency as BotFrequency) ?? DEFAULT_SETTINGS.frequency,
    enabled: Boolean(data.enabled),
    updated_at: data.updated_at as string | undefined,
  };
}

export async function saveSettings(patch: Partial<BotSettings>): Promise<BotSettings> {
  const current = await loadSettings();
  const next: BotSettings = {
    base_amount_gbp: clampPositive(patch.base_amount_gbp, current.base_amount_gbp),
    frequency: normalizeFrequency(patch.frequency ?? current.frequency),
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
  };

  const { data, error } = await serviceSupabase
    .from('cqm_bot_settings')
    .upsert(
      { id: 1, ...next },
      { onConflict: 'id' },
    )
    .select('base_amount_gbp, frequency, enabled, updated_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to save CQM bot settings: ${error?.message ?? 'no row'}`);
  }

  return {
    base_amount_gbp: Number(data.base_amount_gbp),
    frequency: data.frequency as BotFrequency,
    enabled: Boolean(data.enabled),
    updated_at: data.updated_at as string,
  };
}

function clampPositive(value: number | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}

function normalizeFrequency(value: string): BotFrequency {
  if (value === 'weekly' || value === 'monthly') return value;
  return 'daily';
}

// ---------------------------------------------------------------------------
// Last order + frequency hard-guard
// ---------------------------------------------------------------------------

/**
 * Returns the most recent order that was actually sent to Coinbase (i.e. not
 * failed before submission). Used to enforce the frequency hard-guard:
 * failed orders should NOT push the next slot forward.
 */
export async function getLastSubmittedOrder(): Promise<BotOrder | null> {
  const { data, error } = await serviceSupabase
    .from('cqm_bot_orders')
    .select('*')
    .neq('coinbase_status', 'failed')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last CQM bot order: ${error.message}`);
  }
  return (data as BotOrder | null) ?? null;
}

const FREQUENCY_INTERVAL_MS: Record<BotFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};
const FREQUENCY_GUARD_GRACE_MS = 5 * 60 * 1000;

export interface FrequencyGuard {
  canExecute: boolean;
  nextSlotAt: string | null;   // ISO timestamp of the next allowed slot
  lastTriggeredAt: string | null;
}

export function computeFrequencyGuard(
  frequency: BotFrequency,
  lastOrder: BotOrder | null,
  now: Date = new Date(),
): FrequencyGuard {
  if (!lastOrder) {
    return { canExecute: true, nextSlotAt: null, lastTriggeredAt: null };
  }
  const last = new Date(lastOrder.triggered_at).getTime();
  const next = last + FREQUENCY_INTERVAL_MS[frequency];
  // Netlify scheduled functions fire on a minute boundary, while our order row
  // is inserted a few seconds later. Allow a small grace window so "daily" does
  // not skip tomorrow's run just because today's order was recorded at 00:00:26.
  const canExecute = now.getTime() + FREQUENCY_GUARD_GRACE_MS >= next;
  return {
    canExecute,
    nextSlotAt: new Date(next).toISOString(),
    lastTriggeredAt: lastOrder.triggered_at,
  };
}

// ---------------------------------------------------------------------------
// Execution lease (dedupe overlapping scheduled invocations)
// ---------------------------------------------------------------------------

export type ExecutionLeaseSource = 'admin_manual' | 'scheduled';

const STALE_EXECUTION_LEASE_MS = 45 * 60 * 1000;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * UTC calendar date of the cadence slot being executed. Concurrent invocations
 * for the same slot compute the same date, so only one lease can be active.
 */
export function computeExecutionLeaseDate(
  frequency: BotFrequency,
  lastOrder: BotOrder | null,
  now: Date = new Date(),
): string {
  if (!lastOrder) {
    return isoDate(now);
  }
  const last = new Date(lastOrder.triggered_at).getTime();
  const next = last + FREQUENCY_INTERVAL_MS[frequency];
  return isoDate(new Date(next));
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export async function cleanupStaleExecutionLeases(
  maxAgeMs = STALE_EXECUTION_LEASE_MS,
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { error } = await serviceSupabase
    .from('cqm_bot_execution_leases')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
    })
    .eq('status', 'leased')
    .is('order_row_id', null)
    .lt('leased_at', cutoff);

  if (error) {
    throw new Error(`Failed to clean stale CQM execution leases: ${error.message}`);
  }
}

export async function tryAcquireExecutionLease(input: {
  executionDate: string;
  frequency: BotFrequency;
  source: ExecutionLeaseSource;
}): Promise<{ acquired: true; leaseId: string } | { acquired: false }> {
  await cleanupStaleExecutionLeases();

  const { data, error } = await serviceSupabase
    .from('cqm_bot_execution_leases')
    .insert({
      execution_date: input.executionDate,
      frequency: input.frequency,
      source: input.source,
      status: 'leased',
    })
    .select('id')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return { acquired: false };
    }
    throw new Error(`Failed to acquire CQM execution lease: ${error.message}`);
  }

  return { acquired: true, leaseId: data.id as string };
}

export async function releaseExecutionLease(leaseId: string): Promise<void> {
  const { error } = await serviceSupabase
    .from('cqm_bot_execution_leases')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
    })
    .eq('id', leaseId)
    .eq('status', 'leased');

  if (error) {
    throw new Error(`Failed to release CQM execution lease: ${error.message}`);
  }
}

export async function completeExecutionLease(
  leaseId: string,
  orderRowId: string,
): Promise<void> {
  const { error } = await serviceSupabase
    .from('cqm_bot_execution_leases')
    .update({
      status: 'completed',
      order_row_id: orderRowId,
      released_at: null,
    })
    .eq('id', leaseId)
    .eq('status', 'leased');

  if (error) {
    throw new Error(`Failed to complete CQM execution lease: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// CQM Risk (server-side, identical to the in-app fit)
// ---------------------------------------------------------------------------

/**
 * Computes the latest CQM Risk by loading the BTCUSD history from the
 * Netlify Blobs signal cache and running `fitCQM()` on it.
 *
 * Uses the fair-value QR model (scaled asymmetric QR 50% + soft gate): global
 * risk from log(price/QR50%) residuals except near cycle lows, where a
 * softened blend toward min(global, rolling) applies with a global-risk floor.
 *
 * Reads the same cache key (`signals_latest`) used by `signal-current.ts`
 * and `signal-history.ts`, so the bot stays in sync with whatever data the
 * scheduled signal refresh has materialized.
 */
export async function computeLatestRisk(): Promise<RiskSnapshot> {
  const points = await loadBtcPricePoints();
  const fit = fitCQM(points);
  const last = fit.signals[fit.signals.length - 1];
  if (!last) {
    throw new Error('CQM fit produced no signals.');
  }
  return {
    risk: Number(last.risk),
    signalDate: last.date,
    btcUsd: Number(last.price),
  };
}

// ---------------------------------------------------------------------------
// Virtual strategy balances (bot ledger, not exchange balances)
// ---------------------------------------------------------------------------

/**
 * Reconstructs the GBP cash and BTC the strategy controls from its own order
 * history plus accrued base deposits (one base amount per cadence slot since
 * the first executed order). See cqmLedger.ts for the exact rules.
 */
export async function loadVirtualBalances(
  settings: Pick<BotSettings, 'base_amount_gbp' | 'frequency'>,
  now: Date = new Date(),
): Promise<VirtualBalances> {
  const { data, error } = await serviceSupabase
    .from('cqm_bot_orders')
    .select('side, triggered_at, coinbase_status, target_amount_gbp, btc_gbp_ref, base_filled, quote_filled, fees_gbp')
    .in('coinbase_status', [...LEDGER_ORDER_STATUSES])
    .order('triggered_at', { ascending: true })
    .limit(20000);

  if (error) {
    throw new Error(`Failed to load CQM bot orders for the ledger: ${error.message}`);
  }

  return computeVirtualBalances((data ?? []) as LedgerOrderRow[], settings, now);
}

// ---------------------------------------------------------------------------
// Target trade sizing
// ---------------------------------------------------------------------------

export interface TargetTrade {
  side: 'BUY' | 'SELL' | 'NONE';
  /** Always non-negative; the side flag carries the direction. */
  amountGbp: number;
  /** Signed target = base × (1 − 2 × Risk). Useful for display. */
  signedGbp: number;
}

export interface TargetTradeInput {
  baseGbp: number;
  risk: number;
  /** GBP cash available for buys (including today's deposit). */
  cashGbp?: number;
  /** Net BTC held (non-negative for sizing). */
  btcHeld?: number;
  /** BTC-GBP price for sell sizing. */
  btcGbp?: number;
  maxCashFraction?: number;
  sellThreshold?: number;
  minGbp?: number;
}

/**
 * The strategy is:
 *   Dynamic (default when cashGbp is provided):
 *     BUY  Risk < 50%: max(base × (1 − 2R), taper × maxCashFraction × cash),
 *          capped at the available cash
 *     HOLD 50% ≤ Risk ≤ sellThreshold
 *     SELL Risk > sellThreshold: scaled sell of base or 1% of BTC value,
 *          capped at the BTC held
 *   Legacy (when cashGbp omitted):
 *     target = base × (1 − 2 × Risk)
 *
 * The result is always rounded to whole pence.
 */
export function computeTarget(
  baseGbp: number,
  risk: number,
  minGbp?: number,
): TargetTrade;
export function computeTarget(input: TargetTradeInput): TargetTrade;
export function computeTarget(
  baseOrInput: number | TargetTradeInput,
  riskArg?: number,
  minGbpArg = 1,
): TargetTrade {
  const input: TargetTradeInput = typeof baseOrInput === 'number'
    ? { baseGbp: baseOrInput, risk: riskArg ?? 0.5, minGbp: minGbpArg }
    : baseOrInput;
  const minGbp = input.minGbp ?? 1;

  if (Number.isFinite(input.cashGbp)) {
    const sized = computeCqmDynamicTrade({
      baseAmount: input.baseGbp,
      risk: input.risk,
      cashBalance: input.cashGbp as number,
      btcHeld: input.btcHeld ?? 0,
      btcPrice: input.btcGbp ?? 0,
      maxCashFraction: input.maxCashFraction ?? CQM_DEFAULT_MAX_CASH_FRACTION,
      sellThreshold: input.sellThreshold ?? CQM_DEFAULT_SELL_THRESHOLD,
    });
    if (sized.buyAmount >= minGbp) {
      const rounded = Math.round(sized.buyAmount * 100) / 100;
      return { side: 'BUY', amountGbp: rounded, signedGbp: rounded };
    }
    if (sized.sellAmount >= minGbp) {
      const rounded = Math.round(sized.sellAmount * 100) / 100;
      return { side: 'SELL', amountGbp: rounded, signedGbp: -rounded };
    }
    const signed = Math.round(input.baseGbp * (1 - 2 * input.risk) * 100) / 100;
    return { side: 'NONE', amountGbp: 0, signedGbp: signed };
  }

  const signed = input.baseGbp * (1 - 2 * input.risk);
  const rounded = Math.round(signed * 100) / 100;
  const abs = Math.abs(rounded);
  if (abs < minGbp) {
    return { side: 'NONE', amountGbp: 0, signedGbp: rounded };
  }
  return {
    side: rounded > 0 ? 'BUY' : 'SELL',
    amountGbp: abs,
    signedGbp: rounded,
  };
}
