/**
 * Shared helpers for the CQM Risk DCA bot Netlify functions.
 *
 * Centralizes:
 *  - Settings I/O against `public.cqm_bot_settings`.
 *  - Last-order lookup against `public.cqm_bot_orders` (for the frequency
 *    hard-guard).
 *  - Server-side CQM Risk calculation: reads the signal-cache BTCUSD history
 *    and feeds it to `fitCQM()` (the same TS used by the in-app charts), so
 *    the bot will use the exact same Risk the rest of the app shows.
 *  - Computing the target_trade_gbp from the strategy formula and the
 *    next-allowed-slot timestamp from the configured frequency.
 *
 * All access uses the service-role Supabase client and runs only inside
 * admin-gated Netlify functions, so PostgREST RLS doesn't get involved.
 */

import { signalsStore } from './store';
import { serviceSupabase } from './auth';
import { fitCQM, type CQMFit } from '../../../src/utils/cqm';

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
  // not skip tomorrow's run just because today's order was recorded at :37:26.
  const canExecute = now.getTime() + FREQUENCY_GUARD_GRACE_MS >= next;
  return {
    canExecute,
    nextSlotAt: new Date(next).toISOString(),
    lastTriggeredAt: lastOrder.triggered_at,
  };
}

// ---------------------------------------------------------------------------
// CQM Risk (server-side, identical to the in-app fit)
// ---------------------------------------------------------------------------

/**
 * Computes the latest CQM Risk by loading the BTCUSD history from the
 * Netlify Blobs signal cache and running `fitCQM()` on it.
 *
 * Reads the same cache key (`signals_latest`) used by `signal-current.ts`
 * and `signal-history.ts`, so the bot stays in sync with whatever data the
 * scheduled signal refresh has materialized.
 */
export async function computeLatestRisk(): Promise<RiskSnapshot> {
  const store = signalsStore();
  const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as
    | { data?: unknown[] }
    | null;

  if (!cached?.data || !Array.isArray(cached.data) || cached.data.length === 0) {
    throw new Error('Signal cache is empty — refresh signals before running the bot.');
  }

  const points: { date: string; ts: number; price: number }[] = [];
  for (const row of cached.data as Array<Record<string, unknown>>) {
    const date = typeof row.Date === 'string' ? row.Date : null;
    const price = Number(row.BTCUSD);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const ts = new Date(date).getTime();
    if (!Number.isFinite(ts)) continue;
    points.push({ date, ts, price });
  }

  if (points.length < 365) {
    throw new Error(`CQM fit requires ≥365 days of BTC history; got ${points.length}.`);
  }

  const fit: CQMFit = fitCQM(points);
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
// Target trade sizing
// ---------------------------------------------------------------------------

export interface TargetTrade {
  side: 'BUY' | 'SELL' | 'NONE';
  /** Always non-negative; the side flag carries the direction. */
  amountGbp: number;
  /** Signed target = base × (1 − 2 × Risk). Useful for display. */
  signedGbp: number;
}

/**
 * The strategy is: target = base × (1 − 2 × Risk).
 *   target > 0 → BUY that many GBP of BTC.
 *   target < 0 → SELL BTC worth that many GBP.
 *   |target| below `minGbp` → NONE (skip the trade).
 *
 * The result is always rounded to whole pence.
 */
export function computeTarget(
  baseGbp: number,
  risk: number,
  minGbp = 1,
): TargetTrade {
  const signed = baseGbp * (1 - 2 * risk);
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
