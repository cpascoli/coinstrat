import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type Profile, type Tier } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  tier: Tier;
  isAdmin: boolean;
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
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const signedOutRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      console.error('[Auth] Failed to fetch profile:', error.message);
      return null;
    }
    return data as Profile;
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
    const p = await fetchProfile(session.user.id);
    if (p) setProfile(p);
  }, [session, fetchProfile]);

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
    user: session?.user ?? null,
    profile,
    tier: profile?.tier ?? 'free',
    isAdmin: profile?.is_admin ?? false,
    loading,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
