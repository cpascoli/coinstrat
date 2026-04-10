-- Free public news articles (published via Netlify function + service role; public read via RLS)

CREATE TABLE public.news_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  headline      TEXT NOT NULL,
  summary       TEXT NOT NULL,
  body          TEXT NOT NULL,
  labels        TEXT[] NOT NULL DEFAULT '{}',
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX news_articles_published_at_idx ON public.news_articles (published_at DESC);
CREATE INDEX news_articles_labels_idx ON public.news_articles USING GIN (labels);

ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read news articles"
  ON public.news_articles FOR SELECT
  TO anon, authenticated
  USING (true);

-- Inserts/updates/deletes: service role (Netlify functions) only — no write policies for clients
