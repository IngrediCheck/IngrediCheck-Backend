
--------------------------------------------------------------------------------

create table
    public.user_list_items (
        created_at timestamp with time zone not null default now(),
        user_id uuid not null,
        list_id uuid not null,
        list_item_id uuid not null,
        constraint user_list_items_pkey primary key (list_item_id)
    ) tablespace pg_default;

alter table public.user_list_items enable row level security;

CREATE POLICY user_update_own_user_list_items ON public.user_list_items
    FOR ALL
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------

create table
    public.log_images (
        created_at timestamp with time zone not null default now(),
        user_id uuid not null,
        client_activity_id uuid not null,
        activity_id uuid not null,
        image_file_hash text not null,
        image_ocrtext_ios text not null,
        barcode_ios text,
        constraint log_images_key primary key (image_file_hash)
    ) tablespace pg_default;

alter table public.log_images enable row level security;

create policy "Select for all authenticated users" on public.log_images
    for select
    using (true);

create policy "Insert for authenticated users" on public.log_images
    for insert
    with check (auth.uid() = user_id);

--------------------------------------------------------------------------------

create table
    public.log_feedback (
        created_at timestamp with time zone not null default now(),
        user_id uuid not null,
        client_activity_id uuid not null,
        activity_id uuid not null,
        rating integer not null,
        reasons text[],
        note text,
        images text[],
        constraint log_feedback_key primary key (client_activity_id)
    );

ALTER TABLE public.log_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_update_own_log_infer ON public.log_feedback
    FOR ALL
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------

create table
    public.log_inventory (
        created_at timestamp with time zone not null default now(),
        user_id uuid not null,
        client_activity_id uuid,
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
        barcode text,
        name text,
        brand text,
        ingredients json,
        response_status integer not null,
        images text[],
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
    client_activity_id uuid,
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

CREATE OR REPLACE FUNCTION get_check_history()
RETURNS TABLE (
    created_at TIMESTAMP WITH TIME ZONE,
    client_activity_id UUID,
    barcode TEXT,
    name TEXT,
    brand TEXT,
    ingredients JSON,
    images JSON,
    ingredient_recommendations JSON,
    rating INTEGER,
    favorited BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        la.created_at,
        la.client_activity_id,
        COALESCE(li.barcode, le.barcode) AS barcode,
        COALESCE(li.name, le.name) AS name,
        COALESCE(li.brand, le.brand) AS brand,
        COALESCE(li.ingredients, le.ingredients) AS ingredients,
        COALESCE(
            li.images,
            (SELECT json_agg(json_build_object('imageFileHash', text_val)) FROM unnest(le.images) AS dt(text_val))
        ) AS images,
        la.response_body AS ingredient_recommendations,
        COALESCE(lf.rating, 0) AS rating,
        EXISTS(
            SELECT 1
            FROM public.user_list_items uli
            WHERE
                uli.list_item_id = la.client_activity_id
                AND uli.list_id = '00000000-0000-0000-0000-000000000000'::uuid
        ) AS favorited
    FROM
        public.log_analyzebarcode la
    LEFT JOIN public.log_inventory li 
        ON la.client_activity_id = li.client_activity_id 
    LEFT JOIN public.log_extract le 
        ON la.client_activity_id = le.client_activity_id 
    LEFT JOIN public.log_feedback lf
        ON la.client_activity_id = lf.client_activity_id
    WHERE
        la.created_at > '2024-02-24'::date
        AND
        (
            li.client_activity_id IS NOT NULL
            OR
            le.client_activity_id IS NOT NULL
        )
    ORDER BY
        la.created_at DESC;
END;
$$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_list_items(input_list_id uuid)
RETURNS TABLE(
    created_at TIMESTAMP WITH TIME ZONE,
    list_id uuid,
    list_item_id uuid,
    barcode TEXT,
    name TEXT,
    brand TEXT,
    ingredients JSON,
    images JSON
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        uli.created_at,
        uli.list_id,
        uli.list_item_id,
        COALESCE(li.barcode, le.barcode) AS barcode,
        COALESCE(li.name, le.name) AS name,
        COALESCE(li.brand, le.brand) AS brand,
        COALESCE(li.ingredients, le.ingredients::json) AS ingredients,
        COALESCE(
            li.images,
            (SELECT json_agg(json_build_object('imageFileHash', text_val)) FROM unnest(le.images) AS dt(text_val))
        ) AS images
    FROM
        public.user_list_items uli
        LEFT JOIN public.log_inventory li ON uli.list_item_id = li.client_activity_id
        LEFT JOIN public.log_extract le ON uli.list_item_id = le.client_activity_id
    WHERE
        uli.list_id = input_list_id
        AND
        (
            li.client_activity_id IS NOT NULL
            OR
            le.client_activity_id IS NOT NULL
        )
    ORDER BY
        uli.created_at DESC;
END;
$$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------