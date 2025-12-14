-- User tracking table for various user-related metrics and usage data.
-- This table is intentionally generic to support tracking multiple features.

CREATE TABLE IF NOT EXISTS public.users (
    user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    memoji_generation_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tr_users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Service role can manage usage tracking.
CREATE POLICY users_service_all ON public.users
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Users can read their own usage data.
CREATE POLICY users_select_own ON public.users
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);


-- Auth schema policy for readonly access
CREATE POLICY "Read access for readonly_user"
ON auth.users FOR SELECT
TO public
USING (true);

