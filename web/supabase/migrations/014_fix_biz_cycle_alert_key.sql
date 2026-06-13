-- Fix alert-key mismatch: the application emits 'BIZ_CYCLE_SCORE' (the actual
-- signal field name) but migration 005 allowed 'CYCLE_SCORE' — a key no code
-- path ever produces. The signal_alert_events insert therefore violated
-- signal_alert_event_key_check whenever the business-cycle score changed,
-- aborting the alert step of every signal refresh on those days.

-- 1. Events table: replace the check constraint.
ALTER TABLE public.signal_alert_events
  DROP CONSTRAINT IF EXISTS signal_alert_event_key_check;

UPDATE public.signal_alert_events
  SET alert_key = 'BIZ_CYCLE_SCORE'
  WHERE alert_key = 'CYCLE_SCORE';

ALTER TABLE public.signal_alert_events
  ADD CONSTRAINT signal_alert_event_key_check CHECK (
    alert_key IN (
      'CORE_ON',
      'MACRO_ON',
      'PRICE_REGIME_ON',
      'VAL_SCORE',
      'LIQ_SCORE',
      'BIZ_CYCLE_SCORE',
      'DXY_SCORE'
    )
  );

-- 2. Subscriptions table: same rename in the allowed-keys array constraint,
--    migrating any legacy stored keys first.
ALTER TABLE public.signal_alert_subscriptions
  DROP CONSTRAINT IF EXISTS signal_alert_subscription_keys_check;

UPDATE public.signal_alert_subscriptions
  SET alert_keys = array_replace(alert_keys, 'CYCLE_SCORE', 'BIZ_CYCLE_SCORE')
  WHERE 'CYCLE_SCORE' = ANY(alert_keys);

ALTER TABLE public.signal_alert_subscriptions
  ADD CONSTRAINT signal_alert_subscription_keys_check CHECK (
    alert_keys <@ ARRAY[
      'CORE_ON',
      'MACRO_ON',
      'PRICE_REGIME_ON',
      'VAL_SCORE',
      'LIQ_SCORE',
      'BIZ_CYCLE_SCORE',
      'DXY_SCORE'
    ]::TEXT[]
  );
