/**
 * Scheduled CQM Risk DCA bot — fires every day at 07:00 UTC.
 *
 * Timing note: analysis of 9 quarters of Kraken hourly BTC data (XBTUSD/XBTGBP)
 * found the daily low lands most often in the 00:00 UTC hour (~13-14% of days,
 * ~3x the uniform 4.2% baseline, with a cheap band spanning 23:00-01:00 UTC);
 * see hour-analysis/ for the supporting scripts and charts. The run time is
 * nonetheless set to 07:00 UTC for operational reasons; the price edge from the
 * cheapest hour is small relative to the dynamic-sizing decision, so execution
 * time is treated as an operational choice rather than an alpha source.
 *
 * Scheduled functions are hard-capped at 30s. Cold start plus `fitCQM()` on the
 * signal history already consumes that budget (the 27 Sep 2026 run was killed
 * during the fit, and the 25 Sep run was killed after Coinbase had filled).
 * This function only starts `scheduled-cqm-bot-background` (15-minute limit)
 * and returns. The trade pipeline, pause guard, and execution lease live there.
 */
import type { Config } from '@netlify/functions';

export const config: Config = {
  // Every day at 07:00 UTC.
  // Standard 5-field cron (m h dom mon dow); Netlify always interprets it as UTC.
  schedule: '0 7 * * *',
};

interface ScheduledInvocationBody {
  next_run?: string;
}

async function readScheduledBody(request: Request): Promise<ScheduledInvocationBody> {
  try {
    return (await request.json()) as ScheduledInvocationBody;
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
    const res = await fetch(`${base}/.netlify/functions/scheduled-cqm-bot-background`, {
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

    console.log('[scheduled-cqm-bot] triggered background function', res.status);

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
    console.error('[scheduled-cqm-bot]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
