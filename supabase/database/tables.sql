
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

create table
    public.log_inventory (
        created_at timestamp with time zone not null default now(),
        user_id uuid not null,
        barcode text not null,
        data_source text not null,
        name text,
        brand text,
        ingredients json,
        images json
    ) tablespace pg_default;

alter table public.log_inventory enable row level security;

create policy "Select for all authenticated users" on public.log_inventory
    for select
    using (true);

create policy "Insert for authenticated users" on public.log_inventory
    for insert
    with check (auth.uid() = user_id);

--------------------------------------------------------------------------------



--------------------------------------------------------------------------------