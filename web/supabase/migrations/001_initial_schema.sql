-- CoinStrat Pro — Initial Schema
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)

-- 1. Profiles table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email        TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'free'
                 CHECK (tier IN ('free', 'pro', 'pro_plus')),
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  api_key      TEXT UNIQUE,
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  api_calls_today       INTEGER NOT NULL DEFAULT 0,
  api_calls_reset_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update limited fields on their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role (webhooks, admin functions) bypasses RLS automatically

-- 2. Email subscribers (newsletter-only, no account required)
CREATE TABLE public.email_subscribers (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  subscribed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  source         TEXT DEFAULT 'landing_page'
);

ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;

-- No public access — managed only via service role (Netlify Functions)

-- 3. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, api_key)
  VALUES (
    NEW.id,
    NEW.email,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Indexes for fast lookups
CREATE INDEX idx_profiles_api_key ON public.profiles (api_key);
CREATE INDEX idx_profiles_stripe_customer ON public.profiles (stripe_customer_id);
CREATE INDEX idx_profiles_tier ON public.profiles (tier);
CREATE INDEX idx_email_subscribers_email ON public.email_subscribers (email);

-- 5. Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
