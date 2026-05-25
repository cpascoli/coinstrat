/**
 * PUT /api/admin/cqm-bot/settings — admin-only.
 *
 * Upserts the singleton row in `public.cqm_bot_settings` with the strategy
 * parameters from the Admin Dashboard.
 *
 * Body: { base_amount_gbp?: number, frequency?: 'daily'|'weekly'|'monthly', enabled?: boolean }
 *
 * Validation:
 *   - base_amount_gbp must be > 0; otherwise the previous value is kept.
 *   - frequency must be one of the three allowed values; otherwise rejected.
 *
 * The function intentionally does NOT submit any trades — it just updates
 * the configuration that the execute function will read on its next run.
 */
import type { Handler } from '@netlify/functions';

import { requireAdmin } from './lib/auth';
import { loadSettings, saveSettings, type BotFrequency } from './lib/cqmBot';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const admin = await requireAdmin(event);
    if (!admin) return json(401, { error: 'Admin access required' });
    return json(200, { settings: await loadSettings() });
  }

  if (event.httpMethod !== 'PUT') {
    return json(405, { error: 'Method not allowed' });
  }

  const admin = await requireAdmin(event);
  if (!admin) return json(401, { error: 'Admin access required' });

  let body: any = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const patch: {
    base_amount_gbp?: number;
    frequency?: BotFrequency;
    enabled?: boolean;
  } = {};

  if (body.base_amount_gbp !== undefined) {
    const n = Number(body.base_amount_gbp);
    if (!Number.isFinite(n) || n <= 0) {
      return json(400, { error: 'base_amount_gbp must be a positive number' });
    }
    patch.base_amount_gbp = n;
  }

  if (body.frequency !== undefined) {
    if (body.frequency !== 'daily' && body.frequency !== 'weekly' && body.frequency !== 'monthly') {
      return json(400, { error: "frequency must be 'daily', 'weekly', or 'monthly'" });
    }
    patch.frequency = body.frequency;
  }

  if (typeof body.enabled === 'boolean') {
    patch.enabled = body.enabled;
  }

  try {
    const settings = await saveSettings(patch);
    return json(200, { settings });
  } catch (err: any) {
    return json(500, { error: err?.message ?? 'Failed to save settings' });
  }
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
