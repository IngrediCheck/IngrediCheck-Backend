set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_latest_memojis(p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, name text, created_at timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'extensions'
AS $function$
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
$function$
;

GRANT EXECUTE ON FUNCTION public.get_latest_memojis(integer, integer) TO anon, authenticated, service_role;


