-- Unified Scan API Migration
-- Supports both barcode and photo scans with unified schema

-- Drop old tables if they exist (from previous schema iteration)
DROP TABLE IF EXISTS public.analysis_queue CASCADE;
DROP TABLE IF EXISTS public.scan_processing_history CASCADE;
DROP TABLE IF EXISTS public.scan_image_queue CASCADE;
DROP TABLE IF EXISTS public.scan_sessions CASCADE;

-- Drop old function if exists
DROP FUNCTION IF EXISTS public.get_scan_sessions(integer, integer);

-- ============================================================================
-- TABLES
-- ============================================================================

-- Unified scans table for barcode and photo scans
CREATE TABLE public.scans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scan_type text NOT NULL CHECK (scan_type IN ('barcode', 'photo')),
    barcode text,
    product_info_source text CHECK (product_info_source IN ('openfoodfacts', 'extraction', 'enriched')),
    product_info jsonb NOT NULL DEFAULT '{}'::jsonb,
    images_processed integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'processing')),
    analysis_status text CHECK (analysis_status IN ('analyzing', 'complete', 'stale')),
    analysis_started_at timestamptz,
    analysis_completed_at timestamptz,
    analysis_result jsonb,
    latest_guidance text,
    latest_error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now()
);

-- Unified scan_images table tracks images through lifecycle: pending → processing → processed (or failed)
CREATE TABLE public.scan_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id uuid NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
    content_hash text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
    storage_path text,
    extraction_result jsonb,
    extraction_error text,
    queued_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE (scan_id, content_hash)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_scans_user_activity ON public.scans(user_id, last_activity_at DESC);
CREATE INDEX idx_scans_user_barcode ON public.scans(user_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_scan_images_scan ON public.scan_images(scan_id, queued_at DESC);
CREATE INDEX idx_scan_images_pending ON public.scan_images(status, queued_at) WHERE status = 'pending';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_images ENABLE ROW LEVEL SECURITY;

-- scans: users can only access their own scans
CREATE POLICY select_scans ON public.scans
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY insert_scans ON public.scans
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY update_scans ON public.scans
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY delete_scans ON public.scans
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- scan_images: access via scan ownership
CREATE POLICY select_scan_images ON public.scan_images
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_images.scan_id
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY insert_scan_images ON public.scan_images
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_images.scan_id
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY update_scan_images ON public.scan_images
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_images.scan_id
          AND s.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_images.scan_id
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY delete_scan_images ON public.scan_images
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_images.scan_id
          AND s.user_id = auth.uid()
    )
);

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_images TO authenticated;
GRANT ALL ON public.scans TO service_role;
GRANT ALL ON public.scan_images TO service_role;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

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

-- ============================================================================
-- STORAGE
-- ============================================================================

-- Create storage bucket for scan images
INSERT INTO storage.buckets (id, name, public)
VALUES ('scan-images', 'scan-images', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for scan-images bucket
CREATE POLICY storage_scan_images_select ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'scan-images'
    AND EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = (string_to_array(name, '/'))[1]::uuid
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY storage_scan_images_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'scan-images'
    AND EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = (string_to_array(name, '/'))[1]::uuid
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY storage_scan_images_service_role ON storage.objects
FOR ALL TO service_role
USING (bucket_id = 'scan-images')
WITH CHECK (bucket_id = 'scan-images');
