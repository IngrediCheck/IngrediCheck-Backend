-- Row level security configuration for scan tables.

ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_images ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scans FROM PUBLIC;
REVOKE ALL ON TABLE public.scan_images FROM PUBLIC;

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
