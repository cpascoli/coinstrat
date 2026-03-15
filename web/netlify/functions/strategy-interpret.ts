import type { Handler } from '@netlify/functions';
import { getBearerToken, getProfileFromToken, isPaidTier } from './lib/auth';
import { buildStrategyRegistry } from './lib/strategyEngine';
import { interpretStrategyPrompt } from './lib/strategyLlm';

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
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const interpreted = await interpretStrategyPrompt(prompt);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        provider: interpreted.provider,
        warnings: interpreted.warnings,
        spec: interpreted.spec,
        registry: buildStrategyRegistry(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unable to interpret strategy prompt.',
        registry: buildStrategyRegistry(),
      }),
    };
  }
};
