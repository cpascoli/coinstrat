import type { Config } from '@netlify/functions';
import { runScheduledAlertsWorkflow } from './lib/scheduledAlertsWorkflow';

interface ScheduledInvocationBody {
  next_run?: string;
}

export const config: Config = {
  schedule: '0 */4 * * *',
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
    const result = await runScheduledAlertsWorkflow(50);
    const payload = {
      ...result,
      scheduled_for: body.next_run ?? null,
    };

    console.log('[scheduled-alerts]', JSON.stringify(payload));

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduled-alerts]', error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
