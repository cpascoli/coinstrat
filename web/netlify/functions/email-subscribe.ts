import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, source } = JSON.parse(event.body || '{}');

    if (!email || !email.includes('@')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Valid email required.' }) };
    }

    const { error } = await supabase
      .from('email_subscribers')
      .upsert(
        { email: email.toLowerCase().trim(), source: source || 'landing_page', subscribed_at: new Date().toISOString(), unsubscribed_at: null },
        { onConflict: 'email' },
      );

    if (error) {
      console.error('[email-subscribe]', error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to subscribe.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err: any) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
