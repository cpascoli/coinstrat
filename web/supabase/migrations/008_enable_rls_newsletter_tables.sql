-- Newsletter tables were created without RLS; PostgREST exposes public tables to anon/authenticated
-- clients by default. Enable RLS with no policies so only the service role (Netlify Functions) can
-- access — same pattern as public.email_subscribers in 001_initial_schema.sql.

ALTER TABLE public.newsletter_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_curated_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_send_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_suppressions ENABLE ROW LEVEL SECURITY;
