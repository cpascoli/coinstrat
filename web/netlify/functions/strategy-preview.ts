import type { Handler } from '@netlify/functions';
import { getBearerToken, getProfileFromToken, isPaidTier } from './lib/auth';
import { signalsStore } from './lib/store';
import { evaluateStrategy } from './lib/strategyEngine';
import { validateStrategySpec } from '../../src/lib/strategyBuilder';

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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
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
    const body = JSON.parse(event.body || '{}');
    const validation = validateStrategySpec(body.spec);
    if (!validation.ok) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: validation.errors.join(' ') }),
      };
    }

    const store = signalsStore();
    const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;
    const rows = Array.isArray(cached?.data) ? cached.data : [];
    if (rows.length === 0) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Signal cache not populated.' }),
      };
    }

    const preview = evaluateStrategy(rows, body.spec);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        preview: {
          ...preview,
          rows: preview.rows.slice(-365),
          transitions: preview.transitions.slice(-50),
        },
        cached_at: cached?.timestamp ? new Date(cached.timestamp).toISOString() : null,
      }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unable to preview strategy.',
      }),
    };
  }
};
