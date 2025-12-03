-- Update family member RPCs to use image_file_hash and drop nicknames/info usage

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
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'User must be authenticated to create a family';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.members
        WHERE user_id = current_user_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'User is already part of a family';
    END IF;

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


