-- Unified scan tables for barcode and photo scans.

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

-- Indexes
CREATE INDEX idx_scans_user_activity ON public.scans(user_id, last_activity_at DESC);
CREATE INDEX idx_scans_user_barcode ON public.scans(user_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_scan_images_scan ON public.scan_images(scan_id, queued_at DESC);
CREATE INDEX idx_scan_images_pending ON public.scan_images(status, queued_at) WHERE status = 'pending';

-- Storage bucket for scan images
INSERT INTO storage.buckets (id, name, public) VALUES ('scan-images', 'scan-images', false)
ON CONFLICT (id) DO NOTHING;
