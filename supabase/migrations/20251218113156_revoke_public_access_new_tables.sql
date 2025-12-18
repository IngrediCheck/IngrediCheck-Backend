-- Revoke default PUBLIC access on new tables.
-- REVOKE statements are not captured by supabase db diff, so we add them manually.
-- See: https://supabase.com/docs/guides/local-development/declarative-database-schemas

REVOKE ALL ON TABLE public.feedback FROM PUBLIC;
REVOKE ALL ON TABLE public.scan_analyses FROM PUBLIC;
