import type { HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export interface AdminIdentity {
  id: string;
  email: string | null;
}

type AuthResult =
  | { kind: 'cron' }
  | { kind: 'admin'; user: AdminIdentity };

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const cronSecret = process.env.CRON_SECRET;

export const serviceSupabase = createClient(supabaseUrl, serviceRoleKey);

const anonSupabase = createClient(supabaseUrl, supabaseAnonKey);

export function getBearerToken(event: HandlerEvent): string {
  const auth = event.headers.authorization ?? event.headers.Authorization ?? '';
  return auth.replace('Bearer ', '').trim();
}

export async function getAdminFromToken(token: string): Promise<AdminIdentity | null> {
  if (!token) return null;

  const {
    data: { user },
    error,
  } = await anonSupabase.auth.getUser(token);

  if (error || !user) return null;

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('is_admin, email')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) return null;

  return {
    id: user.id,
    email: profile.email ?? user.email ?? null,
  };
}

export async function authorizeAdminOrCron(event: HandlerEvent): Promise<AuthResult | null> {
  const token = getBearerToken(event);

  if (cronSecret && token === cronSecret) {
    return { kind: 'cron' };
  }

  const admin = await getAdminFromToken(token);
  if (!admin) return null;

  return { kind: 'admin', user: admin };
}

export async function requireAdmin(event: HandlerEvent): Promise<AdminIdentity | null> {
  const token = getBearerToken(event);
  return getAdminFromToken(token);
}
