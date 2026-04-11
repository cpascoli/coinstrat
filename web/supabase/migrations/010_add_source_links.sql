-- Add optional source links (e.g. tweet URLs) to news articles

ALTER TABLE public.news_articles
  ADD COLUMN source_links TEXT[] NOT NULL DEFAULT '{}';
