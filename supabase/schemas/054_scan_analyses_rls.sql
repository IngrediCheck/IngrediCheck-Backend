-- Row level security configuration for scan_analyses table.

ALTER TABLE public.scan_analyses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scan_analyses FROM PUBLIC;

-- scan_analyses: access via scan ownership
CREATE POLICY select_scan_analyses ON public.scan_analyses
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_analyses.scan_id
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY insert_scan_analyses ON public.scan_analyses
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_analyses.scan_id
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY update_scan_analyses ON public.scan_analyses
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_analyses.scan_id
          AND s.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_analyses.scan_id
          AND s.user_id = auth.uid()
    )
);

CREATE POLICY delete_scan_analyses ON public.scan_analyses
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.scans s
        WHERE s.id = scan_analyses.scan_id
          AND s.user_id = auth.uid()
    )
);
