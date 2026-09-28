import type { Handler } from '@netlify/functions';

import { authorizeAdminOrCron } from './lib/auth';
import { runCqmBotExecution, type ExecutionResult } from './lib/cqmBotExecutor';

/**
 * Background function (15-minute limit). The CQM fit plus the Coinbase
 * round-trip exceeds Netlify's 30s scheduled-function cap, so the trade runs
 * here. The scheduled trigger receives an immediate 202 and returns.
 *
 * Because the schedule fires daily but the bot may be configured weekly or
 * monthly, the frequency hard-guard inside `runCqmBotExecution` gates whether
 * a trade goes through on any given tick.
 *
 * Safety:
 *   - Pause toggle (`settings.enabled`) is the kill switch.
 *   - Frequency hard-guard prevents double trades within a cadence window —
 *     a manual admin trade earlier in the day defers the scheduled trade by
 *     a full cadence.
 *   - An execution lease (unique per frequency + execution_date) is acquired
 *     before fitCQM(), so overlapping invocations cannot both reach Coinbase.
 *
 * Auth: Bearer CRON_SECRET (scheduled trigger) or admin Supabase JWT.
 */
export const handler: Handler = async (event) => {
  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    console.warn('[scheduled-cqm-bot-background] unauthorized invocation; skipping');
    return { statusCode: 202, body: '' };
  }

  let nextRun: string | null = null;
  try {
    const parsed = event.body ? JSON.parse(event.body) as { next_run?: string } : null;
    nextRun = typeof parsed?.next_run === 'string' ? parsed.next_run : null;
  } catch {
    nextRun = null;
  }

  try {
    const result = await runCqmBotExecution({ source: 'scheduled' });
    console.log('[scheduled-cqm-bot-background]', JSON.stringify({
      scheduled_for: nextRun,
      ...summarize(result),
    }));
  } catch (err) {
    console.error('[scheduled-cqm-bot-background]', err);
  }

  return { statusCode: 202, body: '' };
};

function summarize(result: ExecutionResult): Record<string, unknown> {
  switch (result.kind) {
    case 'submitted':
      return {
        ok: true,
        action: 'submitted',
        coinbase_order_id: result.coinbase_order_id,
        coinbase_status: result.coinbase_status,
        order_row_id: (result.order as { id?: string })?.id ?? null,
        side: (result.order as { side?: string })?.side ?? null,
        target_amount_gbp: (result.order as { target_amount_gbp?: number })?.target_amount_gbp ?? null,
        cqm_risk: (result.order as { cqm_risk?: number })?.cqm_risk ?? null,
      };
    case 'skipped':
      return {
        ok: true,
        action: 'skipped',
        reason: result.reason,
        message: result.message,
        ...(result.details ?? {}),
      };
    case 'failed':
      return {
        ok: false,
        action: 'failed',
        message: result.message,
        order_row_id: result.order_row_id ?? null,
      };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
