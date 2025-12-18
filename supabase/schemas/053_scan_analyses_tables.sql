-- Scan analyses table for tracking analysis results separately from scans.

CREATE TABLE public.scan_analyses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id uuid NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
    food_note_snapshot jsonb,
    -- Structure: {
    --   "family": {"id": "uuid", "version": 5} | null,
    --   "members": [{"id": "uuid", "version": 3}, {"id": "uuid", "version": 4}]
    -- }
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'complete', 'failed')),
    result jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for getting latest analysis per scan
CREATE INDEX idx_scan_analyses_scan_created ON public.scan_analyses(scan_id, created_at DESC);
