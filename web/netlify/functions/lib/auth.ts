import type { HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

export interface AdminIdentity {
  id: string;
  email: string | null;
}

export type AppTier = 'free' | 'pro' | 'pro_plus' | 'lifetime';

export interface AuthenticatedProfile {
  id: string;
  email: string | null;
  tier: AppTier;
  is_admin: boolean;
  api_key?: string | null;
  stripe_customer_id?: string | null;
  api_calls_today?: number | null;
  api_calls_reset_at?: string | null;
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

export function isPaidTier(tier: string | null | undefined): boolean {
  return tier === 'pro' || tier === 'pro_plus' || tier === 'lifetime';
}

export function getBearerToken(event: HandlerEvent): string {
  const auth = event.headers.authorization ?? event.headers.Authorization ?? '';
  return auth.replace('Bearer ', '').trim();
}

export async function getUserFromToken(token: string): Promise<User | null> {
  if (!token) return null;

  const {
    data: { user },
    error,
  } = await anonSupabase.auth.getUser(token);

  if (error || !user) return null;
  return user;
}

export async function getProfileByUserId(
  userId: string,
  select = 'id, email, tier, is_admin, api_key, stripe_customer_id, api_calls_today, api_calls_reset_at',
): Promise<AuthenticatedProfile | null> {
  if (!userId) return null;

  const { data, error } = await serviceSupabase
    .from('profiles')
    .select(select)
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as AuthenticatedProfile;
}

export async function getProfileFromToken(
  token: string,
  select = 'id, email, tier, is_admin, api_key, stripe_customer_id, api_calls_today, api_calls_reset_at',
): Promise<AuthenticatedProfile | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;
  return getProfileByUserId(user.id, select);
}

export async function getAdminFromToken(token: string): Promise<AdminIdentity | null> {
  const user = await getUserFromToken(token);
  if (!user) return null;

  const profile = await getProfileByUserId(user.id, 'is_admin, email');

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
