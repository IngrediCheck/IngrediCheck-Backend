-- Memoji domain tables and policies.

-- Cache of generated memojis keyed by normalized prompt/config hash.
CREATE TABLE IF NOT EXISTS public.memoji_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_hash text NOT NULL UNIQUE,
    image_url text NOT NULL,
    prompt_config jsonb NOT NULL,
    generation_cost numeric(10,4) DEFAULT 0.02,
    usage_count integer DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz DEFAULT now(),
    archived boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_memoji_cache_hash ON public.memoji_cache(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_memoji_cache_created_at ON public.memoji_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_memoji_cache_usage_count ON public.memoji_cache(usage_count DESC);

CREATE TRIGGER tr_memoji_cache_set_updated_at
BEFORE UPDATE ON public.memoji_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.memoji_cache ENABLE ROW LEVEL SECURITY;

-- Allow backend/service role to manage cache.
CREATE POLICY memoji_cache_service_all ON public.memoji_cache
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Basic select for authenticated users (cache is not user-scoped).
CREATE POLICY memoji_cache_read ON public.memoji_cache
FOR SELECT
TO authenticated
USING (true);

-- Per-user memoji avatar generation usage.
CREATE TABLE IF NOT EXISTS public.users (
    user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    avatar_generation_count integer NOT NULL DEFAULT 0,
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

-- Optional async jobs table for future use.
CREATE TABLE IF NOT EXISTS public.memoji_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    prompt jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    failure_reason text,
    image_url text,
    prompt_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memoji_jobs_user_id ON public.memoji_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_memoji_jobs_status ON public.memoji_jobs(status);

CREATE TRIGGER tr_memoji_jobs_set_updated_at
BEFORE UPDATE ON public.memoji_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.memoji_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY memoji_jobs_self ON public.memoji_jobs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY memoji_jobs_service_all ON public.memoji_jobs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');


