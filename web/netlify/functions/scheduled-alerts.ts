import type { Config } from '@netlify/functions';

/**
 * Scheduled trigger (every 4 hours). Scheduled functions are hard-capped at 30s,
 * which is too short for incremental signal refresh + alert delivery (~25s+),
 * so this only fires the background function (15-minute limit) and returns
 * immediately — same pattern as scheduled-newsletter / scheduled-daily-news.
 */
export const config: Config = {
  schedule: '0 */4 * * *',
};

interface ScheduledInvocationBody {
  next_run?: string;
}

async function readScheduledBody(request: Request): Promise<ScheduledInvocationBody> {
  try {
    return await request.json() as ScheduledInvocationBody;
  } catch {
    return {};
  }
}

export default async (request: Request): Promise<Response> => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.VITE_APP_URL || '';
  const cronSecret = process.env.CRON_SECRET || '';

  try {
    if (!base) {
      throw new Error('Site URL (process.env.URL) is unavailable; cannot invoke background function.');
    }

    const body = await readScheduledBody(request);
    const res = await fetch(`${base}/.netlify/functions/scheduled-alerts-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        trigger: 'scheduled',
        next_run: body.next_run ?? null,
      }),
    });

    console.log('[scheduled-alerts] triggered background function', res.status);

    return new Response(
      JSON.stringify({
        ok: true,
        triggered: true,
        status: res.status,
        scheduled_for: body.next_run ?? null,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduled-alerts]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
