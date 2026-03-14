DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE TABLE IF NOT EXISTS public.signal_alert_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  alert_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  unsubscribe_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_alert_subscription_keys_check CHECK (
    alert_keys <@ ARRAY[
      'CORE_ON',
      'MACRO_ON',
      'PRICE_REGIME_ON',
      'VAL_SCORE',
      'LIQ_SCORE',
      'CYCLE_SCORE',
      'DXY_SCORE'
    ]::TEXT[]
  )
);

ALTER TABLE public.signal_alert_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.signal_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  alert_key TEXT NOT NULL,
  signal_date DATE NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  row_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_alert_event_key_check CHECK (
    alert_key IN (
      'CORE_ON',
      'MACRO_ON',
      'PRICE_REGIME_ON',
      'VAL_SCORE',
      'LIQ_SCORE',
      'CYCLE_SCORE',
      'DXY_SCORE'
    )
  )
);

ALTER TABLE public.signal_alert_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.signal_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.signal_alert_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_alert_delivery_status_check CHECK (status IN ('sent', 'failed')),
  CONSTRAINT signal_alert_delivery_unique UNIQUE (event_id, user_id)
);

ALTER TABLE public.signal_alert_deliveries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_signal_alert_subscriptions_enabled
  ON public.signal_alert_subscriptions (enabled);

CREATE INDEX IF NOT EXISTS idx_signal_alert_subscriptions_email
  ON public.signal_alert_subscriptions (email);

CREATE INDEX IF NOT EXISTS idx_signal_alert_events_signal_date
  ON public.signal_alert_events (signal_date DESC);

CREATE INDEX IF NOT EXISTS idx_signal_alert_events_alert_key
  ON public.signal_alert_events (alert_key);

CREATE INDEX IF NOT EXISTS idx_signal_alert_deliveries_user_id
  ON public.signal_alert_deliveries (user_id);

CREATE INDEX IF NOT EXISTS idx_signal_alert_deliveries_email
  ON public.signal_alert_deliveries (email);

DROP TRIGGER IF EXISTS signal_alert_subscriptions_updated_at ON public.signal_alert_subscriptions;
CREATE TRIGGER signal_alert_subscriptions_updated_at
  BEFORE UPDATE ON public.signal_alert_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
