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

-- Get latest memojis from storage bucket with pagination
CREATE OR REPLACE FUNCTION public.get_latest_memojis(p_limit int, p_offset int)
RETURNS TABLE (
    id uuid,
    name text,
    created_at timestamptz,
    metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id,
        o.name,
        o.created_at,
        o.metadata
    FROM storage.objects o
    WHERE o.bucket_id = 'memoji-images'
    ORDER BY o.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_memojis(int, int) TO anon, authenticated, service_role;


