import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import { runFrontPageGeneration } from './lib/frontPage';

/**
 * Background function (15-minute limit). Four section writers plus an editor
 * pass and the market hero image routinely exceed the 60s gateway, so the
 * scheduled trigger kicks this function and the Admin UI polls `news_runs`.
 *
 * Auth: Bearer CRON_SECRET (scheduled trigger) or admin Supabase JWT (Admin UI).
 */
export const handler: Handler = async (event) => {
  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    console.warn('[daily-news-background] unauthorized invocation; skipping');
    return { statusCode: 202, body: '' };
  }

  try {
    const result = await runFrontPageGeneration({ trigger: auth.kind === 'cron' ? 'scheduled' : 'admin' });
    console.log('[daily-news-background]', JSON.stringify(result));
  } catch (err) {
    console.error('[daily-news-background]', err);
  }

  return { statusCode: 202, body: '' };
};
