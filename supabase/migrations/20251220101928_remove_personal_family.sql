drop function if exists "public"."get_personal_family_member_id"();

drop function if exists "public"."init_personal_family"(self_member jsonb);

alter table "public"."families" drop column "is_personal";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_family(family_name text, self_member jsonb, other_members jsonb[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    new_family_id uuid;
    self_member_id uuid;
    current_user_id uuid := auth.uid();
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated to create a family';
    END IF;

    -- Check if user is already in any family
    IF EXISTS (
        SELECT 1
        FROM public.members
        WHERE user_id = current_user_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'User is already part of a family';
    END IF;

    -- Create new family
    INSERT INTO public.families (name)
    VALUES (family_name)
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_food_note(target_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- If target_member_id is NULL, return family-level note
    IF target_member_id IS NULL THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_food_note_history(target_member_id uuid DEFAULT NULL::uuid, history_limit integer DEFAULT 10, history_offset integer DEFAULT 0)
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

    -- Resolve target: NULL = family-level, specified = member-level
    IF target_member_id IS NULL THEN
        resolved_member_id := NULL;
        resolved_family_id := current_member.family_id;
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
$function$
;

CREATE OR REPLACE FUNCTION public.join_family(invite_code_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    invite record;
    current_user_id uuid := auth.uid();
    current_member record;
    member_count integer;
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

    -- Get user's current member for note copying
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = current_user_id
      AND deleted_at IS NULL;

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

    -- Copy notes from single-member family to target member ("Bob wins")
    IF current_member.id IS NOT NULL THEN
        SELECT COUNT(*) INTO member_count
        FROM public.members
        WHERE family_id = current_member.family_id
          AND deleted_at IS NULL;

        -- Only copy if user was in a single-member family
        IF member_count = 1 THEN
            PERFORM public.copy_food_note(current_member.id, invite.member_id, invite.member_id);
        END IF;
    END IF;

    UPDATE public.invite_codes
    SET redeemed_by_user_id = current_user_id,
        redeemed_at = now()
    WHERE code = invite_code_text;

    RETURN public.get_family();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.leave_family()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    current_member record;
    member_count integer;
    new_family_id uuid;
    new_member_id uuid;
    current_user_id uuid := auth.uid();
BEGIN
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = current_user_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    -- Check if user is the only active member
    SELECT COUNT(*) INTO member_count
    FROM public.members
    WHERE family_id = current_member.family_id
      AND deleted_at IS NULL
      AND user_id IS NOT NULL;

    IF member_count = 1 THEN
        RAISE EXCEPTION 'Cannot leave family: you are the only active member';
    END IF;

    -- Create new single-member family
    INSERT INTO public.families (name)
    VALUES (current_member.name)
    RETURNING id INTO new_family_id;

    -- Create new member in the new family
    INSERT INTO public.members (
        family_id,
        name,
        color,
        image_file_hash,
        user_id
    ) VALUES (
        new_family_id,
        current_member.name,
        current_member.color,
        current_member.image_file_hash,
        current_user_id
    ) RETURNING id INTO new_member_id;

    -- Copy notes from old member to new member
    PERFORM public.copy_food_note(current_member.id, new_member_id, new_member_id);

    -- Disassociate user from old family member
    UPDATE public.members
    SET user_id = NULL
    WHERE id = current_member.id;
END;
$function$
;

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

    -- Resolve target: NULL = family-level, specified = member-level
    IF target_member_id IS NULL THEN
        resolved_member_id := NULL;
        resolved_family_id := current_member.family_id;
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
$function$
;


