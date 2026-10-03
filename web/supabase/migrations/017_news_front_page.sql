-- News front page: four daily sections (market lead, development, culture,
-- opinion). Each section is its own article row; the /news front page shows
-- the newest article per section, so a section with no fresh sources simply
-- keeps its previous article up.
--
-- Existing daily articles predate sections and covered mostly markets, so the
-- column default backfills them as `market` and the lead is never empty.

ALTER TABLE public.news_articles
  ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'market';

ALTER TABLE public.news_articles
  DROP CONSTRAINT IF EXISTS news_articles_section_check;

ALTER TABLE public.news_articles
  ADD CONSTRAINT news_articles_section_check
  CHECK (section IN ('market', 'development', 'culture', 'opinion', 'legacy'));

CREATE INDEX IF NOT EXISTS news_articles_section_published_at_idx
  ON public.news_articles (section, published_at DESC);

-- Source URLs already written up, so the same story is not reused on later
-- days (feeds keep items listed long after publication).
CREATE TABLE IF NOT EXISTS public.news_source_usage (
  url           TEXT PRIMARY KEY,
  section       TEXT NOT NULL,
  article_slug  TEXT NOT NULL,
  used_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS news_source_usage_used_at_idx
  ON public.news_source_usage (used_at DESC);

-- One row per front-page generation run, with a per-section outcome, so
-- failures are traceable and the admin UI can show what happened.
CREATE TABLE IF NOT EXISTS public.news_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date     DATE NOT NULL,
  trigger      TEXT NOT NULL DEFAULT 'scheduled',
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'failed')),
  sections     JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS news_runs_started_at_idx
  ON public.news_runs (started_at DESC);

-- Writes stay service-role only (no INSERT/UPDATE policies). Authenticated
-- admins can read run outcomes so the Admin UI can poll without a new API.
ALTER TABLE public.news_source_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read news_runs"
  ON public.news_runs FOR SELECT
  TO authenticated
  USING (true);
