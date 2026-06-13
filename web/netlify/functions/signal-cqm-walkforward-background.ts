import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import {
  computeAndStoreWalkForward,
  extendAndStoreWalkForward,
} from './lib/cqmWalkForwardCache';

/**
 * Background function (15-minute limit) that maintains the `cqm_walkforward`
 * blob (date → causal CQM risk).
 *
 * By default it runs an INCREMENTAL extension: it reuses the cached map and
 * only scores days newer than the last cached date (one causal refit + a few
 * scorings, ~seconds). A FULL rebuild — the ~3 min expanding-window seed over
 * ~11 years — runs only when no cache exists yet or when explicitly requested
 * with `{ "rebuild": true }` / `?rebuild=1`. The full pass can exceed slow
 * runtime budgets, so prefer seeding the blob out-of-band and letting the
 * daily incremental keep it current.
 *
 * Triggered automatically after a signal refresh appends new rows.
 *
 * Auth: Bearer CRON_SECRET (scheduled/refresh trigger) or admin Supabase JWT.
 */
export const handler: Handler = async (event) => {
  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    console.warn('[signal-cqm-walkforward-background] unauthorized invocation; skipping');
    return { statusCode: 202, body: '' };
  }

  const rebuild =
    event.queryStringParameters?.rebuild === '1' ||
    (() => {
      try {
        return JSON.parse(event.body || '{}')?.rebuild === true;
      } catch {
        return false;
      }
    })();

  try {
    const result = rebuild
      ? await computeAndStoreWalkForward()
      : await extendAndStoreWalkForward();
    console.log('[signal-cqm-walkforward-background]', JSON.stringify(result));
  } catch (err) {
    console.error('[signal-cqm-walkforward-background]', err);
  }

  return { statusCode: 202, body: '' };
};
