/**
 * POST /api/admin/cqm-bot/execute — admin-only manual trigger for the CQM
 * Risk DCA bot.
 *
 * Body: { confirm: true }   (any other value is rejected — a safety net so
 *                            stray clicks or scripts can't fire a market
 *                            order)
 *
 * The actual trade-execution pipeline (pause guard → frequency hard guard →
 * CQM Risk → target sizing → BTC-GBP price → pending row → market order →
 * poll for fills → persist outcome) lives in `lib/cqmBotExecutor.ts`, so
 * this endpoint and the scheduled cron (`scheduled-cqm-bot.ts`) run the
 * same code path. The only differences here are the admin auth gate, the
 * explicit `confirm` flag, and the HTTP status mapping for the result.
 */
import type { Handler } from '@netlify/functions';

import { requireAdmin } from './lib/auth';
import { runCqmBotExecution, type ExecutionResult } from './lib/cqmBotExecutor';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const admin = await requireAdmin(event);
  if (!admin) return json(401, { error: 'Admin access required' });

  let body: any = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  if (body?.confirm !== true) {
    return json(400, { error: 'Missing { confirm: true } in body' });
  }

  const result = await runCqmBotExecution({ source: 'admin_manual' });
  return resultToResponse(result);
};

function resultToResponse(result: ExecutionResult) {
  switch (result.kind) {
    case 'submitted':
      return json(200, {
        order: result.order,
        coinbase_status: result.coinbase_status,
        coinbase_order_id: result.coinbase_order_id,
      });
    case 'skipped':
      // 409 = "request can't be completed in the current state" — same
      // status the previous implementation returned for guard violations.
      return json(409, {
        error: result.message,
        skip_reason: result.reason,
        ...(result.details ?? {}),
      });
    case 'failed':
      return json(502, {
        error: result.message,
        order_row_id: result.order_row_id,
      });
  }
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
