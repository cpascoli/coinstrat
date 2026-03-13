ALTER TABLE public.email_subscribers
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_token TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_subscribers_confirmation_token
  ON public.email_subscribers (confirmation_token)
  WHERE confirmation_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_subscribers_confirmed_at
  ON public.email_subscribers (confirmed_at);

UPDATE public.email_subscribers
SET confirmed_at = COALESCE(confirmed_at, subscribed_at)
WHERE unsubscribed_at IS NULL
  AND confirmed_at IS NULL;
