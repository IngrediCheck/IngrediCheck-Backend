-- Feedback table for user feedback on various targets.

CREATE TABLE public.feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN (
        'product_info', 'product_image', 'analysis', 'flagged_ingredient', 'other'
    )),
    -- Polymorphic references
    scan_id uuid REFERENCES public.scans(id) ON DELETE CASCADE,
    scan_image_id uuid REFERENCES public.scan_images(id) ON DELETE CASCADE,
    scan_analysis_id uuid REFERENCES public.scan_analyses(id) ON DELETE CASCADE,
    ingredient_name text,
    -- Feedback data
    vote_type text NOT NULL CHECK (vote_type IN ('down')),
    comment text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX idx_feedback_user ON public.feedback(user_id);
CREATE INDEX idx_feedback_scan ON public.feedback(scan_id) WHERE scan_id IS NOT NULL;
CREATE INDEX idx_feedback_scan_analysis ON public.feedback(scan_analysis_id) WHERE scan_analysis_id IS NOT NULL;
