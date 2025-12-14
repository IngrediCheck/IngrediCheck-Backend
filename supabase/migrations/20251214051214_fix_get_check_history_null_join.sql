-- Fix get_check_history performance issue caused by NULL and duplicate
-- client_activity_id values in log_inventory causing row explosion during JOIN

CREATE OR REPLACE FUNCTION public.get_check_history(search_query text DEFAULT NULL::text)
 RETURNS TABLE(created_at timestamp with time zone, client_activity_id uuid, barcode text, name text, brand text, ingredients json, images json, ingredient_recommendations json, rating integer, favorited boolean)
 LANGUAGE plpgsql
AS $function$
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
        SELECT DISTINCT ON (COALESCE(li.barcode, le.barcode), COALESCE(li.name, le.name), COALESCE(li.brand, le.brand))
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
        LEFT JOIN (
            SELECT DISTINCT ON (inv.client_activity_id)
                inv.client_activity_id,
                inv.barcode,
                inv.name,
                inv.brand,
                inv.ingredients,
                inv.images
            FROM public.log_inventory inv
            WHERE inv.client_activity_id IS NOT NULL
            ORDER BY inv.client_activity_id, inv.created_at DESC
        ) li ON la.client_activity_id = li.client_activity_id
        LEFT JOIN public.log_extract le
            ON la.client_activity_id = le.client_activity_id
        LEFT JOIN public.log_feedback lf
            ON la.client_activity_id = lf.client_activity_id
        WHERE
            la.user_id = auth.uid()
            AND la.created_at > '2024-03-15'::date
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
            COALESCE(li.barcode, le.barcode), COALESCE(li.name, le.name), COALESCE(li.brand, le.brand), la.created_at DESC
    ) AS sub
    ORDER BY
        sub.created_at DESC;
END;
$function$;
