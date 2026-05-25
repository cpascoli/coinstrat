-- CQM Risk DCA Bot — admin-only tables
--
-- Two tables back the Admin Dashboard "CQM Bot" panel:
--   1. cqm_bot_settings: singleton row (id = 1) holding the strategy parameters
--      the admin tunes from the UI (base GBP amount, frequency).
--   2. cqm_bot_orders: append-only log of every market BTC-GBP order submitted
--      by the bot, with the CQM Risk that drove the trade and the Coinbase
--      execution outcome.
--
-- Access policy: RLS is enabled on both tables and NO policies are created.
-- This is intentional default-deny. All access flows through admin-gated
-- Netlify Functions that use the service-role key (same pattern as
-- admin-users.ts and signal_alert_* tables). PostgREST clients (anon /
-- authenticated) cannot read or write these tables, so the strategy
-- parameters and order history remain admin-only.

CREATE TABLE IF NOT EXISTS public.cqm_bot_settings (
  id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_amount_gbp   NUMERIC(18, 2) NOT NULL DEFAULT 100,
  frequency         TEXT NOT NULL DEFAULT 'daily'
                       CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cqm_bot_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER cqm_bot_settings_updated_at
  BEFORE UPDATE ON public.cqm_bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.cqm_bot_settings (id, base_amount_gbp, frequency, enabled)
  VALUES (1, 100, 'daily', FALSE)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cqm_bot_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  side                TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  signal_date         DATE NOT NULL,
  cqm_risk            NUMERIC(6, 4) NOT NULL,
  base_amount_gbp     NUMERIC(18, 2) NOT NULL,
  target_amount_gbp   NUMERIC(18, 2) NOT NULL,
  btc_gbp_ref         NUMERIC(18, 2) NOT NULL,
  base_filled         NUMERIC(20, 10),
  quote_filled        NUMERIC(18, 2),
  fees_gbp            NUMERIC(18, 2),
  coinbase_order_id   TEXT,
  coinbase_status     TEXT NOT NULL DEFAULT 'pending'
                        CHECK (coinbase_status IN (
                          'pending', 'submitted', 'open', 'filled',
                          'cancelled', 'failed'
                        )),
  error_summary       TEXT,
  raw_response        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cqm_bot_orders ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER cqm_bot_orders_updated_at
  BEFORE UPDATE ON public.cqm_bot_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cqm_bot_orders_triggered_at
  ON public.cqm_bot_orders (triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_cqm_bot_orders_status
  ON public.cqm_bot_orders (coinbase_status);
