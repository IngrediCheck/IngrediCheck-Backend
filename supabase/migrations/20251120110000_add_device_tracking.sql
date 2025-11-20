-- Device tracking tables, policies, and helper RPCs.

CREATE TABLE public.devices (
    device_id uuid PRIMARY KEY,
    platform text,
    os_version text,
    app_version text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tr_devices_set_updated_at
BEFORE UPDATE ON public.devices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.device_user_logins (
    device_id uuid NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    last_platform text,
    last_app_version text,
    PRIMARY KEY (device_id, user_id)
);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_user_logins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.devices FROM PUBLIC;
REVOKE ALL ON public.device_user_logins FROM PUBLIC;

CREATE POLICY devices_service_role_only ON public.devices
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY device_logins_service_role_write ON public.device_user_logins
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY device_logins_select_self ON public.device_user_logins
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.device_register(
    _device_id uuid,
    _user_id uuid,
    _platform text DEFAULT NULL,
    _os_version text DEFAULT NULL,
    _app_version text DEFAULT NULL
)
RETURNS public.devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result public.devices;
BEGIN
    INSERT INTO public.devices (device_id, platform, os_version, app_version)
    VALUES (_device_id, _platform, _os_version, _app_version)
    ON CONFLICT (device_id) DO UPDATE
        SET platform = COALESCE(EXCLUDED.platform, public.devices.platform),
            os_version = COALESCE(EXCLUDED.os_version, public.devices.os_version),
            app_version = COALESCE(EXCLUDED.app_version, public.devices.app_version),
            updated_at = now()
    RETURNING * INTO result;

    INSERT INTO public.device_user_logins (
        device_id,
        user_id,
        first_seen_at,
        last_seen_at,
        last_platform,
        last_app_version
    )
    VALUES (
        _device_id,
        _user_id,
        now(),
        now(),
        _platform,
        _app_version
    )
    ON CONFLICT (device_id, user_id) DO UPDATE
        SET last_seen_at = now(),
            last_platform = EXCLUDED.last_platform,
            last_app_version = EXCLUDED.last_app_version;

    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.device_set_internal(
    _device_id uuid
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.devices
    SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{is_internal}', 'true'::jsonb),
        updated_at = now()
    WHERE device_id = _device_id;

    RETURN QUERY
    SELECT user_id
    FROM public.device_user_logins
    WHERE device_id = _device_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.device_is_internal(
    _device_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce((
        SELECT (metadata ->> 'is_internal')::boolean
        FROM public.devices
        WHERE device_id = _device_id
    ), false);
$$;

GRANT EXECUTE ON FUNCTION public.device_register(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.device_set_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.device_is_internal(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.user_set_internal(
    _user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
    UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{is_internal}', 'true'::jsonb),
        updated_at = now()
    WHERE id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_internal(
    _user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
    SELECT coalesce((
        SELECT (raw_user_meta_data ->> 'is_internal')::boolean
        FROM auth.users
        WHERE id = _user_id
    ), false);
$$;

GRANT EXECUTE ON FUNCTION public.user_set_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_is_internal(uuid) TO service_role;
