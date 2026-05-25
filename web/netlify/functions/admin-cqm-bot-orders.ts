/**
 * GET /api/admin/cqm-bot/orders — admin-only.
 *
 * Returns the full order history (most recent first, capped) plus aggregated
 * stats. The stats are deliberately a CLOSED-SYSTEM view of just this bot,
 * computed from rows in `cqm_bot_orders` ONLY — other Coinbase balances
 * (e.g. coins or GBP from non-bot activity) never enter the calculation.
 *
 * Accounting model: treat the bot as a separate trading account that
 * started at zero BTC and zero GBP.
 *   - Every BUY:  bot_cash −= (quote_filled + fees), bot_btc += base_filled
 *   - Every SELL: bot_cash += (quote_filled − fees), bot_btc −= base_filled
 *
 * Derived stats:
 *   - total_bought_gbp        Σ BUY.quote_filled              (matches Coinbase fill amounts)
 *   - total_sold_gbp          Σ SELL.quote_filled
 *   - total_fees_gbp          Σ fees
 *   - btc_accumulated         Σ BUY.base − Σ SELL.base        (net BTC the bot holds)
 *   - gross_invested_gbp      total_bought + BUY fees         (real cash OUT of your bank)
 *   - realized_proceeds_gbp   total_sold − SELL fees          (real cash IN to your bank)
 *   - net_invested_gbp        gross_invested − realized_proceeds (capital currently at work)
 *   - bot_btc_value_gbp       btc_accumulated × current_btc_gbp
 *   - bot_portfolio_value_gbp bot_btc_value + realized_proceeds (total wealth produced)
 *   - bot_roi_pct             (bot_portfolio_value − gross_invested) / gross_invested
 *
 * Only `bot_btc_value_gbp`, `bot_portfolio_value_gbp`, and `bot_roi_pct`
 * depend on the live BTC-GBP price; if Coinbase is unreachable those three
 * come back as null and `partial_errors.product` carries the message.
 */
import type { Handler } from '@netlify/functions';

import { requireAdmin } from './lib/auth';
import { serviceSupabase } from './lib/auth';
import { getProduct, normalizeError } from './lib/coinbase';
import type { BotOrder } from './lib/cqmBot';

const MAX_ORDERS = 200;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const admin = await requireAdmin(event);
  if (!admin) return json(401, { error: 'Admin access required' });

  try {
    const { data: rows, error } = await serviceSupabase
      .from('cqm_bot_orders')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(MAX_ORDERS);

    if (error) {
      return json(500, { error: `Failed to load orders: ${error.message}` });
    }

    const orders = (rows as BotOrder[] | null) ?? [];

    // Per-side accumulators from filled rows only. Pending/failed orders
    // never moved BTC or cash so they're excluded from the bot-only books.
    let totalBoughtGbp = 0; // Σ BUY.quote_filled
    let totalSoldGbp = 0;   // Σ SELL.quote_filled
    let buyFeesGbp = 0;
    let sellFeesGbp = 0;
    let btcBought = 0;
    let btcSold = 0;
    let filledCount = 0;

    for (const o of orders) {
      if (o.coinbase_status !== 'filled') continue;
      const baseFilled = o.base_filled !== null ? Number(o.base_filled) : 0;
      const quoteFilled = o.quote_filled !== null ? Number(o.quote_filled) : 0;
      const fees = o.fees_gbp !== null ? Number(o.fees_gbp) : 0;
      if (o.side === 'BUY') {
        totalBoughtGbp += quoteFilled;
        buyFeesGbp += fees;
        btcBought += baseFilled;
      } else {
        totalSoldGbp += quoteFilled;
        sellFeesGbp += fees;
        btcSold += baseFilled;
      }
      filledCount += 1;
    }

    const totalFeesGbp = buyFeesGbp + sellFeesGbp;
    const btcAccumulated = btcBought - btcSold;
    const grossInvestedGbp = totalBoughtGbp + buyFeesGbp;     // real cash OUT
    const realizedProceedsGbp = totalSoldGbp - sellFeesGbp;   // real cash IN
    const netInvestedGbp = grossInvestedGbp - realizedProceedsGbp;

    // Only the BTC-GBP price comes from Coinbase now; we no longer mix in
    // live balances because those include non-bot holdings.
    let product = null;
    const errors: Record<string, string> = {};
    try {
      product = await getProduct('BTC-GBP');
    } catch (err) {
      errors.product = normalizeError(err);
    }

    const currentBtcGbp = product ? Number(product.price) : null;
    const botBtcValueGbp = currentBtcGbp !== null ? btcAccumulated * currentBtcGbp : null;
    const botPortfolioValueGbp = botBtcValueGbp !== null
      ? botBtcValueGbp + realizedProceedsGbp
      : null;
    const botRoiPct = (botPortfolioValueGbp !== null && grossInvestedGbp > 0.01)
      ? (botPortfolioValueGbp - grossInvestedGbp) / grossInvestedGbp
      : null;

    return json(200, {
      orders,
      stats: {
        filled_count: filledCount,
        // Per-order totals (semantics unchanged, kept for the orders table)
        total_bought_gbp: round2(totalBoughtGbp),
        total_sold_gbp: round2(totalSoldGbp),
        total_fees_gbp: round2(totalFeesGbp),
        btc_accumulated: roundBtc(btcAccumulated),
        // Bot-only portfolio view
        gross_invested_gbp: round2(grossInvestedGbp),
        realized_proceeds_gbp: round2(realizedProceedsGbp),
        net_invested_gbp: round2(netInvestedGbp),
        current_btc_gbp: currentBtcGbp,
        bot_btc_value_gbp: botBtcValueGbp !== null ? round2(botBtcValueGbp) : null,
        bot_portfolio_value_gbp: botPortfolioValueGbp !== null ? round2(botPortfolioValueGbp) : null,
        bot_roi_pct: botRoiPct,
      },
      partial_errors: Object.keys(errors).length > 0 ? errors : null,
    });
  } catch (err) {
    return json(500, { error: normalizeError(err) });
  }
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function roundBtc(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
