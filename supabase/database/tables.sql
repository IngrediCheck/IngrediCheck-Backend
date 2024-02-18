
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

create table
    public.log_extract (
        user_id uuid not null,
        client_activity_id uuid,
        activity_id uuid not null,
        created_at timestamp with time zone not null default now(),
        start_time timestamp with time zone not null,
        end_time timestamp with time zone not null,
        product_images json not null,
        barcode text,
        name text,
        brand text,
        ingredients json,
        response_status integer not null,
        feedback_rating integer not null default 0,
        constraint log_extract_key primary key (activity_id)
    ) tablespace pg_default;

ALTER TABLE public.log_extract ENABLE ROW LEVEL SECURITY;

create policy "Select for all authenticated users" on public.log_extract
    for select
    using (true);

create policy "Insert for authenticated users" on public.log_extract
    for insert
    with check (auth.uid() = user_id);

--------------------------------------------------------------------------------

CREATE TABLE
public.log_analyzebarcode (
    activity_id uuid not null,
    user_id uuid not null,
    client_activity_id uuid,
    created_at timestamp with time zone not null default now(),
    start_time timestamp with time zone not null,
    end_time timestamp with time zone not null,
    request_body json not null,
    response_status integer not null,
    response_body json not null,
    feedback_rating integer not null default 0,
    feedback_text text,
    constraint log_infer_key primary key (activity_id)
) tablespace pg_default;

ALTER TABLE public.log_analyzebarcode ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_update_own_log_infer ON public.log_analyzebarcode
    FOR ALL
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------

CREATE TABLE
public.log_llmcall (
    id uuid not null,
    created_at timestamp with time zone not null default now(),
    activity_id uuid not null,
    user_id uuid not null,
    conversation_id uuid not null,
    parentconversation_ids uuid[] null,
    start_time timestamp with time zone not null,
    end_time timestamp with time zone not null,
    agent_name text not null,
    model_provider text not null,
    model_name text not null,
    temperature numeric not null,
    function_call text not null,
    functions json not null,
    messages json not null,
    response json,
    constraint log_agents_key primary key (id)
) tablespace pg_default;

ALTER TABLE public.log_llmcall ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_update_own_log_llmcall ON public.log_llmcall
    FOR ALL
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------


--------------------------------------------------------------------------------