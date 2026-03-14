import type { Handler } from '@netlify/functions';
import { unsubscribeSignalAlerts } from './lib/signalAlerts';

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

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const token = event.httpMethod === 'GET'
      ? event.queryStringParameters?.token ?? ''
      : JSON.parse(event.body || '{}').token ?? '';

    const email = await unsubscribeSignalAlerts(String(token));
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, email }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unable to unsubscribe alert emails.',
      }),
    };
  }
};
