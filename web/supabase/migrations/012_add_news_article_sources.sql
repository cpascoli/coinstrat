-- Structured sources for news articles (title + source name + url), rendered
-- like the weekly newsletter's curated link list. `source_links` (TEXT[]) stays
-- for embedded tweets / raw URLs; `sources` carries titled, attributed links.

ALTER TABLE public.news_articles
  ADD COLUMN sources JSONB NOT NULL DEFAULT '[]'::jsonb;
