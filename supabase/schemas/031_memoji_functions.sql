-- Memoji support functions and RPCs.

-- Increment cache usage and update timestamps.
CREATE OR REPLACE FUNCTION public.increment_memoji_usage(hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.memoji_cache
    SET usage_count = COALESCE(usage_count, 0) + 1,
        last_used_at = now(),
        updated_at = now()
    WHERE prompt_hash = hash
      AND archived = false;
END;
$$;


