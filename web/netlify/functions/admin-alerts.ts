import type { Handler } from '@netlify/functions';
import { requireAdmin } from './lib/auth';
import { getScheduledAlertsStatus, runScheduledAlertsWorkflow } from './lib/scheduledAlertsWorkflow';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  const admin = await requireAdmin(event);
  if (!admin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required.' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const status = await getScheduledAlertsStatus(50);
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, status }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const result = await runScheduledAlertsWorkflow(50);
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err: any) {
    console.error('[admin-alerts]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
