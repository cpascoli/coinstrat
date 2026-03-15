ALTER TABLE public.signal_alert_deliveries
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE public.user_strategy_alert_deliveries
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

UPDATE public.signal_alert_deliveries
SET attempt_count = 1
WHERE attempt_count = 0;

UPDATE public.user_strategy_alert_deliveries
SET attempt_count = 1
WHERE attempt_count = 0;

CREATE INDEX IF NOT EXISTS idx_signal_alert_deliveries_retry
  ON public.signal_alert_deliveries (status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_user_strategy_alert_deliveries_retry
  ON public.user_strategy_alert_deliveries (status, next_retry_at, created_at);
