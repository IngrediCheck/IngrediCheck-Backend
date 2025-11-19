CREATE TABLE public.families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name text NOT NULL,
    nicknames text[],
    info text,
    color text CHECK (color ~ '^#(?:[0-9a-fA-F]{3}){1,6}$'),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE public.invite_codes (
    code text PRIMARY KEY,
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    generated_by_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    redeemed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    redeemed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tr_families_set_updated_at
    BEFORE UPDATE ON public.families
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tr_members_set_updated_at
    BEFORE UPDATE ON public.members
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tr_invite_codes_set_updated_at
    BEFORE UPDATE ON public.invite_codes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

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
        nicknames,
        info,
        color,
        user_id
    ) VALUES (
        (self_member->>'id')::uuid,
        new_family_id,
        self_member->>'name',
        ARRAY(SELECT jsonb_array_elements_text(self_member->'nicknames')),
        self_member->>'info',
        self_member->>'color',
        current_user_id
    ) RETURNING id INTO self_member_id;

    IF other_members IS NOT NULL THEN
        INSERT INTO public.members (
            id,
            family_id,
            name,
            nicknames,
            info,
            color
        )
        SELECT
            (m->>'id')::uuid,
            new_family_id,
            m->>'name',
            ARRAY(SELECT jsonb_array_elements_text(m->'nicknames')),
            m->>'info',
            m->>'color'
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
        'nicknames', m.nicknames,
        'info', m.info,
        'color', m.color,
        'joined', true
    ) INTO self_member
    FROM public.members m
    WHERE m.id = current_member.id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', m.id,
                'name', m.name,
                'nicknames', m.nicknames,
                'info', m.info,
                'color', m.color,
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

    UPDATE public.members
    SET user_id = NULL
    WHERE user_id = current_user_id;

    UPDATE public.members
    SET user_id = current_user_id,
        deleted_at = NULL
    WHERE id = invite.member_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to associate member with user. The member might have been joined by someone else.';
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
BEGIN
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not a member of any family';
    END IF;

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
        nicknames,
        info,
        color
    ) VALUES (
        new_member_id,
        current_member.family_id,
        member_name,
        ARRAY(SELECT jsonb_array_elements_text(member_data->'nicknames')),
        member_data->>'info',
        member_color
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
        nicknames = ARRAY(SELECT jsonb_array_elements_text(member_data->'nicknames')),
        info = member_data->>'info',
        color = member_data->>'color',
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


