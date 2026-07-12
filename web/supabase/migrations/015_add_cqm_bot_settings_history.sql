-- CQM Bot settings history — append-only log of strategy-parameter changes.
--
-- The virtual ledger accrues one base deposit per cadence slot. Before this
-- table existed, the accrual used the *current* base amount for the whole
-- history, so raising the base retroactively inflated the virtual cash pile
-- (and the dynamic sizing rule's %-of-cash term would fire an oversized buy).
--
-- Every time the admin changes base_amount_gbp or frequency, a row is
-- appended here (see saveSettings in netlify/functions/lib/cqmBot.ts). The
-- ledger then accrues each slot's deposit at the settings in effect at that
-- slot's start time.
--
-- Access policy: RLS enabled with NO policies (default-deny), same as the
-- other cqm_bot_* tables. All access flows through admin-gated Netlify
-- functions using the service-role key.

CREATE TABLE IF NOT EXISTS public.cqm_bot_settings_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_amount_gbp   NUMERIC(18, 2) NOT NULL,
  frequency         TEXT NOT NULL
                      CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  effective_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cqm_bot_settings_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cqm_bot_settings_history_effective_at
  ON public.cqm_bot_settings_history (effective_at);

-- Seed: one row with the current settings, effective from the strategy's
-- first executed order (or from the settings row's creation when no orders
-- exist yet). This reproduces the pre-history ledger behavior exactly for
-- everything that already happened.
INSERT INTO public.cqm_bot_settings_history (base_amount_gbp, frequency, effective_at)
SELECT
  s.base_amount_gbp,
  s.frequency,
  COALESCE(
    (SELECT MIN(o.triggered_at) FROM public.cqm_bot_orders o
      WHERE o.coinbase_status IN ('filled', 'submitted', 'open')),
    s.created_at
  )
FROM public.cqm_bot_settings s
WHERE s.id = 1
  AND NOT EXISTS (SELECT 1 FROM public.cqm_bot_settings_history);
