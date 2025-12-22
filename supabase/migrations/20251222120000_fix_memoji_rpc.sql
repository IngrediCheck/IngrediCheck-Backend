
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
      AND o.owner = auth.uid()
    ORDER BY o.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_memojis(int, int) TO anon, authenticated, service_role;
