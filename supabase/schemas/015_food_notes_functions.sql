-- RPC functions for food notes management.

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
            -- Return current note on version mismatch instead of raising exception
            RETURN jsonb_build_object(
                'success', false,
                'error', 'version_mismatch',
                'currentNote', jsonb_build_object(
                    'content', existing_note.content,
                    'version', existing_note.version,
                    'updatedAt', existing_note.updated_at
                )
            );
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
            -- Return error for new note with non-zero version
            RETURN jsonb_build_object(
                'success', false,
                'error', 'version_mismatch',
                'currentNote', null
            );
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
        'success', true,
        'note', jsonb_build_object(
            'content', result_note.content,
            'version', result_note.version,
            'updatedAt', result_note.updated_at
        )
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
