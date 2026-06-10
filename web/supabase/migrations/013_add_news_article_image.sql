-- AI-generated hero image for news articles. Stored in a public Storage bucket;
-- the article row keeps the public URL + alt text.

ALTER TABLE public.news_articles
  ADD COLUMN image_url TEXT,
  ADD COLUMN image_alt TEXT;

-- Public bucket so images can be served via their public URL with no auth.
-- Writes happen server-side with the service role (which bypasses Storage RLS).
INSERT INTO storage.buckets (id, name, public)
VALUES ('news-images', 'news-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;
