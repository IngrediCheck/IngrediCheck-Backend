-- RPC and helper functions powering the family domain APIs.

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

CREATE OR REPLACE FUNCTION public.get_family()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    current_member record;
    family_name text;
    self_member jsonb;
    other_members jsonb;
    version bigint;
BEGIN
    SELECT *
    INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    SELECT name INTO family_name
    FROM public.families
    WHERE id = current_member.family_id;

    SELECT jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'color', m.color,
        'imageFileHash', m.image_file_hash,
        'joined', true
    ) INTO self_member
    FROM public.members m
    WHERE m.id = current_member.id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', m.id,
                'name', m.name,
                'color', m.color,
                'imageFileHash', m.image_file_hash,
                'joined', m.user_id IS NOT NULL
            )
        ), '[]'::jsonb
    ) INTO other_members
    FROM public.members m
    WHERE m.family_id = current_member.family_id
      AND m.id <> current_member.id
      AND m.deleted_at IS NULL;

    SELECT COALESCE(
        (
            SELECT FLOOR(EXTRACT(EPOCH FROM MAX(ts)))::bigint
            FROM (
                SELECT updated_at AS ts FROM public.families WHERE id = current_member.family_id
                UNION ALL
                SELECT updated_at FROM public.members WHERE family_id = current_member.family_id AND deleted_at IS NULL
            ) AS combined
        ), 0
    ) INTO version;

    RETURN jsonb_build_object(
        'name', family_name,
        'selfMember', self_member,
        'otherMembers', other_members,
        'version', version
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_invite(for_member_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    current_member record;
    invite_code text;
BEGIN
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.members
        WHERE id = for_member_id
          AND family_id = current_member.family_id
          AND deleted_at IS NULL
          AND user_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Target member does not exist or is already joined';
    END IF;

    invite_code := encode(gen_random_bytes(3), 'hex');

    INSERT INTO public.invite_codes (
        code,
        family_id,
        member_id,
        generated_by_member_id,
        expires_at
    ) VALUES (
        invite_code,
        current_member.family_id,
        for_member_id,
        current_member.id,
        now() + interval '30 minutes'
    );

    RETURN invite_code;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.add_member(member_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    new_member_id uuid := (member_data->>'id')::uuid;
    member_name text := member_data->>'name';
    member_color text := member_data->>'color';
BEGIN
    IF new_member_id IS NULL OR member_name IS NULL OR member_color IS NULL THEN
        RAISE EXCEPTION 'Missing required member fields: id, name, or color';
    END IF;

    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.members WHERE id = new_member_id
    ) THEN
        RAISE EXCEPTION 'Member with id % already exists', new_member_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.members
        WHERE family_id = current_member.family_id
          AND deleted_at IS NULL
          AND lower(name) = lower(member_name)
    ) THEN
        RAISE EXCEPTION 'A member with the name "%" already exists in the family', member_name;
    END IF;

    INSERT INTO public.members (
        id,
        family_id,
        name,
        color,
        image_file_hash
    ) VALUES (
        new_member_id,
        current_member.family_id,
        member_name,
        member_color,
        member_data->>'imageFileHash'
    );

    RETURN public.get_family();
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_member(member_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    target_member record;
    target_member_id uuid := (member_data->>'id')::uuid;
    updated_member_name text := member_data->>'name';
    updated_member_color text := member_data->>'color';
BEGIN
    IF target_member_id IS NULL OR updated_member_name IS NULL OR updated_member_color IS NULL THEN
        RAISE EXCEPTION 'Missing required member fields: id, name, or color';
    END IF;

    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    SELECT * INTO target_member
    FROM public.members
    WHERE id = target_member_id
      AND family_id = current_member.family_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member with id % does not exist in your family', target_member_id;
    END IF;

    IF lower(updated_member_name) <> lower(target_member.name) THEN
        IF EXISTS (
            SELECT 1 FROM public.members
            WHERE family_id = current_member.family_id
              AND deleted_at IS NULL
              AND lower(name) = lower(updated_member_name)
              AND id <> target_member_id
        ) THEN
            RAISE EXCEPTION 'A member with the name "%" already exists in the family', updated_member_name;
        END IF;
    END IF;

    UPDATE public.members
    SET
        name = updated_member_name,
        color = member_data->>'color',
        image_file_hash = member_data->>'imageFileHash',
        updated_at = now()
    WHERE id = target_member_id;

    RETURN public.get_family();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_member(member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    target_member record;
BEGIN
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

    SELECT * INTO target_member
    FROM public.members
    WHERE id = member_id
      AND family_id = current_member.family_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member with id % does not exist in your family', member_id;
    END IF;

    IF target_member.user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot delete yourself. Use leave_family instead.';
    END IF;

    UPDATE public.members
    SET deleted_at = now()
    WHERE id = member_id;

    RETURN public.get_family();
END;
$$;

