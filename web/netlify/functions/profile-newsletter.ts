import type { Handler } from '@netlify/functions';
import { getBearerToken, getProfileByUserId, getUserFromToken } from './lib/auth';
import {
  getNewsletterSubscriptionPreference,
  setRegisteredUserNewsletterPreference,
} from './lib/newsletter';

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

  const profile = await getProfileByUserId(user.id, 'id, email');
  if (!profile?.email) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Profile email not found.' }),
    };
  }

  if (event.httpMethod === 'GET') {
    try {
      const preference = await getNewsletterSubscriptionPreference(profile.email);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: true, preference }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unable to load newsletter preference.',
        }),
      };
    }
  }

  if (event.httpMethod === 'PUT') {
    try {
      const body = JSON.parse(event.body || '{}');
      const preference = await setRegisteredUserNewsletterPreference(profile.email, Boolean(body.enabled));
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: true, preference }),
      };
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unable to update newsletter preference.',
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
