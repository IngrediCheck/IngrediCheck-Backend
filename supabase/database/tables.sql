
--------------------------------------------------------------------------------

create table
    public.preferences (
        created_at timestamp with time zone not null default now(),
        user_id uuid not null,
        preference text not null,
        constraint users_pkey primary key (user_id)
    ) tablespace pg_default;

ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_update_own_entries ON public.preferences
    FOR ALL
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------


--------------------------------------------------------------------------------