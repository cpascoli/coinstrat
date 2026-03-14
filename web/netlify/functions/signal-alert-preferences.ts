import type { Handler } from '@netlify/functions';
import { getBearerToken, getProfileByUserId, getUserFromToken, isPaidTier } from './lib/auth';
import { getSignalAlertPreferences, saveSignalAlertPreferences } from './lib/signalAlerts';

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
  const user = await getUserFromToken(token);
  if (!user) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Sign in required.' }),
    };
  }

  const profile = await getProfileByUserId(user.id, 'id, email, tier');
  if (!profile) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Profile not found.' }),
    };
  }

  if (event.httpMethod === 'GET') {
    try {
      const preferences = await getSignalAlertPreferences(user.id);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          ok: true,
          tier: profile.tier,
          eligible: isPaidTier(profile.tier),
          preferences: {
            enabled: preferences?.enabled ?? false,
            alertKeys: preferences?.alert_keys ?? [],
          },
        }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unable to load alert preferences.',
        }),
      };
    }
  }

  if (event.httpMethod === 'PUT') {
    if (!isPaidTier(profile.tier)) {
      return {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Signal alerts require a Pro or Lifetime subscription.' }),
      };
    }

    try {
      const body = JSON.parse(event.body || '{}');
      const preferences = await saveSignalAlertPreferences(user.id, {
        enabled: body.enabled,
        alertKeys: body.alertKeys,
      });

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          ok: true,
          tier: profile.tier,
          eligible: true,
          preferences: {
            enabled: preferences.enabled,
            alertKeys: preferences.alert_keys,
          },
        }),
      };
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unable to save alert preferences.',
        }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: corsHeaders(),
    body: JSON.stringify({ error: 'Method not allowed' }),
  };
};
