import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type Profile, type Tier } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  tier: Tier;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isVerified: boolean;
  hasFreeAccess: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  tier: 'free',
  isAdmin: false,
  isAuthenticated: false,
  isVerified: false,
  hasFreeAccess: false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAuthProvider(user: User | null): string | null {
  const provider = user?.app_metadata?.provider;
  return typeof provider === 'string' && provider.trim() ? provider : null;
}

function isVerifiedUser(user: User | null): boolean {
  if (!user) return false;
  const provider = getAuthProvider(user);
  if (provider && provider !== 'email') return true;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const signedOutRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;

    let lastError: string | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (data) {
        return data as Profile;
      }

      if (error) {
        lastError = error.message;
      }

      if (attempt < 3) {
        await wait(400 * (attempt + 1));
      }
    }

    if (lastError) {
      console.error('[Auth] Failed to fetch profile:', lastError);
    } else {
      console.warn('[Auth] Profile not yet provisioned for user:', userId);
    }

    return null;
  }, []);

  // 1. Bootstrap session from localStorage, then listen for changes.
  //    The callback must stay synchronous — Supabase holds an internal
  //    session lock while it runs, so any supabase.from() call inside
  //    it will deadlock the auth client and block session restoration.
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (!s) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        if (signedOutRef.current) {
          if (event === 'SIGNED_IN') {
            signedOutRef.current = false;
          } else {
            return;
          }
        }
        setSession(s);
        if (!s) {
          setProfile(null);
          setLoading(false);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  // 2. Fetch profile whenever the authenticated user changes.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    setLoading(true);

    let cancelled = false;
    fetchProfile(userId).then((p) => {
      if (!cancelled) {
        setProfile(p);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [session?.user?.id, fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try {
      const p = await fetchProfile(session.user.id);
      setProfile(p);
    } finally {
      setLoading(false);
    }
  }, [session, fetchProfile]);

  const user = session?.user ?? null;
  const isAuthenticated = Boolean(user);
  const isVerified = isVerifiedUser(user);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    signedOutRef.current = true;
    setSession(null);
    setProfile(null);
    supabase.auth.signOut().catch((err) => {
      console.error('[Auth] signOut error:', err);
    });
  }, []);

  const value: AuthState = {
    session,
    user,
    profile,
    tier: profile?.tier ?? 'free',
    isAdmin: profile?.is_admin ?? false,
    isAuthenticated,
    isVerified,
    hasFreeAccess: isAuthenticated && isVerified,
    loading,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
