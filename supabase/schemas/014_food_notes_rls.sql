-- Row level security configuration for food notes tables.

ALTER TABLE public.food_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_notes_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.food_notes FROM PUBLIC;
REVOKE ALL ON TABLE public.food_notes_history FROM PUBLIC;

-- food_notes: SELECT - family members can read
CREATE POLICY select_food_notes ON public.food_notes
FOR SELECT TO authenticated
USING (
    (member_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = food_notes.member_id
          AND m.deleted_at IS NULL
          AND public.is_family_member(m.family_id)
    ))
    OR
    (family_id IS NOT NULL AND public.is_family_member(family_id))
);

-- food_notes: INSERT - family members can create
CREATE POLICY insert_food_notes ON public.food_notes
FOR INSERT TO authenticated
WITH CHECK (
    (member_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = food_notes.member_id
          AND m.deleted_at IS NULL
          AND public.is_family_member(m.family_id)
    ))
    OR
    (family_id IS NOT NULL AND public.is_family_member(family_id))
);

-- food_notes: UPDATE - family members can update
CREATE POLICY update_food_notes ON public.food_notes
FOR UPDATE TO authenticated
USING (
    (member_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = food_notes.member_id
          AND m.deleted_at IS NULL
          AND public.is_family_member(m.family_id)
    ))
    OR
    (family_id IS NOT NULL AND public.is_family_member(family_id))
)
WITH CHECK (
    (member_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = food_notes.member_id
          AND m.deleted_at IS NULL
          AND public.is_family_member(m.family_id)
    ))
    OR
    (family_id IS NOT NULL AND public.is_family_member(family_id))
);

-- food_notes_history: SELECT only (immutable, inserted via RPC)
CREATE POLICY select_food_notes_history ON public.food_notes_history
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.food_notes fn
        WHERE fn.id = food_notes_history.food_note_id
          AND (
              (fn.member_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.members m
                  WHERE m.id = fn.member_id
                    AND public.is_family_member(m.family_id)
              ))
              OR
              (fn.family_id IS NOT NULL AND public.is_family_member(fn.family_id))
          )
    )
);
