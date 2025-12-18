-- Split get_scans into v1 (backward compatible) and v2 (new format)

-- Drop the old get_scans function that returned JSONB (from previous migration)
DROP FUNCTION IF EXISTS public.get_scans(integer, integer, boolean);

-- V1: Get paginated scan history (backward compatible - snake_case, includes analysis_* fields)
CREATE OR REPLACE FUNCTION public.get_scans(
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    scan_type text,
    barcode text,
    product_info_source text,
    product_info jsonb,
    images_processed integer,
    status text,
    analysis_status text,
    analysis_started_at timestamptz,
    analysis_completed_at timestamptz,
    analysis_result jsonb,
    latest_guidance text,
    latest_error_message text,
    created_at timestamptz,
    last_activity_at timestamptz,
    total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total bigint;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM public.scans s
    WHERE s.user_id = auth.uid();

    RETURN QUERY
    SELECT
        s.id,
        s.scan_type,
        s.barcode,
        s.product_info_source,
        s.product_info,
        s.images_processed,
        s.status,
        sa.status AS analysis_status,
        sa.started_at AS analysis_started_at,
        sa.completed_at AS analysis_completed_at,
        sa.result AS analysis_result,
        s.latest_guidance,
        s.latest_error_message,
        s.created_at,
        s.last_activity_at,
        v_total AS total_count
    FROM public.scans s
    LEFT JOIN LATERAL (
        SELECT sa2.*
        FROM public.scan_analyses sa2
        WHERE sa2.scan_id = s.id
        ORDER BY sa2.created_at DESC
        LIMIT 1
    ) sa ON true
    WHERE s.user_id = auth.uid()
    ORDER BY s.last_activity_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- V2: Get paginated scan history (camelCase, includes latestAnalysis with isStale, isDownvoted)
CREATE OR REPLACE FUNCTION public.get_scans_v2(
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0,
    p_favorited boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total bigint;
    v_scans jsonb;
BEGIN
    -- Count total (with filter)
    SELECT COUNT(*) INTO v_total
    FROM public.scans s
    WHERE s.user_id = auth.uid()
      AND (p_favorited IS NULL OR s.is_favorited = p_favorited);

    -- Get scans with latest analysis
    SELECT COALESCE(jsonb_agg(scan_data ORDER BY scan_data->>'lastActivityAt' DESC), '[]'::jsonb)
    INTO v_scans
    FROM (
        SELECT jsonb_build_object(
            'id', s.id,
            'scanType', s.scan_type,
            'barcode', s.barcode,
            'productInfoSource', s.product_info_source,
            'productInfo', s.product_info,
            'imagesProcessed', s.images_processed,
            'status', s.status,
            'isFavorited', s.is_favorited,
            'latestGuidance', s.latest_guidance,
            'latestErrorMessage', s.latest_error_message,
            'createdAt', s.created_at,
            'lastActivityAt', s.last_activity_at,
            'latestAnalysis', (
                SELECT jsonb_build_object(
                    'id', sa.id,
                    'status', sa.status,
                    'isStale', public.is_analysis_stale(sa.food_note_snapshot),
                    'result', sa.result,
                    'isDownvoted', EXISTS(
                        SELECT 1 FROM public.feedback f
                        WHERE f.scan_analysis_id = sa.id
                          AND f.user_id = auth.uid()
                          AND f.target_type = 'analysis'
                    ),
                    'startedAt', sa.started_at,
                    'completedAt', sa.completed_at,
                    'createdAt', sa.created_at
                )
                FROM public.scan_analyses sa
                WHERE sa.scan_id = s.id
                ORDER BY sa.created_at DESC
                LIMIT 1
            )
        ) AS scan_data
        FROM public.scans s
        WHERE s.user_id = auth.uid()
          AND (p_favorited IS NULL OR s.is_favorited = p_favorited)
        ORDER BY s.last_activity_at DESC
        LIMIT p_limit
        OFFSET p_offset
    ) sub;

    RETURN jsonb_build_object(
        'scans', v_scans,
        'totalCount', v_total
    );
END;
$$;
