-- Functions for scan queries.

-- Get paginated scan history with full scan data
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
        s.analysis_status,
        s.analysis_started_at,
        s.analysis_completed_at,
        s.analysis_result,
        s.latest_guidance,
        s.latest_error_message,
        s.created_at,
        s.last_activity_at,
        v_total AS total_count
    FROM public.scans s
    WHERE s.user_id = auth.uid()
    ORDER BY s.last_activity_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- Get images for a list of scan IDs (for building full Scan response)
CREATE OR REPLACE FUNCTION public.get_scan_images(
    p_scan_ids uuid[]
)
RETURNS TABLE (
    id uuid,
    scan_id uuid,
    content_hash text,
    status text,
    storage_path text,
    extraction_result jsonb,
    extraction_error text,
    queued_at timestamptz,
    processed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        si.id,
        si.scan_id,
        si.content_hash,
        si.status,
        si.storage_path,
        si.extraction_result,
        si.extraction_error,
        si.queued_at,
        si.processed_at
    FROM public.scan_images si
    JOIN public.scans s ON s.id = si.scan_id
    WHERE si.scan_id = ANY(p_scan_ids)
      AND s.user_id = auth.uid()
    ORDER BY si.queued_at DESC;
END;
$$;
