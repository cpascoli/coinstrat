CREATE TABLE IF NOT EXISTS public.user_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'invalid')),
  active_version_id UUID,
  last_previewed_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ,
  latest_signal_value SMALLINT CHECK (latest_signal_value IN (0, 1)),
  latest_signal_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.user_strategies(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL DEFAULT '',
  spec_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_strategies
  DROP CONSTRAINT IF EXISTS user_strategies_active_version_id_fkey;

ALTER TABLE public.user_strategies
  ADD CONSTRAINT user_strategies_active_version_id_fkey
  FOREIGN KEY (active_version_id) REFERENCES public.user_strategy_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.user_strategy_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL UNIQUE REFERENCES public.user_strategies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'state_change'
    CHECK (mode IN ('disabled', 'state_change', 'turns_on', 'turns_off')),
  unsubscribe_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_strategy_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.user_strategies(id) ON DELETE CASCADE,
  strategy_version_id UUID NOT NULL REFERENCES public.user_strategy_versions(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latest_signal_value SMALLINT CHECK (latest_signal_value IN (0, 1)),
  latest_signal_date DATE,
  transition_count INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  preview_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.user_strategy_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.user_strategies(id) ON DELETE CASCADE,
  strategy_version_id UUID NOT NULL REFERENCES public.user_strategy_versions(id) ON DELETE CASCADE,
  signal_date DATE NOT NULL,
  previous_value SMALLINT NOT NULL CHECK (previous_value IN (0, 1)),
  new_value SMALLINT NOT NULL CHECK (new_value IN (0, 1)),
  event_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_strategy_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.user_strategy_alert_events(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES public.user_strategies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed')),
  sent_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_strategy_alert_deliveries_unique UNIQUE (event_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_user_strategies_user_id
  ON public.user_strategies (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_strategies_status
  ON public.user_strategies (status);

CREATE INDEX IF NOT EXISTS idx_user_strategy_versions_strategy_id
  ON public.user_strategy_versions (strategy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_strategy_alerts_user_id
  ON public.user_strategy_alerts (user_id);

CREATE INDEX IF NOT EXISTS idx_user_strategy_alerts_enabled
  ON public.user_strategy_alerts (enabled);

CREATE INDEX IF NOT EXISTS idx_user_strategy_evaluations_strategy_id
  ON public.user_strategy_evaluations (strategy_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_strategy_alert_events_strategy_id
  ON public.user_strategy_alert_events (strategy_id, signal_date DESC);

CREATE INDEX IF NOT EXISTS idx_user_strategy_alert_deliveries_strategy_id
  ON public.user_strategy_alert_deliveries (strategy_id, created_at DESC);

ALTER TABLE public.user_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_strategy_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_strategy_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_strategy_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_strategy_alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own strategies" ON public.user_strategies;
CREATE POLICY "Users can view own strategies"
  ON public.user_strategies
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own strategies" ON public.user_strategies;
CREATE POLICY "Users can create own strategies"
  ON public.user_strategies
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own strategies" ON public.user_strategies;
CREATE POLICY "Users can update own strategies"
  ON public.user_strategies
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own strategies" ON public.user_strategies;
CREATE POLICY "Users can delete own strategies"
  ON public.user_strategies
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own strategy versions" ON public.user_strategy_versions;
CREATE POLICY "Users can view own strategy versions"
  ON public.user_strategy_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_strategies s
      WHERE s.id = strategy_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can manage own strategy alerts" ON public.user_strategy_alerts;
CREATE POLICY "Users can manage own strategy alerts"
  ON public.user_strategy_alerts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own strategy evaluations" ON public.user_strategy_evaluations;
CREATE POLICY "Users can view own strategy evaluations"
  ON public.user_strategy_evaluations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_strategies s
      WHERE s.id = strategy_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own strategy alert events" ON public.user_strategy_alert_events;
CREATE POLICY "Users can view own strategy alert events"
  ON public.user_strategy_alert_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_strategies s
      WHERE s.id = strategy_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own strategy alert deliveries" ON public.user_strategy_alert_deliveries;
CREATE POLICY "Users can view own strategy alert deliveries"
  ON public.user_strategy_alert_deliveries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_strategies s
      WHERE s.id = strategy_id
        AND s.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS user_strategies_updated_at ON public.user_strategies;
CREATE TRIGGER user_strategies_updated_at
  BEFORE UPDATE ON public.user_strategies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS user_strategy_alerts_updated_at ON public.user_strategy_alerts;
CREATE TRIGGER user_strategy_alerts_updated_at
  BEFORE UPDATE ON public.user_strategy_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
