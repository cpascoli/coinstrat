import type { Config } from '@netlify/functions';
import { refreshDerivativesCache } from './lib/derivativesCache';

interface ScheduledInvocationBody {
  next_run?: string;
}

export const config: Config = {
  schedule: '45 1 * * *',
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
    const result = await refreshDerivativesCache();
    const payload = {
      ...result,
      scheduled_for: body.next_run ?? null,
    };

    console.log('[scheduled-derivatives]', JSON.stringify(payload));

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduled-derivatives]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
