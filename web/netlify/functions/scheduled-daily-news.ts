import type { Config } from '@netlify/functions';

/**
 * Scheduled trigger (06:00 UTC). Scheduled functions are capped at 30s, which is
 * far too short for article + AI image generation, so this only fires the
 * background function (which has a 15-minute limit) and returns immediately.
 */
export const config: Config = {
  schedule: '0 6 * * *',
};

export default async (): Promise<Response> => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.VITE_APP_URL || '';
  const cronSecret = process.env.CRON_SECRET || '';

  try {
    if (!base) {
      throw new Error('Site URL (process.env.URL) is unavailable; cannot invoke background function.');
    }

    const res = await fetch(`${base}/.netlify/functions/daily-news-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ trigger: 'scheduled' }),
    });

    console.log('[scheduled-daily-news] triggered background function', res.status);

    return new Response(JSON.stringify({ ok: true, triggered: true, status: res.status }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduled-daily-news]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
