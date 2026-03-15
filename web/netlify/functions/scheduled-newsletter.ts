import type { Config } from '@netlify/functions';
import { runAutomaticNewsletterSend } from './lib/newsletter';

interface ScheduledInvocationBody {
  next_run?: string;
}

export const config: Config = {
  schedule: '30 0 * * *',
};

async function readScheduledBody(request: Request): Promise<ScheduledInvocationBody> {
  try {
    return await request.json() as ScheduledInvocationBody;
  } catch {
    return {};
  }
}

export default async (request: Request): Promise<Response> => {
  try {
    const body = await readScheduledBody(request);
    const result = await runAutomaticNewsletterSend();
    const payload = {
      ok: true,
      scheduled_for: body.next_run ?? null,
      result,
    };

    console.log('[scheduled-newsletter]', JSON.stringify(payload));

    return new Response(JSON.stringify(payload), {
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
