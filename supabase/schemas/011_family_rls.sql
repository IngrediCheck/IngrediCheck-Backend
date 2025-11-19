-- Row level security configuration and helper predicates for the family domain.

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.families FROM PUBLIC;
REVOKE ALL ON TABLE public.members FROM PUBLIC;
REVOKE ALL ON TABLE public.invite_codes FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_family_member(p_family_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.members
        WHERE family_id = p_family_id
          AND user_id = auth.uid()
          AND deleted_at IS NULL
    );
$$;

CREATE POLICY insert_family_if_unassociated ON public.families
FOR INSERT
WITH CHECK (
    NOT EXISTS (
        SELECT 1 FROM public.members
        WHERE user_id = auth.uid()
          AND deleted_at IS NULL
    )
);

CREATE POLICY select_family ON public.families
FOR SELECT
USING (public.is_family_member(families.id));

CREATE POLICY update_family ON public.families
FOR UPDATE
USING (public.is_family_member(families.id));

CREATE POLICY select_members ON public.members
FOR SELECT TO authenticated
USING (public.is_family_member(family_id));

CREATE POLICY insert_family_member ON public.members
FOR INSERT
WITH CHECK (public.is_family_member(family_id));

CREATE POLICY update_deleted_at_for_unassociated_member ON public.members
FOR UPDATE
USING (
    public.is_family_member(family_id)
    AND user_id IS NULL
)
WITH CHECK (deleted_at IS NOT NULL);

CREATE POLICY set_user_id_by_current_user ON public.members
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY insert_invite_codes ON public.invite_codes
FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = invite_codes.generated_by_member_id
          AND m.family_id = invite_codes.family_id
          AND m.user_id = auth.uid()
          AND m.deleted_at IS NULL
    )
);

CREATE POLICY select_invite_codes ON public.invite_codes
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.family_id = invite_codes.family_id
          AND m.user_id = auth.uid()
          AND m.deleted_at IS NULL
    )
);

