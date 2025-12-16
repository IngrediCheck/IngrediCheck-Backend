-- Update set_food_note to return current note on version mismatch instead of raising exception
CREATE OR REPLACE FUNCTION public.set_food_note(target_member_id uuid DEFAULT NULL::uuid, content jsonb DEFAULT '{}'::jsonb, expected_version integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
