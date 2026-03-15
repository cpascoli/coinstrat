import type { Handler } from '@netlify/functions';
import { getBearerToken, getProfileFromToken, isPaidTier } from './lib/auth';
import {
  countUserStrategies,
  deleteUserStrategy,
  getStrategyById,
  listUserStrategies,
  saveUserStrategy,
} from './lib/strategyStore';
import { validateStrategySpec } from '../../src/lib/strategyBuilder';

const MAX_STRATEGIES_PER_USER = 10;

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const token = getBearerToken(event);
  const profile = await getProfileFromToken(token, 'id, email, tier');
  if (!profile) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Sign in required.' }),
    };
  }
  if (!isPaidTier(profile.tier)) {
    return {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Signal Builder is a Pro feature.' }),
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      const strategies = await listUserStrategies(profile.id);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: true, strategies }),
      };
    }

    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      if (typeof body.strategyId !== 'string' || !body.strategyId) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'strategyId is required.' }),
        };
      }
      await deleteUserStrategy(body.strategyId, profile.id);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: true }),
      };
    }

    if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
      return {
        statusCode: 405,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const validation = validateStrategySpec(body.spec);
    if (!validation.ok) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: validation.errors.join(' ') }),
      };
    }

    const strategyId = typeof body.strategyId === 'string' ? body.strategyId : undefined;
    if (!strategyId) {
      const currentCount = await countUserStrategies(profile.id);
      if (currentCount >= MAX_STRATEGIES_PER_USER) {
        return {
          statusCode: 403,
          headers: corsHeaders(),
          body: JSON.stringify({ error: `You can save up to ${MAX_STRATEGIES_PER_USER} custom strategies.` }),
        };
      }
    } else {
      const existing = await getStrategyById(strategyId);
      if (!existing || existing.user_id !== profile.id) {
        return {
          statusCode: 404,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'Strategy not found.' }),
        };
      }
    }

    const strategy = await saveUserStrategy({
      strategyId,
      userId: profile.id,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : body.spec.name,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : body.spec.description,
      prompt: typeof body.prompt === 'string' ? body.prompt : body.spec.prompt,
      status: body.status === 'active' || body.status === 'draft' || body.status === 'paused' || body.status === 'invalid'
        ? body.status
        : 'draft',
      spec: body.spec,
      alertEnabled: Boolean(body.alertEnabled),
      alertMode: body.alertMode === 'disabled' || body.alertMode === 'state_change' || body.alertMode === 'turns_on' || body.alertMode === 'turns_off'
        ? body.alertMode
        : 'state_change',
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, strategy }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unable to save strategy.',
      }),
    };
  }
};
