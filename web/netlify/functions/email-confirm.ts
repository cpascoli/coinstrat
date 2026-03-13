import type { Handler } from '@netlify/functions';
import { confirmNewsletterSubscription } from './lib/newsletter';

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const token = event.queryStringParameters?.token ?? '';
    if (!token) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Missing confirmation token.' }),
      };
    }

    const email = await confirmNewsletterSubscription(token);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, email }),
    };
  } catch (err: any) {
    console.error('[email-confirm]', err);
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message ?? 'Unable to confirm subscription.' }),
    };
  }
};
