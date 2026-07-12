/**
 * /api/admin/cqm-bot/deposits — admin-only.
 *
 * Manages the strategy's lump deposits (`public.cqm_bot_deposits`): explicit
 * capital injections into the virtual ledger, on top of the per-cadence-slot
 * base-amount drip. Adding a deposit makes that cash visible to the dynamic
 * sizing rule's %-of-idle-cash term from `deposited_at` onward.
 *
 *   GET    → { deposits: [...], total_gbp }
 *   POST   → { amount_gbp: number, note?: string } — adds a deposit (negative
 *            amounts withdraw idle cash from the mandate)
 *   DELETE → ?id=<uuid> — removes a deposit row (for correcting mistakes)
 *
 * Amounts are virtual mandate funding, not transfers: the admin must ensure
 * the corresponding GBP actually exists on the Coinbase account, or buys
 * sized against the inflated ledger cash will fail at submission.
 */
import type { Handler } from '@netlify/functions';

import { requireAdmin } from './lib/auth';
import { addLumpDeposit, deleteLumpDeposit, listLumpDeposits } from './lib/cqmBot';

export const handler: Handler = async (event) => {
  const admin = await requireAdmin(event);
  if (!admin) return json(401, { error: 'Admin access required' });

  try {
    switch (event.httpMethod) {
      case 'GET': {
        const deposits = await listLumpDeposits();
        const totalGbp = deposits.reduce((sum, d) => sum + d.amount_gbp, 0);
        return json(200, { deposits, total_gbp: Math.round(totalGbp * 100) / 100 });
      }

      case 'POST': {
        let body: { amount_gbp?: unknown; note?: unknown } = {};
        try {
          body = event.body ? JSON.parse(event.body) : {};
        } catch {
          return json(400, { error: 'Invalid JSON body' });
        }
        const amount = Number(body.amount_gbp);
        if (!Number.isFinite(amount) || amount === 0) {
          return json(400, { error: 'amount_gbp must be a non-zero number' });
        }
        const note = typeof body.note === 'string' && body.note.trim().length > 0
          ? body.note.trim()
          : undefined;
        const deposit = await addLumpDeposit({ amountGbp: amount, note });
        return json(200, { deposit });
      }

      case 'DELETE': {
        const id = event.queryStringParameters?.id;
        if (!id) return json(400, { error: 'id query parameter is required' });
        await deleteLumpDeposit(id);
        return json(200, { ok: true });
      }

      default:
        return json(405, { error: 'Method not allowed' });
    }
  } catch (err: any) {
    return json(500, { error: err?.message ?? 'CQM bot deposits request failed' });
  }
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
