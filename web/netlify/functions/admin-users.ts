import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Admin endpoint for user management.
 * Protected by checking the caller's Supabase JWT for is_admin = true.
 */
export const handler: Handler = async (event) => {
  // Extract the user's JWT from the Authorization header
  const authHeader = event.headers['authorization'] ?? '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token' }) };
  }

  // Verify the caller is an admin
  const clientWithAuth = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error: authErr } = await clientWithAuth.auth.getUser(token);
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!callerProfile?.is_admin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  if (event.httpMethod === 'GET') {
    const { data: users, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ users }),
    };
  }

  if (event.httpMethod === 'PUT') {
    const { userId, tier } = JSON.parse(event.body || '{}');
    if (!userId || !tier) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or tier' }) };
    }

    const { error } = await supabase
      .from('profiles')
      .update({ tier })
      .eq('id', userId);

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
