import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import { runAutomaticNewsletterSend } from './lib/newsletter';

/**
 * Background function (15-minute limit). The weekly newsletter now composes a
 * hero illustration before sending, which (together with news sourcing + the
 * draft LLM call) exceeds the 30s scheduled-function limit, so the heavy work
 * runs here. The scheduled trigger receives an immediate 202.
 *
 * Auth: Bearer CRON_SECRET (scheduled trigger) or admin Supabase JWT.
 */
export const handler: Handler = async (event) => {
  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    console.warn('[newsletter-send-background] unauthorized invocation; skipping');
    return { statusCode: 202, body: '' };
  }

  try {
    const result = await runAutomaticNewsletterSend();
    console.log('[newsletter-send-background]', JSON.stringify(result));
  } catch (err) {
    console.error('[newsletter-send-background]', err);
  }

  return { statusCode: 202, body: '' };
};
