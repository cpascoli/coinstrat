import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import { runDailyNewsGeneration } from './lib/dailyNews';

/**
 * Background function (15-minute limit). Article + AI image generation routinely
 * exceeds the 60s synchronous and 30s scheduled function limits, so the heavy
 * work runs here. The client receives an immediate 202 and polls the database
 * for the published article.
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
    const result = await runDailyNewsGeneration();
    console.log('[daily-news-background]', JSON.stringify(result));
  } catch (err) {
    console.error('[daily-news-background]', err);
  }

  return { statusCode: 202, body: '' };
};
