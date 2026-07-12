-- CQM Bot lump deposits — explicit capital injections into the strategy.
--
-- The virtual ledger's only funding line used to be the per-cadence-slot
-- base-amount drip, so there was no way to tell the bot "you now manage an
-- extra £X" (e.g. staging in a larger tranche at a judged cycle bottom).
-- Rows in this table are added to the ledger's deposits from `deposited_at`
-- onward, making that cash visible to the dynamic sizing rule's
-- %-of-idle-cash term.
--
-- Amounts are virtual mandate funding, not transfers: the admin must ensure
-- the corresponding GBP actually exists on the exchange account. Negative
-- amounts withdraw idle cash from the mandate (ledger cash is floored at 0).
--
-- Access policy: RLS enabled with NO policies (default-deny), same as the
-- other cqm_bot_* tables. All access flows through admin-gated Netlify
-- functions using the service-role key.

CREATE TABLE IF NOT EXISTS public.cqm_bot_deposits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_gbp    NUMERIC(18, 2) NOT NULL CHECK (amount_gbp <> 0),
  deposited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cqm_bot_deposits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cqm_bot_deposits_deposited_at
  ON public.cqm_bot_deposits (deposited_at);
