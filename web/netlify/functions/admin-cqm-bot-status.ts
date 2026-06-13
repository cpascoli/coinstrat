/**
 * GET /api/admin/cqm-bot/status — admin-only.
 *
 * Returns everything the Admin Dashboard CQM Bot panel needs in one round
 * trip: bot settings, Coinbase balances + BTC-GBP mid, latest CQM Risk,
 * computed target trade for today, frequency hard-guard state, and a
 * pointer to the last submitted order.
 *
 * Coinbase calls are wrapped in try/catch so a transient/Coinbase-side
 * failure doesn't break the rest of the panel (the UI still shows settings
 * + Risk + computed target even if balances couldn't be fetched).
 */
import type { Handler } from '@netlify/functions';

import { requireAdmin } from './lib/auth';
import {
  computeFrequencyGuard,
  computeLatestRisk,
  computeTarget,
  getLastSubmittedOrder,
  loadSettings,
  loadVirtualBalances,
  type BotOrder,
  type VirtualBalances,
} from './lib/cqmBot';
import {
  CoinbaseApiError,
  getBtcGbpBalances,
  getProduct,
  normalizeError,
} from './lib/coinbase';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const admin = await requireAdmin(event);
  if (!admin) {
    return json(401, { error: 'Admin access required' });
  }

  try {
    const settings = await loadSettings();
    const lastOrder = await getLastSubmittedOrder();
    const guard = computeFrequencyGuard(settings.frequency, lastOrder);

    // Run Coinbase + CQM Risk + ledger in parallel; surface partial results.
    const [balancesResult, productResult, riskResult, ledgerResult] = await Promise.allSettled([
      getBtcGbpBalances(),
      getProduct('BTC-GBP'),
      computeLatestRisk(),
      loadVirtualBalances(settings),
    ]);

    const balances = balancesResult.status === 'fulfilled' ? balancesResult.value : null;
    const product = productResult.status === 'fulfilled' ? productResult.value : null;
    const risk = riskResult.status === 'fulfilled' ? riskResult.value : null;
    const ledger: VirtualBalances | null =
      ledgerResult.status === 'fulfilled' ? ledgerResult.value : null;

    const errors: Record<string, string> = {};
    if (balancesResult.status === 'rejected') {
      errors.balances = normalizeError(balancesResult.reason);
    }
    if (productResult.status === 'rejected') {
      errors.product = normalizeError(productResult.reason);
    }
    if (riskResult.status === 'rejected') {
      errors.risk = normalizeError(riskResult.reason);
    }
    if (ledgerResult.status === 'rejected') {
      errors.ledger = normalizeError(ledgerResult.reason);
    }

    const btcGbpPrice = product ? Number(product.price) : null;
    // Mirror the executor: dynamic sizing from the virtual ledger when it is
    // available, otherwise fall back to the legacy flat-fraction preview.
    const target = risk
      ? (ledger && btcGbpPrice
          ? computeTarget({
              baseGbp: settings.base_amount_gbp,
              risk: risk.risk,
              cashGbp: ledger.cashGbp,
              btcHeld: ledger.btcHeld,
              btcGbp: btcGbpPrice,
            })
          : computeTarget(settings.base_amount_gbp, risk.risk))
      : null;
    const targetBtcSize = (target && target.side === 'SELL' && btcGbpPrice && btcGbpPrice > 0)
      ? target.amountGbp / btcGbpPrice
      : null;

    return json(200, {
      settings,
      balances: balances
        ? {
            gbp: balances.gbp,
            btc: balances.btc,
          }
        : null,
      product: product
        ? {
            product_id: product.product_id,
            price: btcGbpPrice,
            base_increment: product.base_increment,
            quote_increment: product.quote_increment,
            status: product.status ?? null,
          }
        : null,
      risk: risk
        ? {
            value: risk.risk,
            signal_date: risk.signalDate,
            btc_usd: risk.btcUsd,
          }
        : null,
      target: target
        ? {
            side: target.side,
            amount_gbp: target.amountGbp,
            signed_gbp: target.signedGbp,
            estimated_btc_size: targetBtcSize,
          }
        : null,
      virtual_ledger: ledger
        ? {
            cash_gbp: ledger.cashGbp,
            btc_held: ledger.btcHeld,
            deposits_gbp: ledger.depositsGbp,
            buys_gbp: ledger.buysGbp,
            sells_gbp: ledger.sellsGbp,
            periods_accrued: ledger.periodsAccrued,
          }
        : null,
      frequency_guard: {
        can_execute: settings.enabled
          && guard.canExecute
          && !!risk
          && !!target
          && target.side !== 'NONE',
        next_slot_at: guard.nextSlotAt,
        last_triggered_at: guard.lastTriggeredAt,
        guard_reason: guardReason(settings.enabled, guard.canExecute, risk, target),
      },
      last_order: lastOrder ? compactOrder(lastOrder) : null,
      partial_errors: Object.keys(errors).length > 0 ? errors : null,
    });
  } catch (err) {
    return json(500, { error: normalizeError(err) });
  }
};

function guardReason(
  enabled: boolean,
  guardOk: boolean,
  risk: { risk: number } | null,
  target: { side: 'BUY' | 'SELL' | 'NONE' } | null,
): string | null {
  if (!enabled) return 'Strategy is paused';
  if (!risk) return 'CQM Risk unavailable';
  if (!target) return 'Target trade unavailable';
  if (target.side === 'NONE') return 'No trade due (hold zone or below minimum)';
  if (!guardOk) return 'Next scheduled slot has not been reached';
  return null;
}

function compactOrder(o: BotOrder) {
  return {
    id: o.id,
    triggered_at: o.triggered_at,
    side: o.side,
    cqm_risk: Number(o.cqm_risk),
    target_amount_gbp: Number(o.target_amount_gbp),
    base_filled: o.base_filled !== null ? Number(o.base_filled) : null,
    quote_filled: o.quote_filled !== null ? Number(o.quote_filled) : null,
    coinbase_status: o.coinbase_status,
    coinbase_order_id: o.coinbase_order_id,
  };
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Re-export the typed error for any callers that want to discriminate.
export { CoinbaseApiError };
