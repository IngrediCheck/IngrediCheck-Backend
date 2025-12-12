-- Migration: Add food notes feature
-- This migration adds:
-- 1. is_personal column to families table
-- 2. food_notes table for storing food note documents
-- 3. food_notes_history table for version history
-- 4. RLS policies for food notes
-- 5. RPC functions for food notes CRUD
-- 6. Modified family functions for note copying on join/leave/create

-- =============================================================================
-- 1. Schema Changes: families table
-- =============================================================================

ALTER TABLE public.families ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

-- Index for finding user's member records efficiently
CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.members(user_id) WHERE user_id IS NOT NULL;

-- =============================================================================
-- 2. Schema Changes: food_notes tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.food_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id uuid REFERENCES public.members(id) ON DELETE CASCADE,
    family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
    content jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT food_notes_scope_check CHECK (
        (member_id IS NOT NULL AND family_id IS NULL) OR
        (member_id IS NULL AND family_id IS NOT NULL)
    ),
    CONSTRAINT food_notes_unique_member UNIQUE (member_id),
    CONSTRAINT food_notes_unique_family UNIQUE (family_id)
);

CREATE TABLE IF NOT EXISTS public.food_notes_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    food_note_id uuid NOT NULL REFERENCES public.food_notes(id) ON DELETE CASCADE,
    content jsonb NOT NULL,
    version integer NOT NULL,
    changed_by_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for food_notes_history
CREATE INDEX IF NOT EXISTS idx_food_notes_history_note_id ON public.food_notes_history(food_note_id);
CREATE INDEX IF NOT EXISTS idx_food_notes_history_version ON public.food_notes_history(food_note_id, version DESC);

-- Trigger for updated_at on food_notes
DROP TRIGGER IF EXISTS tr_food_notes_set_updated_at ON public.food_notes;
CREATE TRIGGER tr_food_notes_set_updated_at
BEFORE UPDATE ON public.food_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 3. RLS Policies for food_notes
-- =============================================================================

ALTER TABLE public.food_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_notes_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.food_notes FROM PUBLIC;
REVOKE ALL ON TABLE public.food_notes_history FROM PUBLIC;

-- food_notes: SELECT - family members can read
DROP POLICY IF EXISTS select_food_notes ON public.food_notes;
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
DROP POLICY IF EXISTS insert_food_notes ON public.food_notes;
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
DROP POLICY IF EXISTS update_food_notes ON public.food_notes;
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
DROP POLICY IF EXISTS select_food_notes_history ON public.food_notes_history;
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

-- =============================================================================
-- 4. RPC Functions: Food Notes
-- =============================================================================

-- Internal helper: Get user's personal family member_id
CREATE OR REPLACE FUNCTION public.get_personal_family_member_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    personal_member_id uuid;
BEGIN
    SELECT m.id INTO personal_member_id
    FROM public.members m
    JOIN public.families f ON f.id = m.family_id
    WHERE m.user_id = auth.uid()
      AND m.deleted_at IS NULL
      AND f.is_personal = true;

    RETURN personal_member_id;
END;
$$;

-- Initialize personal (single-player) family
CREATE OR REPLACE FUNCTION public.init_personal_family(self_member jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    new_family_id uuid;
    self_member_id uuid;
    current_user_id uuid := auth.uid();
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated to create a personal family';
    END IF;

    -- Check if user is already in ANY family
    IF EXISTS (
        SELECT 1
        FROM public.members
        WHERE user_id = current_user_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'User is already part of a family';
    END IF;

    -- Create personal family
    INSERT INTO public.families (name, is_personal)
    VALUES (self_member->>'name', true)
    RETURNING id INTO new_family_id;

    -- Create self member
    INSERT INTO public.members (
        id,
        family_id,
        name,
        color,
        image_file_hash,
        user_id
    ) VALUES (
        (self_member->>'id')::uuid,
        new_family_id,
        self_member->>'name',
        self_member->>'color',
        self_member->>'imageFileHash',
        current_user_id
    ) RETURNING id INTO self_member_id;

    RETURN public.get_family();
END;
$$;

-- Get food note (auto-detect or specific member)
CREATE OR REPLACE FUNCTION public.get_food_note(target_member_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    family_member_count integer;
    note_record record;
    resolved_member_id uuid;
BEGIN
    -- Get current user's member
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    -- If target_member_id is NULL, auto-detect
    IF target_member_id IS NULL THEN
        -- Count active members in family
        SELECT COUNT(*) INTO family_member_count
        FROM public.members
        WHERE family_id = current_member.family_id
          AND deleted_at IS NULL;

        IF family_member_count = 1 THEN
            -- Single-member family: return self member's note
            resolved_member_id := current_member.id;
        ELSE
            -- Multi-member family: return family-level note
            SELECT fn.id, fn.content, fn.version, fn.updated_at
            INTO note_record
            FROM public.food_notes fn
            WHERE fn.family_id = current_member.family_id;

            IF NOT FOUND THEN
                RETURN NULL;
            END IF;

            RETURN jsonb_build_object(
                'content', note_record.content,
                'version', note_record.version,
                'updatedAt', note_record.updated_at
            );
        END IF;
    ELSE
        -- Validate target member belongs to user's family
        IF NOT EXISTS (
            SELECT 1 FROM public.members
            WHERE id = target_member_id
              AND family_id = current_member.family_id
              AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Member does not exist in your family';
        END IF;
        resolved_member_id := target_member_id;
    END IF;

    -- Get member's note
    SELECT fn.id, fn.content, fn.version, fn.updated_at
    INTO note_record
    FROM public.food_notes fn
    WHERE fn.member_id = resolved_member_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'content', note_record.content,
        'version', note_record.version,
        'updatedAt', note_record.updated_at
    );
END;
$$;

-- Set food note with optimistic locking
CREATE OR REPLACE FUNCTION public.set_food_note(
    target_member_id uuid DEFAULT NULL,
    content jsonb DEFAULT '{}'::jsonb,
    expected_version integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    family_member_count integer;
    resolved_member_id uuid;
    resolved_family_id uuid;
    existing_note record;
    new_version integer;
    result_note record;
BEGIN
    -- Get current user's member
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    -- Resolve target (same logic as get_food_note)
    IF target_member_id IS NULL THEN
        SELECT COUNT(*) INTO family_member_count
        FROM public.members
        WHERE family_id = current_member.family_id
          AND deleted_at IS NULL;

        IF family_member_count = 1 THEN
            resolved_member_id := current_member.id;
            resolved_family_id := NULL;
        ELSE
            resolved_member_id := NULL;
            resolved_family_id := current_member.family_id;
        END IF;
    ELSE
        -- Validate target member
        IF NOT EXISTS (
            SELECT 1 FROM public.members
            WHERE id = target_member_id
              AND family_id = current_member.family_id
              AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Member does not exist in your family';
        END IF;
        resolved_member_id := target_member_id;
        resolved_family_id := NULL;
    END IF;

    -- Get existing note
    IF resolved_member_id IS NOT NULL THEN
        SELECT * INTO existing_note
        FROM public.food_notes
        WHERE member_id = resolved_member_id;
    ELSE
        SELECT * INTO existing_note
        FROM public.food_notes
        WHERE family_id = resolved_family_id;
    END IF;

    -- Check version for optimistic locking
    IF existing_note.id IS NOT NULL THEN
        IF existing_note.version <> expected_version THEN
            RAISE EXCEPTION 'Version mismatch: expected %, got %', expected_version, existing_note.version;
        END IF;
        new_version := existing_note.version + 1;

        -- Insert current state into history
        INSERT INTO public.food_notes_history (
            food_note_id,
            content,
            version,
            changed_by_member_id
        ) VALUES (
            existing_note.id,
            existing_note.content,
            existing_note.version,
            current_member.id
        );

        -- Prune history to keep only last 10 versions
        DELETE FROM public.food_notes_history
        WHERE food_note_id = existing_note.id
          AND id NOT IN (
              SELECT id FROM public.food_notes_history
              WHERE food_note_id = existing_note.id
              ORDER BY version DESC
              LIMIT 10
          );

        -- Update existing note
        UPDATE public.food_notes
        SET content = set_food_note.content,
            version = new_version,
            updated_at = now()
        WHERE id = existing_note.id
        RETURNING * INTO result_note;
    ELSE
        -- Create new note (expected_version should be 0)
        IF expected_version <> 0 THEN
            RAISE EXCEPTION 'Version mismatch: expected 0 for new note, got %', expected_version;
        END IF;
        new_version := 1;

        INSERT INTO public.food_notes (
            member_id,
            family_id,
            content,
            version
        ) VALUES (
            resolved_member_id,
            resolved_family_id,
            set_food_note.content,
            new_version
        ) RETURNING * INTO result_note;
    END IF;

    RETURN jsonb_build_object(
        'content', result_note.content,
        'version', result_note.version,
        'updatedAt', result_note.updated_at
    );
END;
$$;

-- Get food note history
CREATE OR REPLACE FUNCTION public.get_food_note_history(
    target_member_id uuid DEFAULT NULL,
    history_limit integer DEFAULT 10,
    history_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    family_member_count integer;
    resolved_member_id uuid;
    resolved_family_id uuid;
    note_id uuid;
    history_entries jsonb;
BEGIN
    -- Get current user's member
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    -- Resolve target (same logic as get_food_note)
    IF target_member_id IS NULL THEN
        SELECT COUNT(*) INTO family_member_count
        FROM public.members
        WHERE family_id = current_member.family_id
          AND deleted_at IS NULL;

        IF family_member_count = 1 THEN
            resolved_member_id := current_member.id;
            resolved_family_id := NULL;
        ELSE
            resolved_member_id := NULL;
            resolved_family_id := current_member.family_id;
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM public.members
            WHERE id = target_member_id
              AND family_id = current_member.family_id
              AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Member does not exist in your family';
        END IF;
        resolved_member_id := target_member_id;
        resolved_family_id := NULL;
    END IF;

    -- Get note id
    IF resolved_member_id IS NOT NULL THEN
        SELECT id INTO note_id FROM public.food_notes WHERE member_id = resolved_member_id;
    ELSE
        SELECT id INTO note_id FROM public.food_notes WHERE family_id = resolved_family_id;
    END IF;

    IF note_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    -- Get history entries
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'content', h.content,
            'version', h.version,
            'changedByMemberId', h.changed_by_member_id,
            'createdAt', h.created_at
        ) ORDER BY h.version DESC
    ), '[]'::jsonb) INTO history_entries
    FROM (
        SELECT * FROM public.food_notes_history
        WHERE food_note_id = note_id
        ORDER BY version DESC
        LIMIT history_limit
        OFFSET history_offset
    ) h;

    RETURN history_entries;
END;
$$;

-- Get all food notes for family
CREATE OR REPLACE FUNCTION public.get_all_food_notes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    family_note jsonb;
    member_notes jsonb;
BEGIN
    -- Get current user's member
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    -- Get family-level note
    SELECT jsonb_build_object(
        'content', fn.content,
        'version', fn.version,
        'updatedAt', fn.updated_at
    ) INTO family_note
    FROM public.food_notes fn
    WHERE fn.family_id = current_member.family_id;

    -- Get all member notes as dictionary (only members with notes, excluding deleted)
    SELECT COALESCE(
        jsonb_object_agg(
            m.id::text,
            jsonb_build_object(
                'content', fn.content,
                'version', fn.version,
                'updatedAt', fn.updated_at
            )
        ),
        '{}'::jsonb
    ) INTO member_notes
    FROM public.members m
    JOIN public.food_notes fn ON fn.member_id = m.id
    WHERE m.family_id = current_member.family_id
      AND m.deleted_at IS NULL;

    RETURN jsonb_build_object(
        'familyNote', family_note,
        'memberNotes', member_notes
    );
END;
$$;

-- Internal helper: Copy food note from one member to another
CREATE OR REPLACE FUNCTION public.copy_food_note(
    source_member_id uuid,
    target_member_id uuid,
    acting_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    source_note record;
    target_note record;
BEGIN
    -- Get source note
    SELECT * INTO source_note
    FROM public.food_notes
    WHERE member_id = source_member_id;

    IF NOT FOUND THEN
        -- No source note to copy
        RETURN;
    END IF;

    -- Get target note
    SELECT * INTO target_note
    FROM public.food_notes
    WHERE member_id = target_member_id;

    IF target_note.id IS NOT NULL THEN
        -- Target has existing note - save to history first
        INSERT INTO public.food_notes_history (
            food_note_id,
            content,
            version,
            changed_by_member_id
        ) VALUES (
            target_note.id,
            target_note.content,
            target_note.version,
            acting_member_id
        );

        -- Prune history
        DELETE FROM public.food_notes_history
        WHERE food_note_id = target_note.id
          AND id NOT IN (
              SELECT id FROM public.food_notes_history
              WHERE food_note_id = target_note.id
              ORDER BY version DESC
              LIMIT 10
          );

        -- Update target with source content, reset version to 1
        UPDATE public.food_notes
        SET content = source_note.content,
            version = 1,
            updated_at = now()
        WHERE id = target_note.id;
    ELSE
        -- Create new note for target
        INSERT INTO public.food_notes (
            member_id,
            content,
            version
        ) VALUES (
            target_member_id,
            source_note.content,
            1
        );
    END IF;
END;
$$;

-- =============================================================================
-- 5. Modified Family Functions
-- =============================================================================

-- Modified create_family to allow users with personal family
CREATE OR REPLACE FUNCTION public.create_family(
    family_name text,
    self_member jsonb,
    other_members jsonb[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    new_family_id uuid;
    self_member_id uuid;
    current_user_id uuid := auth.uid();
    personal_member_id uuid;
    is_in_non_personal_family boolean;
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated to create a family';
    END IF;

    -- Check if user is in a non-personal family
    SELECT EXISTS (
        SELECT 1
        FROM public.members m
        JOIN public.families f ON f.id = m.family_id
        WHERE m.user_id = current_user_id
          AND m.deleted_at IS NULL
          AND f.is_personal = false
    ) INTO is_in_non_personal_family;

    IF is_in_non_personal_family THEN
        RAISE EXCEPTION 'User is already part of a family';
    END IF;

    -- Get personal family member id for note copying
    personal_member_id := public.get_personal_family_member_id();

    -- Disassociate from personal family if exists
    IF personal_member_id IS NOT NULL THEN
        UPDATE public.members
        SET user_id = NULL
        WHERE id = personal_member_id;
    END IF;

    -- Create new shared family
    INSERT INTO public.families (name, is_personal)
    VALUES (family_name, false)
    RETURNING id INTO new_family_id;

    INSERT INTO public.members (
        id,
        family_id,
        name,
        color,
        image_file_hash,
        user_id
    ) VALUES (
        (self_member->>'id')::uuid,
        new_family_id,
        self_member->>'name',
        self_member->>'color',
        self_member->>'imageFileHash',
        current_user_id
    ) RETURNING id INTO self_member_id;

    -- Copy notes from personal family to new self member
    IF personal_member_id IS NOT NULL THEN
        PERFORM public.copy_food_note(personal_member_id, self_member_id, self_member_id);
    END IF;

    IF other_members IS NOT NULL THEN
        INSERT INTO public.members (
            id,
            family_id,
            name,
            color,
            image_file_hash
        )
        SELECT
            (m->>'id')::uuid,
            new_family_id,
            m->>'name',
            m->>'color',
            m->>'imageFileHash'
        FROM unnest(other_members) AS m;
    END IF;

    RETURN new_family_id;
END;
$$;

-- Modified join_family to copy notes from personal family
CREATE OR REPLACE FUNCTION public.join_family(invite_code_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    invite record;
    current_user_id uuid := auth.uid();
    personal_member_id uuid;
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated to join a family';
    END IF;

    SELECT * INTO invite
    FROM public.invite_codes
    WHERE code = invite_code_text
      AND expires_at > now()
      AND redeemed_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired invite code';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.members
        WHERE id = invite.member_id
          AND deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Member associated with this invite code is deleted';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.members
        WHERE id = invite.member_id
          AND user_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Member associated with this invite code is already joined';
    END IF;

    -- Get personal family member id for note copying
    personal_member_id := public.get_personal_family_member_id();

    -- Disassociate user from current member(s)
    UPDATE public.members
    SET user_id = NULL
    WHERE user_id = current_user_id;

    -- Associate with target member
    UPDATE public.members
    SET user_id = current_user_id,
        deleted_at = NULL
    WHERE id = invite.member_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to associate member with user. The member might have been joined by someone else.';
    END IF;

    -- Copy notes from personal family to target member ("Bob wins")
    IF personal_member_id IS NOT NULL THEN
        PERFORM public.copy_food_note(personal_member_id, invite.member_id, invite.member_id);
    END IF;

    UPDATE public.invite_codes
    SET redeemed_by_user_id = current_user_id,
        redeemed_at = now()
    WHERE code = invite_code_text;

    RETURN public.get_family();
END;
$$;

-- Modified leave_family to copy notes to personal family
CREATE OR REPLACE FUNCTION public.leave_family()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    personal_member_id uuid;
BEGIN
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    -- Get personal family member id for note copying
    personal_member_id := public.get_personal_family_member_id();

    -- Copy notes to personal family if it exists (and not leaving the personal family itself)
    IF personal_member_id IS NOT NULL AND personal_member_id <> current_member.id THEN
        PERFORM public.copy_food_note(current_member.id, personal_member_id, personal_member_id);
    END IF;

    -- Disassociate user from current member
    UPDATE public.members
    SET user_id = NULL
    WHERE id = current_member.id;
END;
$$;
