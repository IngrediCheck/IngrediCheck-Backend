drop function if exists "public"."barcode_review_list"(p_limit integer, p_offset integer, p_status text);

drop function if exists "public"."extract_review_list_enhanced"(p_limit integer, p_offset integer, p_status text);

drop function if exists "public"."preferences_review_list"(p_limit integer, p_offset integer, p_status text);

create table "public"."inventory_cache" (
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "last_refreshed_at" timestamp with time zone,
    "barcode" text not null,
    "data_source" text not null default 'openfoodfacts/v3'::text,
    "name" text,
    "brand" text,
    "ingredients" jsonb not null default '[]'::jsonb,
    "images" jsonb not null default '[]'::jsonb,
    "off_last_modified_t" bigint,
    "etag" text
);


alter table "public"."inventory_cache" enable row level security;

create table "public"."review_expected_outputs" (
    "id" uuid not null default gen_random_uuid(),
    "thread_id" uuid not null,
    "expected_output" jsonb not null,
    "status_at_save" text default 'need_review'::text,
    "created_at" timestamp with time zone default now(),
    "created_by" uuid,
    "updated_at" timestamp with time zone default now()
);


alter table "public"."review_expected_outputs" enable row level security;

create table "public"."waitlist" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "created_at" timestamp with time zone not null default now(),
    "status" text not null default 'pending'::text
);


alter table "public"."waitlist" enable row level security;

alter table "public"."review_threads" add column "expected_output" jsonb;

CREATE OR REPLACE FUNCTION public.normalized_barcode(input_barcode text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
    select case
        when input_barcode is null then null
        -- Trim common formatting characters before we normalise
        when input_barcode <> regexp_replace(input_barcode, '[^0-9]', '', 'g')
            then public.normalized_barcode(regexp_replace(input_barcode, '[^0-9]', '', 'g'))
        -- Collapse 7/8 digit retail codes to their zero padded 8-digit form
        when length(input_barcode) between 1 and 8 then lpad(input_barcode, 8, '0')
        -- Normalise UPC-A (12) and EAN-13 codes to the 13-digit variant so that
        -- values with a single leading zero collate together whilst keeping
        -- 8-digit types distinct from 13-digit types.
        when length(input_barcode) between 9 and 13 then lpad(input_barcode, 13, '0')
        -- ITF-14 and similar logistics codes stay at 14 digits so they do not
        -- match unrelated shorter formats unless the first 13 digits align.
        when length(input_barcode) = 14 then lpad(input_barcode, 14, '0')
        else input_barcode
    end
$function$
;

CREATE INDEX idx_waitlist_created_at ON public.waitlist USING btree (created_at DESC);

CREATE INDEX idx_waitlist_email ON public.waitlist USING btree (email);

CREATE INDEX inventory_cache_barcode_norm_idx ON public.inventory_cache USING btree (normalized_barcode(barcode));

CREATE UNIQUE INDEX inventory_cache_pkey ON public.inventory_cache USING btree (barcode);

CREATE UNIQUE INDEX review_expected_outputs_pkey ON public.review_expected_outputs USING btree (id);

CREATE INDEX review_expected_outputs_thread_id_idx ON public.review_expected_outputs USING btree (thread_id, created_at DESC);

CREATE UNIQUE INDEX waitlist_email_key ON public.waitlist USING btree (email);

CREATE UNIQUE INDEX waitlist_pkey ON public.waitlist USING btree (id);

alter table "public"."inventory_cache" add constraint "inventory_cache_pkey" PRIMARY KEY using index "inventory_cache_pkey";

alter table "public"."review_expected_outputs" add constraint "review_expected_outputs_pkey" PRIMARY KEY using index "review_expected_outputs_pkey";

alter table "public"."waitlist" add constraint "waitlist_pkey" PRIMARY KEY using index "waitlist_pkey";

alter table "public"."review_expected_outputs" add constraint "review_expected_outputs_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES review_threads(id) ON DELETE CASCADE not valid;

alter table "public"."review_expected_outputs" validate constraint "review_expected_outputs_thread_id_fkey";

alter table "public"."waitlist" add constraint "waitlist_email_key" UNIQUE using index "waitlist_email_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.barcode_review_filtered_count(p_status text DEFAULT NULL::text, p_search_query text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.log_analyzebarcode la
    LEFT JOIN public.log_inventory li ON li.client_activity_id = la.client_activity_id
    LEFT JOIN public.review_threads rt 
      ON rt.source_table = 'log_analyzebarcode' 
      AND rt.source_id = la.activity_id::text
    WHERE (
      p_status IS NULL 
      OR p_status = 'all' 
      OR (p_status = 'open' AND (rt.status IS NULL OR rt.status = 'unreviewed'))
      OR rt.status = p_status
    )
    AND (
      p_search_query IS NULL OR
      LOWER(COALESCE(li.name, '')) LIKE '%' || LOWER(p_search_query) || '%' OR
      LOWER(COALESCE(li.brand, '')) LIKE '%' || LOWER(p_search_query) || '%' OR
      LOWER(COALESCE(li.barcode, '')) LIKE '%' || LOWER(p_search_query) || '%'
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.barcode_review_list(p_limit integer DEFAULT 50, p_status text DEFAULT NULL::text, p_offset integer DEFAULT 0)
 RETURNS TABLE(thread_id text, subject_id text, product_name text, barcode text, category text, output_interpretation jsonb, status text, latency_ms numeric, created_at timestamp with time zone, reviewer_ids uuid[], comment_count bigint, expected_output jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH barcode_data AS (
    SELECT 
      la.activity_id,
      la.client_activity_id,
      la.created_at,
      la.start_time,
      la.end_time,
      la.request_body::jsonb as request_body,
      la.response_body::jsonb as response_body,
      la.response_status,
      la.user_id,
      rt.status as thread_status,
      rt.id as thread_uuid,
      rt.expected_output,
      li.name as inventory_name,
      li.brand as inventory_brand,
      li.barcode as inventory_barcode,
      li.ingredients::jsonb as inventory_ingredients,
      li.images::jsonb as inventory_images,
      li.data_source,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'imageFileHash', img.image_file_hash,
            'barcode', img.barcode_ios,
            'ocrText', img.image_ocrtext_ios
          )
        )
        FROM public.log_images img 
        WHERE img.client_activity_id = la.client_activity_id
      ) as log_images_data,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'text', dp.text,
            'annotated_text', dp.annotated_text
          )
        )
        FROM public.dietary_preferences dp
        WHERE dp.user_id = la.user_id
        AND dp.deleted_at IS NULL
      ) as user_preferences
    FROM public.log_analyzebarcode la
    LEFT JOIN public.log_inventory li ON li.client_activity_id = la.client_activity_id
    LEFT JOIN public.review_threads rt 
      ON rt.source_table = 'log_analyzebarcode' 
      AND rt.source_id = la.activity_id::text
    WHERE (
      p_status IS NULL 
      OR p_status = 'all' 
      OR (p_status = 'open' AND (rt.status IS NULL OR rt.status = 'unreviewed'))
      OR rt.status = p_status
    )
    ORDER BY la.created_at DESC
    OFFSET p_offset
    LIMIT p_limit
  )
  SELECT 
    COALESCE(bd.client_activity_id::text, bd.activity_id::text) AS thread_id,
    COALESCE(bd.client_activity_id::text, bd.activity_id::text) AS subject_id,
    COALESCE(
      bd.inventory_name, 
      CASE WHEN bd.response_status = 200 THEN bd.response_body->>'name' ELSE NULL END,
      bd.request_body->>'text', 
      'Unknown Product'
    )::text AS product_name,
    COALESCE(
      bd.inventory_barcode, 
      CASE WHEN bd.response_status = 200 THEN bd.response_body->>'barcode' ELSE NULL END,
      bd.request_body->>'barcode', 
      'N/A'
    )::text AS barcode,
    COALESCE(bd.data_source, 'Analyze')::text AS category,
    jsonb_build_object(
      'product', jsonb_build_object(
        'name', COALESCE(bd.inventory_name, bd.response_body->>'name', 'Unknown Product'),
        'brand', COALESCE(bd.inventory_brand, bd.response_body->>'brand', ''),
        'barcode', COALESCE(bd.inventory_barcode, bd.response_body->>'barcode', bd.request_body->>'barcode', ''),
        'ingredients', COALESCE(
          bd.inventory_ingredients, 
          bd.response_body->'ingredients',
          '[]'::jsonb
        ),
        'ingredients_text', COALESCE(
          bd.response_body->>'ingredients_text',
          bd.request_body->>'ingredients_text',
          bd.response_body->>'ingredients',
          ''
        ),
        'images', COALESCE(
          bd.inventory_images,
          bd.log_images_data,
          '[]'::jsonb
        )
      ),
      'response', COALESCE(bd.response_body, '{}'::jsonb),
      'matchStatus', CASE 
        WHEN bd.response_status = 200 THEN 'matched'
        ELSE 'unmatched'
      END,
      'userPreferences', COALESCE(bd.user_preferences, '[]'::jsonb),
      'violations', COALESCE(bd.response_body->'violations', '[]'::jsonb),
      'matches', COALESCE(bd.response_body->'matches', '{}'::jsonb),
      'result', COALESCE(bd.response_body->'result', '{}'::jsonb),
      'unmatched', COALESCE(bd.response_body->'unmatched', '[]'::jsonb),
      'ingredient_violations', COALESCE(bd.response_body->'ingredient_violations', '[]'::jsonb),
      'explanation', COALESCE(bd.response_body->>'explanation', ''),
      'status', COALESCE(bd.response_body->>'status', CASE 
        WHEN bd.response_status = 200 THEN 'matched'
        ELSE 'unmatched'
      END)
    ) AS output_interpretation,
    COALESCE(bd.thread_status, 'unreviewed') AS status,
    ROUND(EXTRACT(EPOCH FROM (bd.end_time - bd.start_time)) * 1000)::numeric AS latency_ms,
    bd.created_at,
    ARRAY[]::uuid[] AS reviewer_ids,
    COALESCE((
      SELECT COUNT(*) FROM public.review_comments rc
      WHERE rc.thread_id = bd.thread_uuid
    ), 0)::bigint AS comment_count,
    bd.expected_output
  FROM barcode_data bd;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_review_filtered_count(p_status text DEFAULT NULL::text, p_search_query text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.log_extract le
    LEFT JOIN public.review_threads rt 
      ON rt.source_table = 'log_extract' 
      AND rt.source_id = le.activity_id::text
    WHERE (
      p_status IS NULL 
      OR p_status = 'all' 
      OR (p_status = 'open' AND (rt.status IS NULL OR rt.status = 'unreviewed'))
      OR rt.status = p_status
    )
    AND (
      p_search_query IS NULL OR
      LOWER(COALESCE(le.name, '')) LIKE '%' || LOWER(p_search_query) || '%' OR
      LOWER(COALESCE(le.brand, '')) LIKE '%' || LOWER(p_search_query) || '%' OR
      LOWER(COALESCE(le.barcode, '')) LIKE '%' || LOWER(p_search_query) || '%'
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_review_list_enhanced(p_limit integer DEFAULT 50, p_status text DEFAULT NULL::text, p_offset integer DEFAULT 0)
 RETURNS TABLE(thread_id text, subject_id text, product_name text, barcode text, category text, output_json text, input_json text, status text, latency_ms numeric, created_at timestamp with time zone, reviewer_ids uuid[], reviewers jsonb, comment_count bigint, expected_output jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH extract_data AS (
    SELECT 
      le.activity_id,
      le.client_activity_id,
      le.created_at,
      le.start_time,
      le.end_time,
      le.name,
      le.brand,
      le.barcode,
      le.ingredients::jsonb as ingredients,
      le.images,
      le.response_status,
      le.user_id,
      rt.status as thread_status,
      rt.id as thread_uuid,
      rt.expected_output,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'imageFileHash', img.image_file_hash,
            'barcode', img.barcode_ios,
            'ocrText', img.image_ocrtext_ios
          )
        )
        FROM public.log_images img 
        WHERE img.client_activity_id = le.client_activity_id
      ) as log_images_data,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'text', dp.text,
            'annotated_text', dp.annotated_text
          )
        )
        FROM public.dietary_preferences dp
        WHERE dp.user_id = le.user_id
        AND dp.deleted_at IS NULL
      ) as user_preferences,
      (
        SELECT response_body::jsonb
        FROM public.log_analyzebarcode la
        WHERE la.client_activity_id = le.client_activity_id
        LIMIT 1
      ) as analyze_response
    FROM public.log_extract le
    LEFT JOIN public.review_threads rt 
      ON rt.source_table = 'log_extract' 
      AND rt.source_id = le.activity_id::text
    WHERE (
      p_status IS NULL 
      OR p_status = 'all' 
      OR (p_status = 'open' AND (rt.status IS NULL OR rt.status = 'unreviewed'))
      OR rt.status = p_status
    )
    ORDER BY le.created_at DESC
    OFFSET p_offset
    LIMIT p_limit
  )
  SELECT 
    COALESCE(ed.client_activity_id::text, ed.activity_id::text) AS thread_id,
    COALESCE(ed.client_activity_id::text, ed.activity_id::text) AS subject_id,
    COALESCE(ed.name, 'Unknown Product')::text AS product_name,
    COALESCE(ed.barcode, 'N/A')::text AS barcode,
    'Extract'::text AS category,
    (jsonb_build_object(
      'name', ed.name,
      'brand', ed.brand,
      'barcode', ed.barcode,
      'ingredients', COALESCE(ed.ingredients, '[]'::jsonb),
      'allIngredients', COALESCE(ed.ingredients, '[]'::jsonb),
      'images', COALESCE(
        CASE 
          WHEN ed.images IS NOT NULL AND array_length(ed.images, 1) > 0 THEN 
            (SELECT jsonb_agg(jsonb_build_object('imageFileHash', img_hash))
             FROM unnest(ed.images) AS img_hash)
          ELSE NULL
        END,
        ed.log_images_data,
        '[]'::jsonb
      ),
      'matchStatus', CASE 
        WHEN ed.name IS NOT NULL OR ed.brand IS NOT NULL THEN 'matched'
        ELSE 'unmatched'
      END,
      'userPreferences', COALESCE(ed.user_preferences, '[]'::jsonb),
      'violations', COALESCE(ed.analyze_response, '[]'::jsonb),
      'llm_analysis', jsonb_build_object(
        'violations', COALESCE(ed.analyze_response, '[]'::jsonb),
        'has_violations', COALESCE(jsonb_array_length(ed.analyze_response), 0) > 0,
        'violation_count', COALESCE(jsonb_array_length(ed.analyze_response), 0)
      ),
      'response_status', ed.response_status
    ))::text AS output_json,
    '{}'::text AS input_json,
    COALESCE(ed.thread_status, 'unreviewed') AS status,
    ROUND(EXTRACT(EPOCH FROM (ed.end_time - ed.start_time)) * 1000)::numeric AS latency_ms,
    ed.created_at,
    ARRAY[]::uuid[] AS reviewer_ids,
    '[]'::jsonb AS reviewers,
    COALESCE((
      SELECT COUNT(*) FROM public.review_comments rc
      WHERE rc.thread_id = ed.thread_uuid
    ), 0)::bigint AS comment_count,
    ed.expected_output
  FROM extract_data ed;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.preferences_review_filtered_count(p_status text DEFAULT NULL::text, p_search_query text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.dietary_preferences dp
    LEFT JOIN public.review_threads rt 
      ON rt.source_table = 'dietary_preferences' 
      AND rt.source_id = dp.id::text
    WHERE dp.deleted_at IS NULL
    AND (
      p_status IS NULL 
      OR p_status = 'all' 
      OR (p_status = 'open' AND (rt.status IS NULL OR rt.status = 'unreviewed'))
      OR rt.status = p_status
    )
    AND (
      p_search_query IS NULL OR
      LOWER(COALESCE(dp.text, '')) LIKE '%' || LOWER(p_search_query) || '%' OR
      LOWER(COALESCE(dp.annotated_text, '')) LIKE '%' || LOWER(p_search_query) || '%'
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.preferences_review_list(p_limit integer DEFAULT 50, p_status text DEFAULT NULL::text, p_offset integer DEFAULT 0)
 RETURNS TABLE(thread_id text, subject_id text, input_json text, output_json text, status text, latency_ms numeric, created_at timestamp with time zone, reviewer_ids uuid[], comment_count bigint, expected_output jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    dp.id::text AS thread_id,
    dp.id::text AS subject_id,
    COALESCE(dp.text, '')::text AS input_json,
    COALESCE(dp.annotated_text, '')::text AS output_json,
    COALESCE(rt.status, 'unreviewed')::text AS status,
    0::numeric AS latency_ms,
    dp.created_at,
    ARRAY[]::uuid[] AS reviewer_ids,
    COALESCE((
      SELECT COUNT(*) FROM public.review_comments rc
      WHERE rc.thread_id = rt.id
    ), 0)::bigint AS comment_count,
    rt.expected_output
  FROM public.dietary_preferences dp
  LEFT JOIN public.review_threads rt
    ON rt.source_table = 'dietary_preferences'
    AND rt.source_id = dp.id::text
  WHERE dp.deleted_at IS NULL
    AND (
      p_status IS NULL 
      OR p_status = 'all' 
      OR (p_status = 'open' AND (rt.status IS NULL OR rt.status = 'unreviewed'))
      OR rt.status = p_status
    )
  ORDER BY dp.created_at DESC
  OFFSET p_offset
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_inventory_cache_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.export_promoted_llm_data(p_tab_type text DEFAULT 'all'::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 10000)
 RETURNS TABLE(id text, dietary_preferences text, images jsonb, image_hashes text[], product_info text, flagged_ingredients text, tab_type text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  user_role text;
  is_admin_user boolean;
  is_reviewer_user boolean;
BEGIN
  SELECT get_user_role(auth.uid()) INTO user_role;
  SELECT is_admin(auth.uid()) INTO is_admin_user;
  SELECT is_reviewer(auth.uid()) INTO is_reviewer_user;
  
  IF NOT (is_admin_user OR is_reviewer_user) THEN
    RAISE EXCEPTION 'Access denied. Admin or reviewer role required.';
  END IF;
  
  IF p_date_from IS NULL THEN
    p_date_from := NOW() - INTERVAL '365 days';
  END IF;
  IF p_date_to IS NULL THEN
    p_date_to := NOW();
  END IF;
  
  RETURN QUERY
  WITH combined_data AS (
    -- Extract LLM data WITH linked Analyzer data
    SELECT 
      le.activity_id::text as id,
      -- Get dietary preferences from linked analyzer
      COALESCE(
        (SELECT lab2.request_body::jsonb->>'userPreferenceText'
         FROM log_analyzebarcode lab2 
         WHERE lab2.client_activity_id = le.client_activity_id
         LIMIT 1),
        '[]'
      ) as dietary_preferences,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'type', 'extract_image',
              'url', 
              'https://wqidjkpfdrvomfkmefqc.supabase.co/storage/v1/object/public/productimages/' || li.image_file_hash || '.jpg',
              'ocr_text',
              COALESCE(li.image_ocrtext_ios, '')
            )
          )
          FROM log_images li
          WHERE li.client_activity_id = le.client_activity_id
            AND li.image_file_hash IS NOT NULL 
            AND trim(li.image_file_hash) != ''
        ),
        '[]'::jsonb
      ) as images,
      ARRAY(
        SELECT li.image_file_hash
        FROM log_images li
        WHERE li.client_activity_id = le.client_activity_id
          AND li.image_file_hash IS NOT NULL 
          AND trim(li.image_file_hash) != ''
      ) as image_hashes,
      COALESCE(
        jsonb_build_object(
          'name', COALESCE(le.name, ''),
          'brand', COALESCE(le.brand, ''),
          'ingredients', COALESCE(le.ingredients::text, ''),
          'barcode', COALESCE(le.barcode, ''),
          'matchStatus', 'unknown',
          'extraction_latency', COALESCE(ROUND(EXTRACT(EPOCH FROM (le.end_time - le.start_time)) * 1000)::text, '0')
        )::text,
        '{}'
      ) as product_info,
      -- Get flagged ingredients from linked analyzer (response_body IS an array)
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', violation->>'ingredientName',
              'preference', violation->>'preference',
              'safetyRecommendation', violation->>'safetyRecommendation',
              'reasoning', violation->>'reasoning'
            )
          )::text
          FROM (
            SELECT lab3.response_body::jsonb as violations_array
            FROM log_analyzebarcode lab3
            WHERE lab3.client_activity_id = le.client_activity_id
              AND jsonb_typeof(lab3.response_body::jsonb) = 'array'
            LIMIT 1
          ) lab3_data,
          jsonb_array_elements(lab3_data.violations_array) as violation
        ),
        '[]'
      ) as flagged_ingredients,
      'extract'::text as tab_type,
      le.created_at,
      1 as sort_order
    FROM log_extract le
    WHERE le.created_at >= p_date_from
      AND le.created_at <= p_date_to
      AND (p_tab_type = 'all' OR p_tab_type = 'extract')
    
    UNION ALL
    
    -- Analyzer LLM data (response_body IS an array)
    SELECT 
      lab.activity_id::text as id,
      COALESCE(
        (lab.request_body::jsonb->>'userPreferenceText')::text,
        '[]'
      ) as dietary_preferences,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'type', 'barcode_image',
              'url', 
              'https://wqidjkpfdrvomfkmefqc.supabase.co/storage/v1/object/public/productimages/' || li.image_file_hash || '.jpg',
              'ocr_text',
              COALESCE(li.image_ocrtext_ios, '')
            )
          )
          FROM log_images li
          WHERE li.client_activity_id = lab.client_activity_id
            AND li.image_file_hash IS NOT NULL 
            AND trim(li.image_file_hash) != ''
        ),
        '[]'::jsonb
      ) as images,
      ARRAY(
        SELECT li.image_file_hash
        FROM log_images li
        WHERE li.client_activity_id = lab.client_activity_id
          AND li.image_file_hash IS NOT NULL 
          AND trim(li.image_file_hash) != ''
      ) as image_hashes,
      COALESCE(
        jsonb_build_object(
          'name', COALESCE((lab.request_body::jsonb->>'productName'), ''),
          'brand', COALESCE((lab.request_body::jsonb->>'brand'), ''),
          'ingredients', COALESCE((lab.request_body::jsonb->>'ingredients'), ''),
          'barcode', COALESCE((lab.request_body::jsonb->>'barcode'), ''),
          'matchStatus', 'analyzed'
        )::text,
        '{}'
      ) as product_info,
      -- response_body is array of violations
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', violation->>'ingredientName',
              'preference', violation->>'preference',
              'safetyRecommendation', violation->>'safetyRecommendation',
              'reasoning', violation->>'reasoning'
            )
          )::text
          FROM jsonb_array_elements(
            CASE 
              WHEN jsonb_typeof(lab.response_body::jsonb) = 'array' 
              THEN lab.response_body::jsonb
              ELSE '[]'::jsonb
            END
          ) as violation
        ),
        '[]'
      ) as flagged_ingredients,
      'analyzer'::text as tab_type,
      lab.created_at,
      2 as sort_order
    FROM log_analyzebarcode lab
    WHERE lab.created_at >= p_date_from
      AND lab.created_at <= p_date_to
      AND (p_tab_type = 'all' OR p_tab_type = 'analyzer')
    
    UNION ALL
    
    -- Preference Validation data
    SELECT 
      dp.id::text as id,
      COALESCE(dp.text, '[]') as dietary_preferences,
      '[]'::jsonb as images,
      ARRAY[]::text[] as image_hashes,
      COALESCE(
        jsonb_build_object(
          'name', 'Dietary Preference Validation',
          'ingredients', COALESCE(dp.annotated_text, ''),
          'confidence_score', '0'
        )::text,
        '{}'
      ) as product_info,
      '[]'::text as flagged_ingredients,
      'preferences'::text as tab_type,
      dp.created_at,
      3 as sort_order
    FROM dietary_preferences dp
    WHERE dp.created_at >= p_date_from
      AND dp.created_at <= p_date_to
      AND dp.deleted_at IS NULL
      AND (p_tab_type = 'all' OR p_tab_type = 'preferences')
  )
  SELECT 
    cd.id,
    cd.dietary_preferences,
    cd.images,
    cd.image_hashes,
    cd.product_info,
    cd.flagged_ingredients,
    cd.tab_type,
    cd.created_at
  FROM combined_data cd
  ORDER BY cd.created_at DESC
  LIMIT p_limit;
  
  RETURN;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_distinct_user_count()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN (SELECT COUNT(DISTINCT id) FROM auth.users);
END;
$function$
;

grant delete on table "public"."inventory_cache" to "anon";

grant insert on table "public"."inventory_cache" to "anon";

grant references on table "public"."inventory_cache" to "anon";

grant select on table "public"."inventory_cache" to "anon";

grant trigger on table "public"."inventory_cache" to "anon";

grant truncate on table "public"."inventory_cache" to "anon";

grant update on table "public"."inventory_cache" to "anon";

grant delete on table "public"."inventory_cache" to "authenticated";

grant insert on table "public"."inventory_cache" to "authenticated";

grant references on table "public"."inventory_cache" to "authenticated";

grant select on table "public"."inventory_cache" to "authenticated";

grant trigger on table "public"."inventory_cache" to "authenticated";

grant truncate on table "public"."inventory_cache" to "authenticated";

grant update on table "public"."inventory_cache" to "authenticated";

grant delete on table "public"."inventory_cache" to "service_role";

grant insert on table "public"."inventory_cache" to "service_role";

grant references on table "public"."inventory_cache" to "service_role";

grant select on table "public"."inventory_cache" to "service_role";

grant trigger on table "public"."inventory_cache" to "service_role";

grant truncate on table "public"."inventory_cache" to "service_role";

grant update on table "public"."inventory_cache" to "service_role";

grant delete on table "public"."review_expected_outputs" to "anon";

grant insert on table "public"."review_expected_outputs" to "anon";

grant references on table "public"."review_expected_outputs" to "anon";

grant select on table "public"."review_expected_outputs" to "anon";

grant trigger on table "public"."review_expected_outputs" to "anon";

grant truncate on table "public"."review_expected_outputs" to "anon";

grant update on table "public"."review_expected_outputs" to "anon";

grant delete on table "public"."review_expected_outputs" to "authenticated";

grant insert on table "public"."review_expected_outputs" to "authenticated";

grant references on table "public"."review_expected_outputs" to "authenticated";

grant select on table "public"."review_expected_outputs" to "authenticated";

grant trigger on table "public"."review_expected_outputs" to "authenticated";

grant truncate on table "public"."review_expected_outputs" to "authenticated";

grant update on table "public"."review_expected_outputs" to "authenticated";

grant delete on table "public"."review_expected_outputs" to "service_role";

grant insert on table "public"."review_expected_outputs" to "service_role";

grant references on table "public"."review_expected_outputs" to "service_role";

grant select on table "public"."review_expected_outputs" to "service_role";

grant trigger on table "public"."review_expected_outputs" to "service_role";

grant truncate on table "public"."review_expected_outputs" to "service_role";

grant update on table "public"."review_expected_outputs" to "service_role";

grant delete on table "public"."waitlist" to "anon";

grant insert on table "public"."waitlist" to "anon";

grant references on table "public"."waitlist" to "anon";

grant select on table "public"."waitlist" to "anon";

grant trigger on table "public"."waitlist" to "anon";

grant truncate on table "public"."waitlist" to "anon";

grant update on table "public"."waitlist" to "anon";

grant delete on table "public"."waitlist" to "authenticated";

grant insert on table "public"."waitlist" to "authenticated";

grant references on table "public"."waitlist" to "authenticated";

grant select on table "public"."waitlist" to "authenticated";

grant trigger on table "public"."waitlist" to "authenticated";

grant truncate on table "public"."waitlist" to "authenticated";

grant update on table "public"."waitlist" to "authenticated";

grant delete on table "public"."waitlist" to "service_role";

grant insert on table "public"."waitlist" to "service_role";

grant references on table "public"."waitlist" to "service_role";

grant select on table "public"."waitlist" to "service_role";

grant trigger on table "public"."waitlist" to "service_role";

grant truncate on table "public"."waitlist" to "service_role";

grant update on table "public"."waitlist" to "service_role";

create policy "Select for all authenticated users"
on "public"."inventory_cache"
as permissive
for select
to public
using (true);


create policy "Write for service role only"
on "public"."inventory_cache"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "Admins can manage all expected outputs"
on "public"."review_expected_outputs"
as permissive
for all
to public
using (is_admin(auth.uid()));


create policy "Reviewers can add expected outputs to any thread"
on "public"."review_expected_outputs"
as permissive
for insert
to public
with check (is_reviewer(auth.uid()));


create policy "Reviewers can view expected outputs on any thread"
on "public"."review_expected_outputs"
as permissive
for select
to public
using ((is_reviewer(auth.uid()) OR is_admin(auth.uid())));


create policy "Admins can delete waitlist entries"
on "public"."waitlist"
as permissive
for delete
to public
using (is_admin(auth.uid()));


create policy "Admins can update waitlist entries"
on "public"."waitlist"
as permissive
for update
to public
using (is_admin(auth.uid()));


create policy "Admins can view all waitlist entries"
on "public"."waitlist"
as permissive
for select
to public
using (is_admin(auth.uid()));


create policy "Anyone can join waitlist"
on "public"."waitlist"
as permissive
for insert
to public
with check (true);


CREATE TRIGGER trg_inventory_cache_updated_at BEFORE UPDATE ON public.inventory_cache FOR EACH ROW EXECUTE FUNCTION set_inventory_cache_updated_at();

CREATE TRIGGER trg_review_expected_outputs_set_updated_at BEFORE UPDATE ON public.review_expected_outputs FOR EACH ROW EXECUTE FUNCTION set_updated_at();


