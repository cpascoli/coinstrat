import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import { runScheduledAlertsWorkflow } from './lib/scheduledAlertsWorkflow';

/**
 * Background function (15-minute limit). Signal refresh + alert delivery
 * routinely exceeds Netlify's 30s scheduled-function hard cap (and often the
 * 60s sync cap once deliveries are included), so the heavy work runs here.
 * The scheduled trigger receives an immediate 202 and returns.
 *
 * Auth: Bearer CRON_SECRET (scheduled trigger) or admin Supabase JWT.
 */
export const handler: Handler = async (event) => {
  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    console.warn('[scheduled-alerts-background] unauthorized invocation; skipping');
    return { statusCode: 202, body: '' };
  }

  let nextRun: string | null = null;
  try {
    const parsed = event.body ? JSON.parse(event.body) as { next_run?: string; trigger?: string } : null;
    nextRun = typeof parsed?.next_run === 'string' ? parsed.next_run : null;
  } catch {
    nextRun = null;
  }

  try {
    const result = await runScheduledAlertsWorkflow(50);
    console.log(
      '[scheduled-alerts-background]',
      JSON.stringify({ ...result, scheduled_for: nextRun }),
    );
  } catch (err) {
    console.error('[scheduled-alerts-background]', err);
  }

  return { statusCode: 202, body: '' };
};
