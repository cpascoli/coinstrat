-- CQM bot execution leases — prevents duplicate trades when Netlify invokes the
-- scheduled function more than once for the same cadence slot (e.g. overlapping
-- cold starts while fitCQM() is still running).
--
-- A row with status = 'leased' acts as an exclusive lock for (frequency,
-- execution_date). Completed/released rows are kept for audit but do not block
-- new leases thanks to the partial unique index.

CREATE TABLE IF NOT EXISTS public.cqm_bot_execution_leases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_date  DATE NOT NULL,
  frequency       TEXT NOT NULL
                    CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  source          TEXT NOT NULL
                    CHECK (source IN ('admin_manual', 'scheduled')),
  status          TEXT NOT NULL DEFAULT 'leased'
                    CHECK (status IN ('leased', 'completed', 'released')),
  order_row_id    UUID REFERENCES public.cqm_bot_orders(id) ON DELETE SET NULL,
  leased_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cqm_bot_execution_leases ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER cqm_bot_execution_leases_updated_at
  BEFORE UPDATE ON public.cqm_bot_execution_leases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Only one active lease per cadence slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cqm_bot_execution_leases_active_slot
  ON public.cqm_bot_execution_leases (frequency, execution_date)
  WHERE status = 'leased';

CREATE INDEX IF NOT EXISTS idx_cqm_bot_execution_leases_execution_date
  ON public.cqm_bot_execution_leases (execution_date DESC);
