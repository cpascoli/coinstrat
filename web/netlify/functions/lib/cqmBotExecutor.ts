/**
 * Shared CQM bot trade-execution pipeline.
 *
 * Called from two places:
 *   1. The admin-gated `admin-cqm-bot-execute.ts` Netlify function when the
 *      admin clicks "Execute trade" in the UI.
 *   2. The Netlify scheduled function `scheduled-cqm-bot.ts` that fires on a
 *      cron at 00:00 UTC every day.
 *
 * Both callers use the same business logic: pause guard → frequency hard
 * guard → execution lease → CQM Risk → target sizing → BTC-GBP price →
 * pending row → market order → poll for fills → persist outcome.
 *
 * Returns a discriminated `ExecutionResult` rather than HTTP responses so
 * each caller can adapt the result to its own envelope (JSON HTTP for the
 * admin endpoint, log-and-200 for the scheduler).
 */
import crypto from 'crypto';

import { serviceSupabase } from './auth';
import {
  completeExecutionLease,
  computeExecutionLeaseDate,
  computeFrequencyGuard,
  computeLatestRisk,
  computeTarget,
  getLastSubmittedOrder,
  loadSettings,
  releaseExecutionLease,
  tryAcquireExecutionLease,
} from './cqmBot';
import {
  getProduct,
  normalizeError,
  pollOrderUntilFilled,
  submitMarketOrder,
  type CoinbaseOrder,
} from './coinbase';

export type SkipReason =
  | 'paused'
  | 'frequency_guard'
  | 'execution_lease'
  | 'no_trade_due'
  | 'risk_unavailable'
  | 'product_unavailable'
  | 'base_size_zero';

export type ExecutionResult =
  | {
      kind: 'skipped';
      reason: SkipReason;
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      kind: 'submitted';
      order: Record<string, unknown>;
      coinbase_status: string;
      coinbase_order_id: string | null;
    }
  | {
      kind: 'failed';
      message: string;
      order_row_id?: string;
    };

export interface ExecutionContext {
  /**
   * Tag for log lines (and any future audit metadata). Has no effect on the
   * trade itself — the same pause guard, hard guard, risk and target logic
   * apply regardless of who triggered.
   */
  source: 'admin_manual' | 'scheduled';
}

export async function runCqmBotExecution(ctx: ExecutionContext): Promise<ExecutionResult> {
  // ---- Settings + pause guard ------------------------------------------
  const settings = await loadSettings();
  if (!settings.enabled) {
    return {
      kind: 'skipped',
      reason: 'paused',
      message: 'Strategy is paused. Resume it from the Admin panel before executing.',
    };
  }

  // ---- Frequency hard guard --------------------------------------------
  const lastOrder = await getLastSubmittedOrder();
  const guard = computeFrequencyGuard(settings.frequency, lastOrder);
  if (!guard.canExecute) {
    return {
      kind: 'skipped',
      reason: 'frequency_guard',
      message: 'Next scheduled slot has not been reached',
      details: {
        next_slot_at: guard.nextSlotAt,
        last_triggered_at: guard.lastTriggeredAt,
      },
    };
  }

  // ---- Execution lease (before slow fitCQM work) -----------------------
  const executionDate = computeExecutionLeaseDate(settings.frequency, lastOrder);
  const lease = await tryAcquireExecutionLease({
    executionDate,
    frequency: settings.frequency,
    source: ctx.source,
  });
  if (!lease.acquired) {
    return {
      kind: 'skipped',
      reason: 'execution_lease',
      message: 'Another invocation is already executing this cadence slot',
      details: {
        execution_date: executionDate,
        frequency: settings.frequency,
      },
    };
  }

  let leaseReleased = false;
  const abandonLease = async () => {
    if (leaseReleased) return;
    leaseReleased = true;
    await releaseExecutionLease(lease.leaseId);
  };

  try {
    return await executeWithLease(ctx, settings, lease.leaseId, abandonLease);
  } catch (error) {
    await abandonLease();
    throw error;
  }
}

async function executeWithLease(
  ctx: ExecutionContext,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  leaseId: string,
  abandonLease: () => Promise<void>,
): Promise<ExecutionResult> {
  // ---- CQM Risk + target sizing ----------------------------------------
  let risk;
  try {
    risk = await computeLatestRisk();
  } catch (err) {
    await abandonLease();
    return {
      kind: 'skipped',
      reason: 'risk_unavailable',
      message: `Failed to compute CQM Risk: ${normalizeError(err)}`,
    };
  }

  const target = computeTarget(settings.base_amount_gbp, risk.risk);
  if (target.side === 'NONE') {
    await abandonLease();
    return {
      kind: 'skipped',
      reason: 'no_trade_due',
      message: 'Target trade is below the minimum (Risk ≈ 50%); nothing to do.',
      details: { risk: risk.risk, signed_gbp: target.signedGbp },
    };
  }

  // ---- BTC-GBP reference price (needed for SELL sizing + audit) ---------
  let product;
  try {
    product = await getProduct('BTC-GBP');
  } catch (err) {
    await abandonLease();
    return {
      kind: 'skipped',
      reason: 'product_unavailable',
      message: `Failed to fetch BTC-GBP product: ${normalizeError(err)}`,
    };
  }
  const btcGbpPrice = Number(product.price);
  if (!Number.isFinite(btcGbpPrice) || btcGbpPrice <= 0) {
    await abandonLease();
    return {
      kind: 'failed',
      message: 'Coinbase returned an invalid BTC-GBP price',
    };
  }

  // ---- Insert pending row BEFORE submitting -----------------------------
  const { data: pendingRow, error: insertErr } = await serviceSupabase
    .from('cqm_bot_orders')
    .insert({
      side: target.side,
      signal_date: risk.signalDate,
      cqm_risk: risk.risk,
      base_amount_gbp: settings.base_amount_gbp,
      target_amount_gbp: target.signedGbp,
      btc_gbp_ref: btcGbpPrice,
      coinbase_status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr || !pendingRow) {
    await abandonLease();
    return {
      kind: 'failed',
      message: `Failed to record pending order: ${insertErr?.message ?? 'no row'}`,
    };
  }
  const orderRowId = pendingRow.id as string;

  // ---- Compute size + submit -------------------------------------------
  const clientOrderId = crypto.randomUUID();
  const baseIncrement = Number(product.base_increment) || 1e-8;
  const quoteSize = target.side === 'BUY' ? target.amountGbp.toFixed(2) : undefined;
  const baseSize = target.side === 'SELL'
    ? roundDownToIncrement(target.amountGbp / btcGbpPrice, baseIncrement).toString()
    : undefined;

  if (target.side === 'SELL' && (!baseSize || Number(baseSize) <= 0)) {
    await markFailed(orderRowId, 'Computed BTC base_size rounded to zero');
    await abandonLease();
    return {
      kind: 'skipped',
      reason: 'base_size_zero',
      message: 'Computed BTC base_size rounded to zero',
    };
  }

  let submitResp: { order_id?: string; response: unknown };
  try {
    submitResp = await submitMarketOrder({
      clientOrderId,
      side: target.side,
      productId: 'BTC-GBP',
      quoteSize,
      baseSize,
    });
  } catch (err) {
    const errMsg = normalizeError(err);
    await markFailed(orderRowId, errMsg);
    await abandonLease();
    return {
      kind: 'failed',
      message: `Coinbase rejected the order: ${errMsg}`,
      order_row_id: orderRowId,
    };
  }

  const coinbaseOrderId = submitResp.order_id ?? null;

  // ---- Poll for fills ---------------------------------------------------
  let filled: CoinbaseOrder | null = null;
  if (coinbaseOrderId) {
    try {
      filled = await pollOrderUntilFilled(coinbaseOrderId, { timeoutMs: 6000 });
    } catch (err) {
      console.warn(`[cqm-bot:${ctx.source}] poll error:`, normalizeError(err));
    }
  }

  const baseFilled = filled?.filled_size !== undefined ? Number(filled.filled_size) : null;
  const quoteFilled = filled?.filled_value !== undefined ? Number(filled.filled_value) : null;
  const feesGbp = filled?.total_fees !== undefined ? Number(filled.total_fees) : null;
  const status = mapCoinbaseStatus(filled?.status, coinbaseOrderId);

  const { data: finalRow, error: updateErr } = await serviceSupabase
    .from('cqm_bot_orders')
    .update({
      coinbase_order_id: coinbaseOrderId,
      coinbase_status: status,
      base_filled: baseFilled,
      quote_filled: quoteFilled,
      fees_gbp: feesGbp,
      raw_response: { submit: submitResp.response, fill: filled },
    })
    .eq('id', orderRowId)
    .select('*')
    .single();

  if (updateErr) {
    await completeExecutionLease(leaseId, orderRowId);
    return {
      kind: 'failed',
      message: `Order submitted but failed to update row: ${updateErr.message}`,
      order_row_id: orderRowId,
    };
  }

  await completeExecutionLease(leaseId, orderRowId);

  return {
    kind: 'submitted',
    order: finalRow as Record<string, unknown>,
    coinbase_status: status,
    coinbase_order_id: coinbaseOrderId,
  };
}

function roundDownToIncrement(value: number, increment: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return 0;
  const steps = Math.floor(value / increment);
  return Math.round(steps * increment * 1e12) / 1e12;
}

function mapCoinbaseStatus(
  raw: string | undefined,
  orderId: string | null,
): 'submitted' | 'open' | 'filled' | 'cancelled' | 'failed' {
  if (!orderId) return 'failed';
  const s = (raw ?? '').toUpperCase();
  if (s === 'FILLED') return 'filled';
  if (s === 'OPEN' || s === 'PENDING') return 'open';
  if (s === 'CANCELLED' || s === 'CANCELED' || s === 'EXPIRED' || s === 'REJECTED' || s === 'FAILED') {
    return 'cancelled';
  }
  return 'submitted';
}

async function markFailed(orderRowId: string, error: string): Promise<void> {
  await serviceSupabase
    .from('cqm_bot_orders')
    .update({ coinbase_status: 'failed', error_summary: error.slice(0, 500) })
    .eq('id', orderRowId);
}
