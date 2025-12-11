drop function if exists "public"."barcode_review_list"(p_limit integer, p_status text, p_offset integer, p_search_query text);

drop function if exists "public"."extract_review_list_enhanced"(p_limit integer, p_status text, p_offset integer, p_search_query text);

drop function if exists "public"."preferences_review_list"(p_limit integer, p_status text, p_offset integer, p_search_query text);

drop index if exists "public"."idx_dietary_preferences_user_id";

CREATE INDEX idx_log_analyzebarcode_client_activity ON public.log_analyzebarcode USING btree (client_activity_id) WHERE (client_activity_id IS NOT NULL);

CREATE INDEX idx_log_analyzebarcode_user_created ON public.log_analyzebarcode USING btree (user_id, created_at DESC);

CREATE INDEX idx_log_extract_client_activity ON public.log_extract USING btree (client_activity_id);

CREATE INDEX idx_log_inventory_client_activity ON public.log_inventory USING btree (client_activity_id);

CREATE INDEX idx_user_list_items_lookup ON public.user_list_items USING btree (list_item_id, list_id) WHERE (list_id = '00000000-0000-0000-0000-000000000000'::uuid);

set check_function_bodies = off;

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


