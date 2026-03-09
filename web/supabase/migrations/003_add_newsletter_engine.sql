-- Newsletter engine schema

CREATE TABLE public.newsletter_settings (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  send_weekday    SMALLINT NOT NULL DEFAULT 1 CHECK (send_weekday BETWEEN 0 AND 6),
  send_hour_utc   SMALLINT NOT NULL DEFAULT 14 CHECK (send_hour_utc BETWEEN 0 AND 23),
  audience_mode   TEXT NOT NULL DEFAULT 'all'
                    CHECK (audience_mode IN ('all', 'newsletter_only', 'paid_only')),
  from_name       TEXT NOT NULL DEFAULT 'CoinStrat',
  reply_to        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.newsletter_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.newsletter_issues (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug                   TEXT UNIQUE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  week_of                DATE NOT NULL UNIQUE,
  scheduled_for          TIMESTAMPTZ,
  sent_at                TIMESTAMPTZ,
  subject                TEXT,
  preview_text           TEXT,
  structured_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  html                   TEXT,
  text                   TEXT,
  editor_note            TEXT,
  cta_label              TEXT,
  cta_href               TEXT,
  llm_provider           TEXT,
  llm_model              TEXT,
  created_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.newsletter_curated_links (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_id    UUID NOT NULL REFERENCES public.newsletter_issues(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT '',
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.newsletter_send_logs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_id         UUID NOT NULL REFERENCES public.newsletter_issues(id) ON DELETE CASCADE,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  provider         TEXT NOT NULL DEFAULT 'resend',
  provider_batch_id TEXT,
  delivery_mode    TEXT NOT NULL DEFAULT 'broadcast'
                     CHECK (delivery_mode IN ('broadcast', 'test')),
  error_summary    TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.newsletter_suppressions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  reason      TEXT NOT NULL DEFAULT 'unsubscribe',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_newsletter_issues_week_of ON public.newsletter_issues (week_of DESC);
CREATE INDEX idx_newsletter_issues_status ON public.newsletter_issues (status);
CREATE INDEX idx_newsletter_curated_links_issue_id ON public.newsletter_curated_links (issue_id, sort_order);
CREATE INDEX idx_newsletter_send_logs_issue_id ON public.newsletter_send_logs (issue_id, sent_at DESC);
CREATE INDEX idx_newsletter_suppressions_email ON public.newsletter_suppressions (email);

CREATE TRIGGER set_newsletter_settings_updated_at
  BEFORE UPDATE ON public.newsletter_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_newsletter_issues_updated_at
  BEFORE UPDATE ON public.newsletter_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
