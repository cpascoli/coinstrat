/**
 * Scheduled CQM Risk DCA bot — runs every day at 00:00 UTC.
 *
 * Timing rationale: analysis of 9 quarters of Kraken hourly BTC data
 * (XBTUSD/XBTGBP) shows the daily low lands in the 00:00 UTC hour ~13-14% of
 * days — roughly 3x the uniform 4.2% baseline and by far the most common hour,
 * with a broader cheap band spanning 23:00-01:00 UTC. The pattern is stable
 * across 1-9 quarter lookbacks and holds on 6 of 7 weekdays (Sunday's low
 * shifts ~1h earlier to 23:00). Firing at midnight UTC therefore targets the
 * statistically cheapest part of the day for our BTC-GBP DCA. See
 * hour-analysis/ for the supporting scripts and charts.
 *
 * Behavior:
 *   - If the bot is paused (`cqm_bot_settings.enabled = false`)
 *       → skip (logged as "paused").
 *   - If we're inside the frequency window of the previous order (e.g. the
 *     bot is on weekly frequency and the last order was 3 days ago)
 *       → skip (logged as "frequency_guard").
 *   - Otherwise, run the exact same pipeline as the admin "Execute trade"
 *     button: recompute CQM Risk from cached signals, size the target,
 *     insert a pending row, submit a market BTC-GBP order, poll for fills,
 *     and persist the outcome to `cqm_bot_orders`.
 *
 * Because the schedule fires daily but the bot may be configured weekly or
 * monthly, the frequency hard-guard inside `runCqmBotExecution` is what
 * actually gates whether a trade goes through on any given cron tick. This
 * keeps the schedule simple (one cron, fires every day) while supporting
 * any DCA cadence the admin picks.
 *
 * Safety:
 *   - Pause toggle (`settings.enabled`) is the kill switch.
 *   - Frequency hard-guard prevents double trades within a cadence window —
 *     this also means a manual admin trade earlier in the day will defer
 *     the scheduled trade by a full cadence.
 *   - All decisions are made server-side from authoritative DB state and
 *     signed Coinbase responses; nothing about this function trusts caller
 *     input.
 *
 * The function returns 200 in all branches (including skips) so that the
 * Netlify scheduler treats it as a successful run. Failures of the trade
 * itself are recorded in `cqm_bot_orders` and surfaced in the Admin UI;
 * only an unexpected exception returns 500.
 */
import type { Config } from '@netlify/functions';

import { runCqmBotExecution, type ExecutionResult } from './lib/cqmBotExecutor';

interface ScheduledInvocationBody {
  next_run?: string;
}

export const config: Config = {
  // Every day at 00:00 UTC — statistically the cheapest hour for BTC.
  // Standard 5-field cron (m h dom mon dow); Netlify always interprets it as UTC.
  schedule: '0 0 * * *',
};

async function readScheduledBody(request: Request): Promise<ScheduledInvocationBody> {
  try {
    return (await request.json()) as ScheduledInvocationBody;
  } catch {
    return {};
  }
}

export default async (request: Request): Promise<Response> => {
  try {
    const body = await readScheduledBody(request);
    const result = await runCqmBotExecution({ source: 'scheduled' });

    const payload = {
      scheduled_for: body.next_run ?? null,
      ...summarize(result),
    };

    console.log('[scheduled-cqm-bot]', JSON.stringify(payload));

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduled-cqm-bot]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

/**
 * Flatten the ExecutionResult discriminated union into a log-friendly shape.
 * Keeping the fields stable makes it easy to search Netlify logs later.
 */
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
  }
}
