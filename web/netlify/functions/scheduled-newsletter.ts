import type { Config } from '@netlify/functions';

/**
 * Scheduled trigger (00:30 UTC). Scheduled functions are capped at 30s, which is
 * too short for the weekly compose (news sourcing + draft LLM + AI hero image) and
 * send, so this only fires the background function (15-minute limit) and returns
 * immediately.
 */
export const config: Config = {
  schedule: '30 0 * * *',
};

export default async (): Promise<Response> => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.VITE_APP_URL || '';
  const cronSecret = process.env.CRON_SECRET || '';

  try {
    if (!base) {
      throw new Error('Site URL (process.env.URL) is unavailable; cannot invoke background function.');
    }

    const res = await fetch(`${base}/.netlify/functions/newsletter-send-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ trigger: 'scheduled' }),
    });

    console.log('[scheduled-newsletter] triggered background function', res.status);

    return new Response(JSON.stringify({ ok: true, triggered: true, status: res.status }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduled-newsletter]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
