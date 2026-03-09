import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { signalsStore } from './lib/store';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '', headers: corsHeaders() };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }), headers: corsHeaders() };
  }

  // Validate API key
  const apiKey = event.headers['x-api-key'];
  if (!apiKey) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing X-API-Key header. Upgrade to Pro for API access.' }),
    };
  }

  const { data: profile, error: dbErr } = await supabase
    .from('profiles')
    .select('id, tier, api_calls_today, api_calls_reset_at')
    .eq('api_key', apiKey)
    .single();

  if (dbErr || !profile) {
    return {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Invalid API key.' }),
    };
  }

  if (profile.tier === 'free') {
    return {
      statusCode: 403,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Signal history requires a Pro subscription.' }),
    };
  }

  // Simple daily rate limiting
  const dailyLimit = profile.tier === 'pro_plus' ? 10000 : 1000;
  const resetAt = new Date(profile.api_calls_reset_at);
  const now = new Date();
  let calls = profile.api_calls_today;

  if (now.toDateString() !== resetAt.toDateString()) {
    calls = 0;
    await supabase.from('profiles').update({
      api_calls_today: 1,
      api_calls_reset_at: now.toISOString(),
    }).eq('id', profile.id);
  } else {
    if (calls >= dailyLimit) {
      return {
        statusCode: 429,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: `Daily rate limit exceeded (${dailyLimit} calls/day). Resets at midnight UTC.`,
        }),
      };
    }
    await supabase.from('profiles').update({
      api_calls_today: calls + 1,
    }).eq('id', profile.id);
  }

  try {
    const store = signalsStore();
    const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;

    if (!cached?.data) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Signal cache not populated.' }),
      };
    }

    // Optional date range filtering
    const params = event.queryStringParameters || {};
    let results = cached.data as any[];

    if (params.from) {
      results = results.filter((d: any) => d.Date >= params.from!);
    }
    if (params.to) {
      results = results.filter((d: any) => d.Date <= params.to!);
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        count: results.length,
        data: results,
        cached_at: new Date(cached.timestamp).toISOString(),
      }),
    };
  } catch (err: any) {
    console.error('[signal-history]', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  };
}
