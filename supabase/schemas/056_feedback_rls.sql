-- Row level security configuration for feedback table.

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.feedback FROM PUBLIC;

-- feedback: users can only access their own feedback
CREATE POLICY select_feedback ON public.feedback
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY insert_feedback ON public.feedback
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY update_feedback ON public.feedback
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY delete_feedback ON public.feedback
FOR DELETE TO authenticated
USING (user_id = auth.uid());
