

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."analytics_analyze_latency"("limit_count" integer DEFAULT 100, "min_latency_ms" numeric DEFAULT 0, "max_latency_ms" numeric DEFAULT NULL::numeric) RETURNS TABLE("created_at" timestamp with time zone, "activity_id" "text", "latency" numeric, "request_body" "jsonb", "response_status" integer, "response_body" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  RETURN QUERY
  SELECT
    lab.created_at,
    lab.activity_id::text,
    ROUND(
      (
        (
          EXTRACT(EPOCH FROM lab.end_time) - EXTRACT(EPOCH FROM lab.start_time)
        ) * 1000
      )::numeric / 1000,
      3
    ) AS latency,
    lab.request_body,
    lab.response_status,
    lab.response_body
  FROM public.log_analyzebarcode lab
  WHERE (min_latency_ms IS NULL OR 
         ROUND(
           (
             (
               EXTRACT(EPOCH FROM lab.end_time) - EXTRACT(EPOCH FROM lab.start_time)
             ) * 1000
           )::numeric / 1000,
           3
         ) >= min_latency_ms)
    AND (max_latency_ms IS NULL OR 
         ROUND(
           (
             (
               EXTRACT(EPOCH FROM lab.end_time) - EXTRACT(EPOCH FROM lab.start_time)
             ) * 1000
           )::numeric / 1000,
           3
         ) <= max_latency_ms)
  ORDER BY lab.created_at DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."analytics_analyze_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analytics_analyze_latency_stats"("days_back" integer DEFAULT 30) RETURNS TABLE("total_requests" bigint, "avg_latency" numeric, "min_latency" numeric, "max_latency" numeric, "p95_latency" numeric, "p99_latency" numeric, "success_rate" numeric, "error_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  RETURN QUERY
  WITH latency_data AS (
    SELECT
      ROUND(
        (
          (
            EXTRACT(EPOCH FROM lab.end_time) - EXTRACT(EPOCH FROM lab.start_time)
          ) * 1000
        )::numeric / 1000,
        3
      ) AS latency,
      lab.response_status
    FROM public.log_analyzebarcode lab
    WHERE lab.created_at > CURRENT_DATE - (days_back || ' days')::interval
      AND lab.start_time IS NOT NULL 
      AND lab.end_time IS NOT NULL
  )
  SELECT
    COUNT(*)::bigint AS total_requests,
    ROUND(AVG(latency), 3) AS avg_latency,
    MIN(latency) AS min_latency,
    MAX(latency) AS max_latency,
    ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency))::numeric, 3) AS p95_latency,
    ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency))::numeric, 3) AS p99_latency,
    ROUND(
      (COUNT(*) FILTER (WHERE response_status = 200)::numeric / COUNT(*)) * 100, 
      2
    ) AS success_rate,
    COUNT(*) FILTER (WHERE response_status != 200) AS error_count
  FROM latency_data;
END;
$$;


ALTER FUNCTION "public"."analytics_analyze_latency_stats"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analytics_inventory_latency"("limit_count" integer DEFAULT 100, "min_latency_ms" numeric DEFAULT 0, "max_latency_ms" numeric DEFAULT NULL::numeric, "user_filter" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("created_at" timestamp with time zone, "user_id" "uuid", "barcode" "text", "data_source" "text", "name" "text", "brand" "text", "ingredients" "text", "images" "jsonb", "client_activity_id" "text", "latency" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  RETURN QUERY
  SELECT
    li.created_at,
    li.user_id,
    li.barcode::text,
    li.data_source::text,
    li.name::text,
    li.brand::text,
    li.ingredients::text,
    li.images,
    li.client_activity_id::text,
    ROUND(
      (
        (
          EXTRACT(EPOCH FROM li.end_time) - EXTRACT(EPOCH FROM li.start_time)
        ) * 1000
      )::numeric / 1000,
      3
    ) AS latency
  FROM public.log_inventory li
  WHERE (min_latency_ms IS NULL OR 
         ROUND(
           (
             (
               EXTRACT(EPOCH FROM li.end_time) - EXTRACT(EPOCH FROM li.start_time)
             ) * 1000
           )::numeric / 1000,
           3
         ) >= min_latency_ms)
    AND (max_latency_ms IS NULL OR 
         ROUND(
           (
             (
               EXTRACT(EPOCH FROM li.end_time) - EXTRACT(EPOCH FROM li.start_time)
             ) * 1000
           )::numeric / 1000,
           3
         ) <= max_latency_ms)
    AND (user_filter IS NULL OR li.user_id = user_filter)
  ORDER BY li.created_at DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."analytics_inventory_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric, "user_filter" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analytics_inventory_latency_performance"("days_back" integer DEFAULT 30) RETURNS TABLE("data_source" "text", "total_requests" bigint, "avg_latency" numeric, "min_latency" numeric, "max_latency" numeric, "success_rate" numeric, "total_images" bigint, "avg_images_per_request" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  RETURN QUERY
  WITH inventory_stats AS (
    SELECT
      li.data_source,
      ROUND(( (EXTRACT(EPOCH FROM li.end_time) - EXTRACT(EPOCH FROM li.start_time)) * 1000 )::numeric / 1000, 3) AS latency,
      li.images,
      CASE 
        WHEN li.name IS NOT NULL AND li.brand IS NOT NULL THEN 1 
        ELSE 0 
      END AS success_flag
    FROM public.log_inventory li
    WHERE li.created_at > CURRENT_DATE - (days_back || ' days')::interval
      AND li.start_time IS NOT NULL 
      AND li.end_time IS NOT NULL
  )
  SELECT
    istats.data_source::text,
    COUNT(*)::bigint AS total_requests,
    ROUND(AVG(istats.latency), 3) AS avg_latency,
    MIN(istats.latency) AS min_latency,
    MAX(istats.latency) AS max_latency,
    ROUND((SUM(istats.success_flag)::numeric / COUNT(*)) * 100, 2) AS success_rate,
    COUNT(istats.images) FILTER (WHERE istats.images IS NOT NULL) AS total_images,
    ROUND(
      AVG(
        CASE 
          WHEN istats.images IS NOT NULL AND json_typeof(istats.images) = 'array' THEN jsonb_array_length((istats.images)::jsonb)
          ELSE 0 
        END
      )::numeric, 2
    ) AS avg_images_per_request
  FROM inventory_stats istats
  GROUP BY istats.data_source
  ORDER BY avg_latency ASC;
END;
$$;


ALTER FUNCTION "public"."analytics_inventory_latency_performance"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analytics_new_users_per_day"("start_date" "date" DEFAULT NULL::"date", "end_date" "date" DEFAULT CURRENT_DATE) RETURNS TABLE("registration_date" "date", "new_users_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  min_date date;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF start_date IS NULL THEN
    SELECT MIN(DATE(created_at)) INTO min_date FROM auth.users;
  ELSE
    min_date := start_date;
  END IF;

  RETURN QUERY
  WITH all_dates AS (
    SELECT generate_series(min_date, end_date, '1 day'::interval)::date AS registration_date
  )
  SELECT
    ad.registration_date,
    COUNT(DISTINCT u.id) AS new_users_count
  FROM all_dates ad
  LEFT JOIN auth.users u ON DATE(u.created_at) = ad.registration_date
  GROUP BY ad.registration_date
  ORDER BY ad.registration_date DESC;
END;
$$;


ALTER FUNCTION "public"."analytics_new_users_per_day"("start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."analytics_repeat_users"("last_n_days" integer DEFAULT 30, "excluded_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "provider_filter" "text" DEFAULT 'apple'::"text") RETURNS TABLE("email" "text", "days_count" integer, "use_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  RETURN QUERY
  WITH recent_users AS (
    SELECT DISTINCT user_id
    FROM public.log_analyzebarcode
    WHERE created_at > CURRENT_DATE - (last_n_days || ' days')::interval
      AND NOT (user_id = ANY(excluded_user_ids))
  ),
  user_days_count AS (
    SELECT
      user_id,
      COUNT(DISTINCT DATE(created_at))::integer AS days_count,
      COUNT(*) AS use_count
    FROM public.log_analyzebarcode
    WHERE user_id IN (SELECT user_id FROM recent_users)
      AND created_at > CURRENT_DATE - (last_n_days || ' days')::interval
    GROUP BY user_id
  )
  SELECT
    (u.email)::text AS email,
    (udc.days_count)::integer AS days_count,
    udc.use_count
  FROM user_days_count udc
  JOIN auth.users u ON u.id = udc.user_id
  JOIN auth.identities i ON i.user_id = u.id
  WHERE (provider_filter IS NULL OR i.provider = provider_filter)
    AND udc.days_count > 1
  ORDER BY udc.days_count DESC;
END;
$$;


ALTER FUNCTION "public"."analytics_repeat_users"("last_n_days" integer, "excluded_user_ids" "uuid"[], "provider_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "new_role" "text", "assigned_by_user_id" "uuid", "notes" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    old_role TEXT;
    current_user_role TEXT;
BEGIN
    -- Check if current user can assign roles
    current_user_role := get_user_role(assigned_by_user_id);
    IF current_user_role != 'admin' THEN
        RAISE EXCEPTION 'Only admins can assign roles';
    END IF;
    
    -- Get old role for audit
    SELECT role INTO old_role FROM user_roles WHERE user_id = target_user_id;
    
    -- Insert or update role
    INSERT INTO user_roles (user_id, role, assigned_by, notes)
    VALUES (target_user_id, new_role, assigned_by_user_id, notes)
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        role = EXCLUDED.role,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = NOW(),
        notes = EXCLUDED.notes;
    
    -- Log the change
    INSERT INTO role_audit_log (user_id, action, old_role, new_role, changed_by)
    VALUES (target_user_id, 'role_assigned', old_role, new_role, assigned_by_user_id);
    
    RETURN true;
END;
$$;


ALTER FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "new_role" "text", "assigned_by_user_id" "uuid", "notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."barcode_review_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.log_analyzebarcode
  );
END;
$$;


ALTER FUNCTION "public"."barcode_review_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."barcode_review_filtered_count"("p_status" "text" DEFAULT NULL::"text", "p_search_query" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."barcode_review_filtered_count"("p_status" "text", "p_search_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."barcode_review_list"("p_limit" integer DEFAULT 50, "p_status" "text" DEFAULT NULL::"text", "p_offset" integer DEFAULT 0) RETURNS TABLE("thread_id" "text", "subject_id" "text", "product_name" "text", "barcode" "text", "category" "text", "output_interpretation" "jsonb", "status" "text", "latency_ms" numeric, "created_at" timestamp with time zone, "reviewer_ids" "uuid"[], "comment_count" bigint, "expected_output" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."barcode_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_review_threads"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  thread_count integer := 0;
  rec record;
BEGIN
  -- Create threads for dietary_preferences entries that don't have them
  FOR rec IN 
    SELECT dp.id::text as id, dp.user_id
    FROM public.dietary_preferences dp
    LEFT JOIN public.review_threads rt ON (rt.source_table = 'dietary_preferences' AND rt.source_id = dp.id::text)
    WHERE rt.id IS NULL AND dp.deleted_at IS NULL
  LOOP
    INSERT INTO public.review_threads (source_table, source_id, thread_type, status, created_by)
    VALUES ('dietary_preferences', rec.id, 'preference_review', 'unreviewed', rec.user_id);
    thread_count := thread_count + 1;
  END LOOP;

  -- Create threads for log_preference_validation entries that don't have them
  FOR rec IN 
    SELECT lpv.id::text as id, lpv.user_id
    FROM public.log_preference_validation lpv
    LEFT JOIN public.review_threads rt ON (rt.source_table = 'log_preference_validation' AND rt.source_id = lpv.id::text)
    WHERE rt.id IS NULL
  LOOP
    INSERT INTO public.review_threads (source_table, source_id, thread_type, status, created_by)
    VALUES ('log_preference_validation', rec.id, 'preference_validation', 'unreviewed', rec.user_id);
    thread_count := thread_count + 1;
  END LOOP;

  -- Create threads for log_analyzebarcode entries that don't have them
  FOR rec IN 
    SELECT lab.activity_id::text as activity_id, lab.user_id
    FROM public.log_analyzebarcode lab
    LEFT JOIN public.review_threads rt ON (rt.source_table = 'log_analyzebarcode' AND rt.source_id = lab.activity_id::text)
    WHERE rt.id IS NULL
  LOOP
    INSERT INTO public.review_threads (source_table, source_id, thread_type, status, created_by)
    VALUES ('log_analyzebarcode', rec.activity_id, 'barcode_review', 'unreviewed', rec.user_id);
    thread_count := thread_count + 1;
  END LOOP;

  -- Create threads for log_extract entries that don't have them
  FOR rec IN 
    SELECT le.activity_id::text as activity_id, le.user_id
    FROM public.log_extract le
    LEFT JOIN public.review_threads rt ON (rt.source_table = 'log_extract' AND rt.source_id = le.activity_id::text)
    WHERE rt.id IS NULL
  LOOP
    INSERT INTO public.review_threads (source_table, source_id, thread_type, status, created_by)
    VALUES ('log_extract', rec.activity_id, 'extract_review', 'unreviewed', rec.user_id);
    thread_count := thread_count + 1;
  END LOOP;

  RETURN 'Created ' || thread_count || ' missing review threads';
END;
$$;


ALTER FUNCTION "public"."ensure_review_threads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."export_promoted_llm_data"("p_tab_type" "text" DEFAULT 'all'::"text", "p_date_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_date_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 10000) RETURNS TABLE("id" "text", "dietary_preferences" "text", "images" "jsonb", "image_hashes" "text"[], "product_info" "text", "flagged_ingredients" "text", "tab_type" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."export_promoted_llm_data"("p_tab_type" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_review_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.log_extract
  );
END;
$$;


ALTER FUNCTION "public"."extract_review_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_review_filtered_count"("p_status" "text" DEFAULT NULL::"text", "p_search_query" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."extract_review_filtered_count"("p_status" "text", "p_search_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_review_list"("p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0, "p_status" "text" DEFAULT 'all'::"text") RETURNS TABLE("thread_id" "uuid", "subject_id" "text", "input_json" "text", "output_json" "text", "status" "text", "latency_ms" numeric, "created_at" timestamp with time zone, "reviewer_ids" "uuid"[], "comment_count" bigint, "reviewers" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rt.id AS thread_id,
    rt.source_id AS subject_id,
    jsonb_build_object(
      'images', to_jsonb(le.images),
      'barcode', le.barcode,
      'userPreferenceText', lab.request_body->>'userPreferenceText'
    )::text AS input_json,
    jsonb_build_object(
      'name', le.name,
      'brand', le.brand,
      'barcode', le.barcode,
      'ingredients', le.ingredients,
      'images', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'hash', li_img.image_file_hash,
            'ocr_text', li_img.image_ocrtext_ios,
            'barcode', li_img.barcode_ios
          )
        )
        FROM public.log_images li_img
        WHERE li_img.activity_id = le.activity_id), 
        to_jsonb(le.images)
      ),
      'matchStatus', CASE 
        WHEN lab.response_body IS NOT NULL THEN 'unmatched'
        ELSE 'matched'
      END,
      'violations', COALESCE(lab.response_body::jsonb, '[]'::jsonb),
      'userPreferenceText', lab.request_body->>'userPreferenceText',
      'extraction_latency', COALESCE(EXTRACT(EPOCH FROM (le.end_time - le.start_time)) * 1000, 0)
    )::text AS output_json,
    COALESCE(rt.status, 'unreviewed') AS status,
    COALESCE(EXTRACT(EPOCH FROM (le.end_time - le.start_time)) * 1000, 0)::numeric AS latency_ms,
    le.created_at,
    COALESCE(
      (SELECT array_agg(ra.reviewer_id)
       FROM public.review_assignments ra
       WHERE ra.thread_id = rt.id), 
      ARRAY[]::uuid[]
    ) AS reviewer_ids,
    COALESCE(
      (SELECT COUNT(*)
       FROM public.review_comments rc
       WHERE rc.thread_id = rt.id), 
      0
    )::bigint AS comment_count,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', ra.reviewer_id,
          'email', 'reviewer@example.com',
          'assigned_at', ra.assigned_at
        )
      )
      FROM public.review_assignments ra
      WHERE ra.thread_id = rt.id), 
      '[]'::jsonb
    ) AS reviewers
  FROM public.review_threads rt
  INNER JOIN public.log_extract le ON le.activity_id::text = rt.source_id
  LEFT JOIN public.log_analyzebarcode lab ON lab.request_body->>'barcode' = le.barcode
  WHERE rt.source_table = 'log_extract'
  AND (p_status = 'all' OR rt.status = p_status OR (p_status = 'unreviewed' AND rt.status IS NULL))
  ORDER BY le.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."extract_review_list"("p_limit" integer, "p_offset" integer, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_review_list_enhanced"("p_limit" integer DEFAULT 50, "p_status" "text" DEFAULT NULL::"text", "p_offset" integer DEFAULT 0) RETURNS TABLE("thread_id" "text", "subject_id" "text", "product_name" "text", "barcode" "text", "category" "text", "output_json" "text", "input_json" "text", "status" "text", "latency_ms" numeric, "created_at" timestamp with time zone, "reviewer_ids" "uuid"[], "reviewers" "jsonb", "comment_count" bigint, "expected_output" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."extract_review_list_enhanced"("p_limit" integer, "p_status" "text", "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_available_reviewers"() RETURNS TABLE("reviewer_id" "uuid", "reviewer_name" "text", "assigned_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NOT is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only admins can view reviewers';
    END IF;
    
    RETURN QUERY
    SELECT 
        ur.user_id as reviewer_id,
        au.email as reviewer_name,
        COUNT(ra.id) as assigned_count
    FROM public.user_roles ur
    JOIN auth.users au ON au.id = ur.user_id
    LEFT JOIN public.review_assignments ra ON ra.reviewer_id = ur.user_id
    WHERE ur.role IN ('reviewer', 'admin')
    GROUP BY ur.user_id, au.email
    ORDER BY assigned_count ASC, au.email;
END;
$$;


ALTER FUNCTION "public"."get_available_reviewers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_check_history"("search_query" "text" DEFAULT NULL::"text") RETURNS TABLE("created_at" timestamp with time zone, "client_activity_id" "uuid", "barcode" "text", "name" "text", "brand" "text", "ingredients" "json", "images" "json", "ingredient_recommendations" "json", "rating" integer, "favorited" boolean)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        sub.created_at,
        sub.client_activity_id,
        sub.barcode,
        sub.name,
        sub.brand,
        sub.ingredients,
        sub.images,
        sub.ingredient_recommendations,
        sub.rating,
        sub.favorited
    FROM (
        SELECT DISTINCT ON (barcode, name, brand)
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
            la.created_at > '2024-03-15'::date
            AND
            (
                li.client_activity_id IS NOT NULL
                OR
                le.client_activity_id IS NOT NULL
            )
            AND
            (
                search_query IS NULL
                OR
                to_tsvector('english', COALESCE(li.name, le.name) || ' ' || COALESCE(li.brand, le.brand) || ' ' || COALESCE(li.ingredients::text, le.ingredients::text)) @@ plainto_tsquery('english', search_query)
                OR
                COALESCE(li.name, le.name) ILIKE '%' || search_query || '%'
                OR
                COALESCE(li.brand, le.brand) ILIKE '%' || search_query || '%'
                OR
                COALESCE(li.ingredients::text, le.ingredients::text) ILIKE '%' || search_query || '%'
            )
        ORDER BY
            barcode, name, brand, la.created_at DESC
    ) AS sub
    ORDER BY
        sub.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_check_history"("search_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_permissions"("user_uuid" "uuid") RETURNS "json"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
    permissions JSON;
BEGIN
    user_role := get_user_role(user_uuid);
    
    CASE user_role
        WHEN 'admin' THEN
            permissions := json_build_object(
                'dashboard', true,
                'products', true,
                'review', true,
                'analytics', true,
                'user_management', true
            );
        WHEN 'reviewer' THEN
            permissions := json_build_object(
                'dashboard', true,
                'products', true,
                'review', true,
                'analytics', false,
                'user_management', false
            );
        ELSE
            permissions := json_build_object(
                'dashboard', false,
                'products', false,
                'review', false,
                'analytics', false,
                'user_management', false
            );
    END CASE;
    
    RETURN permissions;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_permissions"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_totals"() RETURNS TABLE("total_scans" bigint, "total_extractions" bigint, "total_feedback" bigint, "total_list_items" bigint, "total_history_items" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM log_analyzebarcode) as total_scans,
    (SELECT COUNT(*) FROM log_extract) as total_extractions,
    (SELECT COUNT(*) FROM log_feedback) as total_feedback,
    (SELECT COUNT(*) FROM user_list_items) as total_list_items,
    (SELECT COUNT(*) FROM log_images) as total_history_items;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_distinct_user_count"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN (SELECT COUNT(DISTINCT id) FROM auth.users);
END;
$$;


ALTER FUNCTION "public"."get_distinct_user_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_list_items"("input_list_id" "uuid", "search_query" "text" DEFAULT NULL::"text") RETURNS TABLE("created_at" timestamp with time zone, "list_id" "uuid", "list_item_id" "uuid", "barcode" "text", "name" "text", "brand" "text", "ingredients" "json", "images" "json")
    LANGUAGE "plpgsql"
    AS $$
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
        AND
        (
            search_query IS NULL
            OR
            to_tsvector('english', COALESCE(li.name, le.name) || ' ' || COALESCE(li.brand, le.brand) || ' ' || COALESCE(li.ingredients::text, le.ingredients::text)) @@ plainto_tsquery('english', search_query)
            OR
            COALESCE(li.name, le.name) ILIKE '%' || search_query || '%'
            OR
            COALESCE(li.brand, le.brand) ILIKE '%' || search_query || '%'
            OR
            COALESCE(li.ingredients::text, le.ingredients::text) ILIKE '%' || search_query || '%'
        )
    ORDER BY
        uli.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_list_items"("input_list_id" "uuid", "search_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_performance_metrics"("days_back" integer DEFAULT 30) RETURNS TABLE("avg_latency" numeric, "success_rate" numeric, "total_requests" bigint, "error_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH performance_data AS (
    SELECT 
      ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000) as latency_ms,
      response_status
    FROM log_analyzebarcode 
    WHERE created_at > CURRENT_DATE - (days_back || ' days')::interval
      AND start_time IS NOT NULL 
      AND end_time IS NOT NULL
  )
  SELECT 
    ROUND(AVG(latency_ms), 2) as avg_latency,
    ROUND((COUNT(*) FILTER (WHERE response_status = 200)::numeric / COUNT(*)) * 100, 2) as success_rate,
    COUNT(*) as total_requests,
    COUNT(*) FILTER (WHERE response_status != 200) as error_count
  FROM performance_data;
END;
$$;


ALTER FUNCTION "public"."get_performance_metrics"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_popular_products"("limit_count" integer DEFAULT 10) RETURNS TABLE("product_name" "text", "scan_count" bigint, "category" "text", "avg_latency" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(response_body->>'name', request_body->>'text', 'Unknown Product') as product_name,
    COUNT(*) as scan_count,
    COALESCE(response_body->>'category', 'Unknown') as category,
    ROUND(AVG(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000), 2) as avg_latency
  FROM log_analyzebarcode
  WHERE start_time IS NOT NULL AND end_time IS NOT NULL
  GROUP BY response_body->>'name', request_body->>'text', response_body->>'category'
  ORDER BY scan_count DESC
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."get_popular_products"("limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_brands"() RETURNS TABLE("brand" "text", "product_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        li.brand,
        COUNT(*) as product_count
    FROM log_inventory li
    WHERE li.brand IS NOT NULL
    GROUP BY li.brand
    ORDER BY product_count DESC, li.brand;
END;
$$;


ALTER FUNCTION "public"."get_product_brands"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_data_sources"() RETURNS TABLE("data_source" "text", "product_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        li.data_source,
        COUNT(*) as product_count
    FROM log_inventory li
    GROUP BY li.data_source
    ORDER BY product_count DESC, li.data_source;
END;
$$;


ALTER FUNCTION "public"."get_product_data_sources"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_products_list"("p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0, "p_search" "text" DEFAULT NULL::"text", "p_brand" "text" DEFAULT NULL::"text", "p_data_source" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "name" "text", "brand" "text", "barcode" "text", "data_source" "text", "ingredients" "json", "images" "json", "created_at" timestamp with time zone, "user_id" "uuid", "total_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    total_products bigint;
BEGIN
    -- Get total count for pagination
    SELECT COUNT(*) INTO total_products
    FROM log_inventory li
    WHERE (p_search IS NULL OR 
           li.name ILIKE '%' || p_search || '%' OR 
           li.brand ILIKE '%' || p_search || '%' OR
           li.barcode ILIKE '%' || p_search || '%')
    AND (p_brand IS NULL OR li.brand ILIKE '%' || p_brand || '%')
    AND (p_data_source IS NULL OR li.data_source = p_data_source);

    -- Return paginated results
    RETURN QUERY
    SELECT 
        li.user_id as id,
        li.name,
        li.brand,
        li.barcode,
        li.data_source,
        li.ingredients,
        li.images,
        li.created_at,
        li.user_id,
        total_products
    FROM log_inventory li
    WHERE (p_search IS NULL OR 
           li.name ILIKE '%' || p_search || '%' OR 
           li.brand ILIKE '%' || p_search || '%' OR
           li.barcode ILIKE '%' || p_search || '%')
    AND (p_brand IS NULL OR li.brand ILIKE '%' || p_brand || '%')
    AND (p_data_source IS NULL OR li.data_source = p_data_source)
    ORDER BY li.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."get_products_list"("p_limit" integer, "p_offset" integer, "p_search" "text", "p_brand" "text", "p_data_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_products_stats"() RETURNS TABLE("total_products" bigint, "unique_brands" bigint, "unique_data_sources" bigint, "products_with_images" bigint, "products_with_ingredients" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_products,
        COUNT(DISTINCT brand) FILTER (WHERE brand IS NOT NULL) as unique_brands,
        COUNT(DISTINCT data_source) as unique_data_sources,
        COUNT(*) FILTER (WHERE images IS NOT NULL AND jsonb_array_length(images::jsonb) > 0) as products_with_images,
        COUNT(*) FILTER (WHERE ingredients IS NOT NULL AND jsonb_array_length(ingredients::jsonb) > 0) as products_with_ingredients
    FROM log_inventory;
END;
$$;


ALTER FUNCTION "public"."get_products_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_review_data"("p_thread_type" "text", "p_status" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 100) RETURNS TABLE("thread_id" "uuid", "source_id" "uuid", "input_json" "text", "output_json" "text", "status" "text", "latency_ms" integer, "created_at" timestamp with time zone, "reviewer_name" "text", "reviewer_id" "uuid", "comment_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF p_thread_type = 'preference_validation' THEN
        RETURN QUERY
        SELECT 
            rt.id as thread_id,
            lpv.id as source_id,
            lpv.input_text as input_json,
            lpv.output_interpretation::text as output_json,
            COALESCE(rt.status, 'unreviewed') as status,
            lpv.latency_ms,
            lpv.created_at,
            au.email as reviewer_name,
            ra.reviewer_id,
            COALESCE(comment_counts.cnt, 0) as comment_count
        FROM public.log_preference_validation lpv
        LEFT JOIN public.review_threads rt ON rt.source_id = lpv.id AND rt.source_table = 'log_preference_validation'
        LEFT JOIN public.review_assignments ra ON ra.thread_id = rt.id
        LEFT JOIN auth.users au ON au.id = ra.reviewer_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*) as cnt 
            FROM public.review_comments rc 
            WHERE rc.thread_id = rt.id
        ) comment_counts ON true
        WHERE (p_status IS NULL OR rt.status = p_status OR (p_status = 'unreviewed' AND rt.status IS NULL))
        ORDER BY lpv.created_at DESC
        LIMIT p_limit;
        
    ELSIF p_thread_type = 'analyze_llm' THEN
        RETURN QUERY
        SELECT 
            rt.id as thread_id,
            la.activity_id as source_id,
            COALESCE(la.request_body->>'text', li.barcode, 'N/A') as input_json,
            COALESCE(la.response_body::text, COALESCE(li.name, '') || ' - ' || COALESCE(li.brand, '')) as output_json,
            COALESCE(rt.status, 'unreviewed') as status,
            ROUND(EXTRACT(EPOCH FROM (la.end_time - la.start_time)) * 1000)::integer as latency_ms,
            la.created_at,
            au.email as reviewer_name,
            ra.reviewer_id,
            COALESCE(comment_counts.cnt, 0) as comment_count
        FROM public.log_analyzebarcode la
        LEFT JOIN public.log_inventory li ON li.client_activity_id = la.client_activity_id
        LEFT JOIN public.review_threads rt ON rt.source_id = la.activity_id AND rt.source_table = 'log_analyzebarcode'
        LEFT JOIN public.review_assignments ra ON ra.thread_id = rt.id
        LEFT JOIN auth.users au ON au.id = ra.reviewer_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*) as cnt 
            FROM public.review_comments rc 
            WHERE rc.thread_id = rt.id
        ) comment_counts ON true
        WHERE (p_status IS NULL OR rt.status = p_status OR (p_status = 'unreviewed' AND rt.status IS NULL))
        ORDER BY la.created_at DESC
        LIMIT p_limit;
        
    ELSIF p_thread_type = 'extract_llm' THEN
        RETURN QUERY
        SELECT 
            rt.id as thread_id,
            le.activity_id as source_id,
            COALESCE(le.name, 'Photo extraction') as input_json,
            jsonb_build_object(
                'ingredients', le.ingredients,
                'brand', le.brand,
                'name', le.name
            )::text as output_json,
            COALESCE(rt.status, 'unreviewed') as status,
            ROUND(EXTRACT(EPOCH FROM (le.end_time - le.start_time)) * 1000)::integer as latency_ms,
            le.created_at,
            au.email as reviewer_name,
            ra.reviewer_id,
            COALESCE(comment_counts.cnt, 0) as comment_count
        FROM public.log_extract le
        LEFT JOIN public.review_threads rt ON rt.source_id = le.activity_id AND rt.source_table = 'log_extract'
        LEFT JOIN public.review_assignments ra ON ra.thread_id = rt.id
        LEFT JOIN auth.users au ON au.id = ra.reviewer_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*) as cnt 
            FROM public.review_comments rc 
            WHERE rc.thread_id = rt.id
        ) comment_counts ON true
        WHERE (p_status IS NULL OR rt.status = p_status OR (p_status = 'unreviewed' AND rt.status IS NULL))
        ORDER BY le.created_at DESC
        LIMIT p_limit;
    END IF;
END;
$$;


ALTER FUNCTION "public"."get_review_data"("p_thread_type" "text", "p_status" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reviewers_list"() RETURNS TABLE("id" "uuid", "email" character varying, "created_at" timestamp with time zone, "role" character varying, "assigned_by" "uuid", "assigned_at" timestamp with time zone, "is_active" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email::character varying,
    u.created_at,
    ur.role::character varying,
    ur.assigned_by,
    ur.assigned_at,
    COALESCE(ur.is_active, true) as is_active
  FROM auth.users u
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE ur.is_active IS NULL OR ur.is_active = true
  ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_reviewers_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_scan_activity_data"("days_back" integer DEFAULT 30) RETURNS TABLE("date" "date", "scans" bigint, "extractions" bigint, "success_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH daily_data AS (
    SELECT 
      DATE(created_at) as activity_date,
      COUNT(*) FILTER (WHERE table_name = 'log_analyzebarcode') as scan_count,
      COUNT(*) FILTER (WHERE table_name = 'log_extract') as extract_count,
      COUNT(*) FILTER (WHERE table_name = 'log_analyzebarcode' AND response_status = 200) as success_count,
      COUNT(*) FILTER (WHERE table_name = 'log_analyzebarcode') as total_count
    FROM (
      SELECT created_at, 'log_analyzebarcode' as table_name, response_status FROM log_analyzebarcode
      UNION ALL
      SELECT created_at, 'log_extract' as table_name, 200 as response_status FROM log_extract
    ) combined
    WHERE created_at > CURRENT_DATE - (days_back || ' days')::interval
    GROUP BY DATE(created_at)
  )
  SELECT 
    activity_date,
    scan_count,
    extract_count,
    CASE 
      WHEN total_count > 0 THEN ROUND((success_count::numeric / total_count) * 100, 2)
      ELSE 0 
    END as success_rate
  FROM daily_data
  ORDER BY activity_date;
END;
$$;


ALTER FUNCTION "public"."get_scan_activity_data"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_emails"("user_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY(user_ids);
END;
$$;


ALTER FUNCTION "public"."get_user_emails"("user_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_engagement_data"("days_back" integer DEFAULT 30) RETURNS TABLE("date" "date", "daily_users" bigint, "weekly_users" bigint, "monthly_users" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH user_activity AS (
    SELECT 
      DATE(created_at) as activity_date,
      user_id
    FROM (
      SELECT created_at, user_id FROM log_analyzebarcode
      UNION ALL
      SELECT created_at, user_id FROM log_extract
      UNION ALL
      SELECT created_at, user_id FROM log_feedback
    ) combined
    WHERE created_at > CURRENT_DATE - (days_back || ' days')::interval
  )
  SELECT 
    activity_date,
    COUNT(DISTINCT user_id) as daily_users,
    COUNT(DISTINCT user_id) FILTER (WHERE activity_date >= CURRENT_DATE - INTERVAL '7 days') as weekly_users,
    COUNT(DISTINCT user_id) FILTER (WHERE activity_date >= CURRENT_DATE - INTERVAL '30 days') as monthly_users
  FROM user_activity
  GROUP BY activity_date
  ORDER BY activity_date;
END;
$$;


ALTER FUNCTION "public"."get_user_engagement_data"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"("user_uuid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM user_roles
    WHERE user_id = user_uuid;
    
    RETURN COALESCE(user_role, 'none');
END;
$$;


ALTER FUNCTION "public"."get_user_role"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_users_with_roles"() RETURNS TABLE("id" "uuid", "email" "text", "created_at" timestamp with time zone, "role" "text", "assigned_by" "uuid", "assigned_at" timestamp with time zone, "is_active" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND ur.role = 'admin' 
    AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    u.id,
    u.email::text,  -- Cast email to text to match return type
    u.created_at,
    ur.role::text,  -- Ensure role is cast to text
    ur.assigned_by,
    ur.assigned_at,
    ur.is_active
  FROM auth.users u
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE ur.is_active = true OR ur.is_active IS NULL
  ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_users_with_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("user_uuid" "uuid", "required_role" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN get_user_role(user_uuid) = required_role;
END;
$$;


ALTER FUNCTION "public"."has_role"("user_uuid" "uuid", "required_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("user_uuid" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = is_admin.user_uuid 
    AND user_roles.role = 'admin' 
    AND user_roles.is_active = true
    AND (user_roles.expires_at IS NULL OR user_roles.expires_at > NOW())
  );
END;
$$;


ALTER FUNCTION "public"."is_admin"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_reviewer"("user_uuid" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = is_reviewer.user_uuid 
    AND user_roles.role IN ('admin', 'reviewer') 
    AND user_roles.is_active = true
    AND (user_roles.expires_at IS NULL OR user_roles.expires_at > NOW())
  );
END;
$$;


ALTER FUNCTION "public"."is_reviewer"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalized_barcode"("input_barcode" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    AS $$
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
$$;


ALTER FUNCTION "public"."normalized_barcode"("input_barcode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preferences_review_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.dietary_preferences dp
    WHERE dp.deleted_at IS NULL
  );
END;
$$;


ALTER FUNCTION "public"."preferences_review_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preferences_review_filtered_count"("p_status" "text" DEFAULT NULL::"text", "p_search_query" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."preferences_review_filtered_count"("p_status" "text", "p_search_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preferences_review_list"("p_limit" integer DEFAULT 50, "p_status" "text" DEFAULT NULL::"text", "p_offset" integer DEFAULT 0) RETURNS TABLE("thread_id" "text", "subject_id" "text", "input_json" "text", "output_json" "text", "status" "text", "latency_ms" numeric, "created_at" timestamp with time zone, "reviewer_ids" "uuid"[], "comment_count" bigint, "expected_output" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."preferences_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_assign"("p_thread_id" "uuid", "p_reviewer_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Only admins can assign
    IF NOT is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only admins can assign reviewers';
    END IF;
    
    -- Insert assignment
    INSERT INTO public.review_assignments (thread_id, reviewer_id, assigned_by)
    VALUES (p_thread_id, p_reviewer_id, auth.uid())
    ON CONFLICT (thread_id, reviewer_id) DO NOTHING;
    
    -- Add comment about assignment
    PERFORM review_comment_add(
        p_thread_id,
        'Assigned to reviewer',
        'assignment',
        jsonb_build_object('reviewer_id', p_reviewer_id)
    );
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."review_assign"("p_thread_id" "uuid", "p_reviewer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_comment_add"("p_thread_id" "uuid", "p_comment" "text", "p_action" "text" DEFAULT 'comment'::"text", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_comment_id UUID;
BEGIN
    INSERT INTO public.review_comments (thread_id, user_id, comment, action, metadata)
    VALUES (p_thread_id, auth.uid(), p_comment, p_action, p_metadata)
    RETURNING id INTO v_comment_id;
    
    -- Update thread updated_at
    UPDATE public.review_threads
    SET updated_at = now()
    WHERE id = p_thread_id;
    
    RETURN v_comment_id;
END;
$$;


ALTER FUNCTION "public"."review_comment_add"("p_thread_id" "uuid", "p_comment" "text", "p_action" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_thread_id UUID;
BEGIN
    -- Check if thread exists
    SELECT id INTO v_thread_id
    FROM public.review_threads
    WHERE source_table = p_source_table
    AND source_id = p_source_id;
    
    -- Create if doesn't exist
    IF v_thread_id IS NULL THEN
        INSERT INTO public.review_threads (source_table, source_id, thread_type, created_by)
        VALUES (p_source_table, p_source_id, p_thread_type, auth.uid())
        RETURNING id INTO v_thread_id;
    END IF;
    
    RETURN v_thread_id;
END;
$$;


ALTER FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_thread_id uuid;
BEGIN
  -- Try to find existing thread
  SELECT id INTO v_thread_id
  FROM public.review_threads
  WHERE source_table = p_source_table
    AND source_id = p_source_id
  LIMIT 1;
  
  -- If no thread exists, create one
  IF v_thread_id IS NULL THEN
    INSERT INTO public.review_threads (
      source_table,
      source_id,
      thread_type,
      status,
      created_by
    )
    VALUES (
      p_source_table,
      p_source_id,
      p_thread_type,
      'unreviewed',
      p_user_id
    )
    RETURNING id INTO v_thread_id;
  END IF;
  
  RETURN v_thread_id;
END;
$$;


ALTER FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_inventory_cache_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_inventory_cache_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_barcode_review_list"() RETURNS TABLE("thread_id" "uuid", "subject_id" "uuid", "output_interpretation" "text", "status" "text", "latency_ms" integer, "created_at" timestamp with time zone, "reviewer_ids" "uuid"[], "comment_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(li.client_activity_id, le.client_activity_id, gen_random_uuid()) as thread_id,
        li.user_id as subject_id,
        json_build_object(
            'product_name', COALESCE(li.name, le.name, 'Unknown Product'),
            'barcode', COALESCE(li.barcode, le.barcode, 'N/A'),
            'category', COALESCE(li.data_source, 'Unknown'),
            'brand', COALESCE(li.brand, le.brand, ''),
            'ingredients', COALESCE(li.ingredients, le.ingredients)
        )::text as output_interpretation,
        CASE
            WHEN li.name IS NOT NULL OR le.name IS NOT NULL THEN 'resolved'
            ELSE 'open'
        END as status,
        COALESCE(
            ROUND(EXTRACT(EPOCH FROM (li.end_time - li.start_time)) * 1000)::integer,
            300
        ) as latency_ms,
        COALESCE(li.created_at, le.created_at) as created_at,
        ARRAY[]::uuid[] as reviewer_ids,
        (SELECT COUNT(*) FROM log_feedback lf WHERE lf.client_activity_id = COALESCE(li.client_activity_id, le.client_activity_id))::bigint as comment_count
    FROM log_inventory li
    FULL OUTER JOIN log_extract le ON li.client_activity_id = le.client_activity_id
    WHERE COALESCE(li.created_at, le.created_at) > NOW() - INTERVAL '30 days'
      AND (li.client_activity_id IS NOT NULL OR le.client_activity_id IS NOT NULL)
    ORDER BY COALESCE(li.created_at, le.created_at) DESC
    LIMIT 100;
END;
$$;


ALTER FUNCTION "public"."test_barcode_review_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_preferences_review_list"() RETURNS TABLE("thread_id" "uuid", "subject_id" "uuid", "input_json" "text", "output_json" "text", "status" "text", "latency_ms" integer, "created_at" timestamp with time zone, "reviewer_ids" "uuid"[], "comment_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(dp.id::uuid, gen_random_uuid()) as thread_id,
        dp.user_id as subject_id,
        COALESCE(dp.text, dp.annotated_text, '') as input_json,
        COALESCE(dp.annotated_text, dp.text, '') as output_json,
        CASE
            WHEN dp.annotated_text IS NOT NULL THEN 'resolved'
            ELSE 'open'
        END as status,
        0 as latency_ms,
        dp.created_at,
        ARRAY[]::uuid[] as reviewer_ids,
        0::bigint as comment_count
    FROM dietary_preferences dp
    WHERE dp.created_at > NOW() - INTERVAL '30 days'
      AND dp.deleted_at IS NULL
    ORDER BY dp.created_at DESC
    LIMIT 100;
END;
$$;


ALTER FUNCTION "public"."test_preferences_review_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."dashboard_access_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "resource" "text" NOT NULL,
    "success" boolean NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "ip_address" "inet",
    "user_agent" "text"
);


ALTER TABLE "public"."dashboard_access_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dietary_preferences" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "id" integer NOT NULL,
    "text" "text",
    "annotated_text" "text"
);


ALTER TABLE "public"."dietary_preferences" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."dietary_preferences_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."dietary_preferences_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."dietary_preferences_id_seq" OWNED BY "public"."dietary_preferences"."id";



CREATE TABLE IF NOT EXISTS "public"."inventory_cache" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_refreshed_at" timestamp with time zone,
    "barcode" "text" NOT NULL,
    "data_source" "text" DEFAULT 'openfoodfacts/v3'::"text" NOT NULL,
    "name" "text",
    "brand" "text",
    "ingredients" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "images" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "off_last_modified_t" bigint,
    "etag" "text"
);


ALTER TABLE "public"."inventory_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_analyzebarcode" (
    "activity_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_activity_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "request_body" "json" NOT NULL,
    "response_status" integer NOT NULL,
    "response_body" "json" NOT NULL
);


ALTER TABLE "public"."log_analyzebarcode" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_extract" (
    "user_id" "uuid" NOT NULL,
    "client_activity_id" "uuid",
    "activity_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "barcode" "text",
    "name" "text",
    "brand" "text",
    "ingredients" "json",
    "response_status" integer NOT NULL,
    "images" "text"[]
);


ALTER TABLE "public"."log_extract" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_feedback" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_activity_id" "uuid" NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "reasons" "text"[],
    "note" "text",
    "images" "text"[]
);


ALTER TABLE "public"."log_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_images" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_activity_id" "uuid" NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "image_file_hash" "text" NOT NULL,
    "image_ocrtext_ios" "text" NOT NULL,
    "barcode_ios" "text"
);


ALTER TABLE "public"."log_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_inventory" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "barcode" "text" NOT NULL,
    "data_source" "text" NOT NULL,
    "name" "text",
    "brand" "text",
    "ingredients" "json",
    "images" "json",
    "client_activity_id" "uuid",
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone
);


ALTER TABLE "public"."log_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_llmcall" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "parentconversation_ids" "uuid"[],
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "agent_name" "text" NOT NULL,
    "model_provider" "text" NOT NULL,
    "model_name" "text" NOT NULL,
    "temperature" numeric NOT NULL,
    "function_call" "text" NOT NULL,
    "functions" "json" NOT NULL,
    "messages" "json" NOT NULL,
    "response" "json",
    "client_activity_id" "uuid"
);


ALTER TABLE "public"."log_llmcall" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."log_preference_validation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "input_text" "text" NOT NULL,
    "output_interpretation" "jsonb" NOT NULL,
    "latency_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_activity_id" "uuid"
);


ALTER TABLE "public"."log_preference_validation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recorded_sessions" (
    "id" bigint NOT NULL,
    "recording_session_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_method" "text" NOT NULL,
    "request_path" "text" NOT NULL,
    "request_headers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "request_body" "jsonb",
    "response_status" integer NOT NULL,
    "response_headers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "response_body" "jsonb"
);


ALTER TABLE "public"."recorded_sessions" OWNER TO "postgres";


ALTER TABLE "public"."recorded_sessions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."recorded_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."review_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."review_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "comment" "text" NOT NULL,
    "action" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_comments_action_check" CHECK (("action" = ANY (ARRAY['comment'::"text", 'status_change'::"text", 'expected_output'::"text"])))
);


ALTER TABLE "public"."review_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_expected_outputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "expected_output" "jsonb" NOT NULL,
    "status_at_save" "text" DEFAULT 'need_review'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."review_expected_outputs" OWNER TO "postgres";


COMMENT ON TABLE "public"."review_expected_outputs" IS 'History of reviewer-provided expected outputs linked to review threads.';



CREATE TABLE IF NOT EXISTS "public"."review_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_table" "text" NOT NULL,
    "source_id" "text" NOT NULL,
    "thread_type" "text" NOT NULL,
    "status" "text" DEFAULT 'unreviewed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "expected_output" "jsonb",
    CONSTRAINT "review_threads_status_check" CHECK (("status" = ANY (ARRAY['unreviewed'::"text", 'promoted'::"text", 'reviewed'::"text", 'need_review'::"text"]))),
    CONSTRAINT "review_threads_thread_type_check" CHECK (("thread_type" = ANY (ARRAY['preference_validation'::"text", 'analyze_llm'::"text", 'extract_llm'::"text", 'manual_review'::"text", 'preference_review'::"text", 'barcode_review'::"text", 'extract_review'::"text"])))
);


ALTER TABLE "public"."review_threads" OWNER TO "postgres";


COMMENT ON COLUMN "public"."review_threads"."expected_output" IS 'Reviewer-provided expected output overrides for promoted status (ingredients/product info/etc).';



CREATE TABLE IF NOT EXISTS "public"."role_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "old_role" "text",
    "new_role" "text",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"(),
    "ip_address" "inet",
    "user_agent" "text"
);


ALTER TABLE "public"."role_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_list_items" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "list_id" "uuid" NOT NULL,
    "list_item_id" "uuid" NOT NULL
);


ALTER TABLE "public"."user_list_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "role" "text" NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'reviewer'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."dietary_preferences" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dietary_preferences_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."dashboard_access_logs"
    ADD CONSTRAINT "dashboard_access_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dietary_preferences"
    ADD CONSTRAINT "dietary_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_cache"
    ADD CONSTRAINT "inventory_cache_pkey" PRIMARY KEY ("barcode");



ALTER TABLE ONLY "public"."log_llmcall"
    ADD CONSTRAINT "log_agents_key" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."log_extract"
    ADD CONSTRAINT "log_extract_key" PRIMARY KEY ("activity_id");



ALTER TABLE ONLY "public"."log_feedback"
    ADD CONSTRAINT "log_feedback_key" PRIMARY KEY ("client_activity_id");



ALTER TABLE ONLY "public"."log_images"
    ADD CONSTRAINT "log_images_key" PRIMARY KEY ("image_file_hash");



ALTER TABLE ONLY "public"."log_analyzebarcode"
    ADD CONSTRAINT "log_infer_key" PRIMARY KEY ("activity_id");



ALTER TABLE ONLY "public"."log_preference_validation"
    ADD CONSTRAINT "log_preference_validation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recorded_sessions"
    ADD CONSTRAINT "recorded_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_thread_id_reviewer_id_key" UNIQUE ("thread_id", "reviewer_id");



ALTER TABLE ONLY "public"."review_comments"
    ADD CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_expected_outputs"
    ADD CONSTRAINT "review_expected_outputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_threads"
    ADD CONSTRAINT "review_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_threads"
    ADD CONSTRAINT "review_threads_source_table_source_id_key" UNIQUE ("source_table", "source_id");



ALTER TABLE ONLY "public"."role_audit_log"
    ADD CONSTRAINT "role_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_list_items"
    ADD CONSTRAINT "user_list_items_pkey" PRIMARY KEY ("list_item_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_waitlist_created_at" ON "public"."waitlist" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_waitlist_email" ON "public"."waitlist" USING "btree" ("email");



CREATE INDEX "inventory_cache_barcode_norm_idx" ON "public"."inventory_cache" USING "btree" ("public"."normalized_barcode"("barcode"));



CREATE INDEX "recorded_sessions_session_idx" ON "public"."recorded_sessions" USING "btree" ("recording_session_id");



CREATE INDEX "review_expected_outputs_thread_id_idx" ON "public"."review_expected_outputs" USING "btree" ("thread_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "trg_inventory_cache_updated_at" BEFORE UPDATE ON "public"."inventory_cache" FOR EACH ROW EXECUTE FUNCTION "public"."set_inventory_cache_updated_at"();



CREATE OR REPLACE TRIGGER "trg_review_expected_outputs_set_updated_at" BEFORE UPDATE ON "public"."review_expected_outputs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "update_review_threads_updated_at" BEFORE UPDATE ON "public"."review_threads" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."dashboard_access_logs"
    ADD CONSTRAINT "dashboard_access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."log_preference_validation"
    ADD CONSTRAINT "log_preference_validation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_assignments"
    ADD CONSTRAINT "review_assignments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_comments"
    ADD CONSTRAINT "review_comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_comments"
    ADD CONSTRAINT "review_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_expected_outputs"
    ADD CONSTRAINT "review_expected_outputs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_threads"
    ADD CONSTRAINT "review_threads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."role_audit_log"
    ADD CONSTRAINT "role_audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."role_audit_log"
    ADD CONSTRAINT "role_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete waitlist entries" ON "public"."waitlist" FOR DELETE USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can do everything with threads" ON "public"."review_threads" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can manage all assignments" ON "public"."review_assignments" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can manage all comments" ON "public"."review_comments" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update waitlist entries" ON "public"."waitlist" FOR UPDATE USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all access logs" ON "public"."dashboard_access_logs" FOR SELECT USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all audit logs" ON "public"."role_audit_log" FOR SELECT USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all roles" ON "public"."user_roles" FOR SELECT USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all waitlist entries" ON "public"."waitlist" FOR SELECT USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Anyone can join waitlist" ON "public"."waitlist" FOR INSERT WITH CHECK (true);



CREATE POLICY "Insert for authenticated users" ON "public"."log_extract" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Insert for authenticated users" ON "public"."log_images" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Insert for authenticated users" ON "public"."log_inventory" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Only admins can modify roles" ON "public"."user_roles" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Reviewers can add comments to any thread" ON "public"."review_comments" FOR INSERT WITH CHECK ("public"."is_reviewer"("auth"."uid"()));



CREATE POLICY "Reviewers can create assignments for themselves" ON "public"."review_assignments" FOR INSERT WITH CHECK (("public"."is_reviewer"("auth"."uid"()) AND ("reviewer_id" = "auth"."uid"())));



CREATE POLICY "Reviewers can update any thread" ON "public"."review_threads" FOR UPDATE USING (("public"."is_reviewer"("auth"."uid"()) OR "public"."is_admin"("auth"."uid"()))) WITH CHECK (("public"."is_reviewer"("auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Reviewers can view all preference validations" ON "public"."log_preference_validation" FOR SELECT USING ("public"."is_reviewer"("auth"."uid"()));



CREATE POLICY "Reviewers can view any thread" ON "public"."review_threads" FOR SELECT USING (("public"."is_reviewer"("auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Reviewers can view comments on any thread" ON "public"."review_comments" FOR SELECT USING (("public"."is_reviewer"("auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Reviewers can view their assignments" ON "public"."review_assignments" FOR SELECT USING (("public"."is_reviewer"("auth"."uid"()) AND ("reviewer_id" = "auth"."uid"())));



CREATE POLICY "Select for all authenticated users" ON "public"."inventory_cache" FOR SELECT USING (true);



CREATE POLICY "Select for all authenticated users" ON "public"."log_extract" FOR SELECT USING (true);



CREATE POLICY "Select for all authenticated users" ON "public"."log_images" FOR SELECT USING (true);



CREATE POLICY "Select for all authenticated users" ON "public"."log_inventory" FOR SELECT USING (true);



CREATE POLICY "Service role access" ON "public"."recorded_sessions" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can insert their own preference logs" ON "public"."log_preference_validation" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own validations" ON "public"."log_preference_validation" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own access logs" ON "public"."dashboard_access_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own audit log" ON "public"."role_audit_log" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own preference logs" ON "public"."log_preference_validation" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_reviewer"("auth"."uid"())));



CREATE POLICY "Users can view their own role" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Write for service role only" ON "public"."inventory_cache" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."dashboard_access_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dietary_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_analyzebarcode" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_extract" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_llmcall" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."log_preference_validation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recorded_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_threads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviewers_can_select_all_log_analyzebarcode" ON "public"."log_analyzebarcode" FOR SELECT USING ("public"."is_reviewer"("auth"."uid"()));



CREATE POLICY "reviewers_can_select_all_log_feedback" ON "public"."log_feedback" FOR SELECT USING ("public"."is_reviewer"("auth"."uid"()));



ALTER TABLE "public"."role_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_list_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_update_own_dietary_preferences" ON "public"."dietary_preferences" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_update_own_log_infer" ON "public"."log_analyzebarcode" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_update_own_log_infer" ON "public"."log_feedback" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_update_own_log_llmcall" ON "public"."log_llmcall" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_update_own_user_list_items" ON "public"."user_list_items" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."analytics_analyze_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."analytics_analyze_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."analytics_analyze_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."analytics_analyze_latency_stats"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."analytics_analyze_latency_stats"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."analytics_analyze_latency_stats"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."analytics_inventory_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric, "user_filter" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."analytics_inventory_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric, "user_filter" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."analytics_inventory_latency"("limit_count" integer, "min_latency_ms" numeric, "max_latency_ms" numeric, "user_filter" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."analytics_inventory_latency_performance"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."analytics_inventory_latency_performance"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."analytics_inventory_latency_performance"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."analytics_new_users_per_day"("start_date" "date", "end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."analytics_new_users_per_day"("start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."analytics_new_users_per_day"("start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."analytics_repeat_users"("last_n_days" integer, "excluded_user_ids" "uuid"[], "provider_filter" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."analytics_repeat_users"("last_n_days" integer, "excluded_user_ids" "uuid"[], "provider_filter" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."analytics_repeat_users"("last_n_days" integer, "excluded_user_ids" "uuid"[], "provider_filter" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "new_role" "text", "assigned_by_user_id" "uuid", "notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "new_role" "text", "assigned_by_user_id" "uuid", "notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_user_role"("target_user_id" "uuid", "new_role" "text", "assigned_by_user_id" "uuid", "notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."barcode_review_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."barcode_review_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."barcode_review_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."barcode_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."barcode_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."barcode_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."barcode_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."barcode_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."barcode_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_review_threads"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_review_threads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_review_threads"() TO "service_role";



GRANT ALL ON FUNCTION "public"."export_promoted_llm_data"("p_tab_type" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."export_promoted_llm_data"("p_tab_type" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."export_promoted_llm_data"("p_tab_type" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_review_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."extract_review_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_review_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_review_list"("p_limit" integer, "p_offset" integer, "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_review_list"("p_limit" integer, "p_offset" integer, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_review_list"("p_limit" integer, "p_offset" integer, "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_review_list_enhanced"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."extract_review_list_enhanced"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_review_list_enhanced"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_available_reviewers"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_available_reviewers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_available_reviewers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_check_history"("search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_check_history"("search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_check_history"("search_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_permissions"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_permissions"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_permissions"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_distinct_user_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_distinct_user_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distinct_user_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_list_items"("input_list_id" "uuid", "search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_list_items"("input_list_id" "uuid", "search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_list_items"("input_list_id" "uuid", "search_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_performance_metrics"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_performance_metrics"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_performance_metrics"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_popular_products"("limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_popular_products"("limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_popular_products"("limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_product_brands"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_product_brands"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_brands"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_product_data_sources"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_product_data_sources"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_data_sources"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_products_list"("p_limit" integer, "p_offset" integer, "p_search" "text", "p_brand" "text", "p_data_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_products_list"("p_limit" integer, "p_offset" integer, "p_search" "text", "p_brand" "text", "p_data_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_products_list"("p_limit" integer, "p_offset" integer, "p_search" "text", "p_brand" "text", "p_data_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_products_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_products_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_products_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_review_data"("p_thread_type" "text", "p_status" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_review_data"("p_thread_type" "text", "p_status" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_review_data"("p_thread_type" "text", "p_status" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_reviewers_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_reviewers_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reviewers_list"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_scan_activity_data"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_scan_activity_data"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_scan_activity_data"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_emails"("user_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_emails"("user_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_emails"("user_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_engagement_data"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_engagement_data"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_engagement_data"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_users_with_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_users_with_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_users_with_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("user_uuid" "uuid", "required_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("user_uuid" "uuid", "required_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("user_uuid" "uuid", "required_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_reviewer"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_reviewer"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_reviewer"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalized_barcode"("input_barcode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalized_barcode"("input_barcode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalized_barcode"("input_barcode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."preferences_review_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."preferences_review_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."preferences_review_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."preferences_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."preferences_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."preferences_review_filtered_count"("p_status" "text", "p_search_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."preferences_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."preferences_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."preferences_review_list"("p_limit" integer, "p_status" "text", "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."review_assign"("p_thread_id" "uuid", "p_reviewer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."review_assign"("p_thread_id" "uuid", "p_reviewer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_assign"("p_thread_id" "uuid", "p_reviewer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."review_comment_add"("p_thread_id" "uuid", "p_comment" "text", "p_action" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."review_comment_add"("p_thread_id" "uuid", "p_comment" "text", "p_action" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_comment_add"("p_thread_id" "uuid", "p_comment" "text", "p_action" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_open_or_get_thread"("p_source_table" "text", "p_source_id" "uuid", "p_thread_type" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_inventory_cache_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_inventory_cache_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_inventory_cache_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_barcode_review_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_barcode_review_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_barcode_review_list"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_preferences_review_list"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_preferences_review_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_preferences_review_list"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."dashboard_access_logs" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_access_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_access_logs" TO "service_role";



GRANT ALL ON TABLE "public"."dietary_preferences" TO "anon";
GRANT ALL ON TABLE "public"."dietary_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."dietary_preferences" TO "service_role";



GRANT ALL ON SEQUENCE "public"."dietary_preferences_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."dietary_preferences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."dietary_preferences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_cache" TO "anon";
GRANT ALL ON TABLE "public"."inventory_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_cache" TO "service_role";



GRANT ALL ON TABLE "public"."log_analyzebarcode" TO "anon";
GRANT ALL ON TABLE "public"."log_analyzebarcode" TO "authenticated";
GRANT ALL ON TABLE "public"."log_analyzebarcode" TO "service_role";



GRANT ALL ON TABLE "public"."log_extract" TO "anon";
GRANT ALL ON TABLE "public"."log_extract" TO "authenticated";
GRANT ALL ON TABLE "public"."log_extract" TO "service_role";



GRANT ALL ON TABLE "public"."log_feedback" TO "anon";
GRANT ALL ON TABLE "public"."log_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."log_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."log_images" TO "anon";
GRANT ALL ON TABLE "public"."log_images" TO "authenticated";
GRANT ALL ON TABLE "public"."log_images" TO "service_role";



GRANT ALL ON TABLE "public"."log_inventory" TO "anon";
GRANT ALL ON TABLE "public"."log_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."log_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."log_llmcall" TO "anon";
GRANT ALL ON TABLE "public"."log_llmcall" TO "authenticated";
GRANT ALL ON TABLE "public"."log_llmcall" TO "service_role";



GRANT ALL ON TABLE "public"."log_preference_validation" TO "anon";
GRANT ALL ON TABLE "public"."log_preference_validation" TO "authenticated";
GRANT ALL ON TABLE "public"."log_preference_validation" TO "service_role";



GRANT ALL ON TABLE "public"."recorded_sessions" TO "anon";
GRANT ALL ON TABLE "public"."recorded_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."recorded_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recorded_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recorded_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recorded_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."review_assignments" TO "anon";
GRANT ALL ON TABLE "public"."review_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."review_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."review_comments" TO "anon";
GRANT ALL ON TABLE "public"."review_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."review_comments" TO "service_role";



GRANT ALL ON TABLE "public"."review_expected_outputs" TO "anon";
GRANT ALL ON TABLE "public"."review_expected_outputs" TO "authenticated";
GRANT ALL ON TABLE "public"."review_expected_outputs" TO "service_role";



GRANT ALL ON TABLE "public"."review_threads" TO "anon";
GRANT ALL ON TABLE "public"."review_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."review_threads" TO "service_role";



GRANT ALL ON TABLE "public"."role_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."role_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."role_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."user_list_items" TO "anon";
GRANT ALL ON TABLE "public"."user_list_items" TO "authenticated";
GRANT ALL ON TABLE "public"."user_list_items" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist" TO "anon";
GRANT ALL ON TABLE "public"."waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
