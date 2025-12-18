create extension if not exists "pg_net" with schema "extensions";

alter table "public"."scans" drop constraint "scans_analysis_status_check";
  create table "public"."feedback" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "target_type" text not null,
    "scan_id" uuid,
    "scan_image_id" uuid,
    "scan_analysis_id" uuid,
    "ingredient_name" text,
    "vote_type" text not null,
    "comment" text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."feedback" enable row level security;
  create table "public"."scan_analyses" (
    "id" uuid not null default gen_random_uuid(),
    "scan_id" uuid not null,
    "food_note_snapshot" jsonb,
    "status" text not null default 'in_progress'::text,
    "result" jsonb,
    "started_at" timestamp with time zone not null default now(),
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."scan_analyses" enable row level security;

alter table "public"."review_expected_outputs" enable row level security;

alter table "public"."scans" drop column "analysis_completed_at";

alter table "public"."scans" drop column "analysis_result";

alter table "public"."scans" drop column "analysis_started_at";

alter table "public"."scans" drop column "analysis_status";

alter table "public"."scans" add column "is_favorited" boolean not null default false;

CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id);

CREATE INDEX idx_feedback_scan ON public.feedback USING btree (scan_id) WHERE (scan_id IS NOT NULL);

CREATE INDEX idx_feedback_scan_analysis ON public.feedback USING btree (scan_analysis_id) WHERE (scan_analysis_id IS NOT NULL);

CREATE INDEX idx_feedback_user ON public.feedback USING btree (user_id);

CREATE INDEX idx_scan_analyses_scan_created ON public.scan_analyses USING btree (scan_id, created_at DESC);

CREATE INDEX idx_scans_user_favorited ON public.scans USING btree (user_id, is_favorited) WHERE (is_favorited = true);

CREATE UNIQUE INDEX scan_analyses_pkey ON public.scan_analyses USING btree (id);

alter table "public"."feedback" add constraint "feedback_pkey" PRIMARY KEY using index "feedback_pkey";

alter table "public"."scan_analyses" add constraint "scan_analyses_pkey" PRIMARY KEY using index "scan_analyses_pkey";

alter table "public"."feedback" add constraint "feedback_scan_analysis_id_fkey" FOREIGN KEY (scan_analysis_id) REFERENCES public.scan_analyses(id) ON DELETE CASCADE not valid;

alter table "public"."feedback" validate constraint "feedback_scan_analysis_id_fkey";

alter table "public"."feedback" add constraint "feedback_scan_id_fkey" FOREIGN KEY (scan_id) REFERENCES public.scans(id) ON DELETE CASCADE not valid;

alter table "public"."feedback" validate constraint "feedback_scan_id_fkey";

alter table "public"."feedback" add constraint "feedback_scan_image_id_fkey" FOREIGN KEY (scan_image_id) REFERENCES public.scan_images(id) ON DELETE CASCADE not valid;

alter table "public"."feedback" validate constraint "feedback_scan_image_id_fkey";

alter table "public"."feedback" add constraint "feedback_target_type_check" CHECK ((target_type = ANY (ARRAY['product_info'::text, 'product_image'::text, 'analysis'::text, 'flagged_ingredient'::text, 'other'::text]))) not valid;

alter table "public"."feedback" validate constraint "feedback_target_type_check";

alter table "public"."feedback" add constraint "feedback_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."feedback" validate constraint "feedback_user_id_fkey";

alter table "public"."feedback" add constraint "feedback_vote_type_check" CHECK ((vote_type = 'down'::text)) not valid;

alter table "public"."feedback" validate constraint "feedback_vote_type_check";

alter table "public"."scan_analyses" add constraint "scan_analyses_scan_id_fkey" FOREIGN KEY (scan_id) REFERENCES public.scans(id) ON DELETE CASCADE not valid;

alter table "public"."scan_analyses" validate constraint "scan_analyses_scan_id_fkey";

alter table "public"."scan_analyses" add constraint "scan_analyses_status_check" CHECK ((status = ANY (ARRAY['in_progress'::text, 'complete'::text, 'failed'::text]))) not valid;

alter table "public"."scan_analyses" validate constraint "scan_analyses_status_check";

set check_function_bodies = off;

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
$function$
;
grant delete on table "public"."feedback" to "authenticated";

grant insert on table "public"."feedback" to "authenticated";

grant references on table "public"."feedback" to "authenticated";

grant select on table "public"."feedback" to "authenticated";

grant trigger on table "public"."feedback" to "authenticated";

grant truncate on table "public"."feedback" to "authenticated";

grant update on table "public"."feedback" to "authenticated";

grant delete on table "public"."feedback" to "service_role";

grant insert on table "public"."feedback" to "service_role";

grant references on table "public"."feedback" to "service_role";

grant select on table "public"."feedback" to "service_role";

grant trigger on table "public"."feedback" to "service_role";

grant truncate on table "public"."feedback" to "service_role";

grant update on table "public"."feedback" to "service_role";
grant delete on table "public"."scan_analyses" to "authenticated";

grant insert on table "public"."scan_analyses" to "authenticated";

grant references on table "public"."scan_analyses" to "authenticated";

grant select on table "public"."scan_analyses" to "authenticated";

grant trigger on table "public"."scan_analyses" to "authenticated";

grant truncate on table "public"."scan_analyses" to "authenticated";

grant update on table "public"."scan_analyses" to "authenticated";

grant delete on table "public"."scan_analyses" to "service_role";

grant insert on table "public"."scan_analyses" to "service_role";

grant references on table "public"."scan_analyses" to "service_role";

grant select on table "public"."scan_analyses" to "service_role";

grant trigger on table "public"."scan_analyses" to "service_role";

grant truncate on table "public"."scan_analyses" to "service_role";

grant update on table "public"."scan_analyses" to "service_role";
  create policy "delete_feedback"
  on "public"."feedback"
  as permissive
  for delete
  to authenticated
using ((user_id = auth.uid()));

  create policy "insert_feedback"
  on "public"."feedback"
  as permissive
  for insert
  to authenticated
with check ((user_id = auth.uid()));

  create policy "select_feedback"
  on "public"."feedback"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));

  create policy "update_feedback"
  on "public"."feedback"
  as permissive
  for update
  to authenticated
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));

  create policy "Admins can manage all expected outputs"
  on "public"."review_expected_outputs"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()));

  create policy "Reviewers can add expected outputs to any thread"
  on "public"."review_expected_outputs"
  as permissive
  for insert
  to public
with check (public.is_reviewer(auth.uid()));

  create policy "Reviewers can view expected outputs on any thread"
  on "public"."review_expected_outputs"
  as permissive
  for select
  to public
using ((public.is_reviewer(auth.uid()) OR public.is_admin(auth.uid())));

  create policy "delete_scan_analyses"
  on "public"."scan_analyses"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.scans s
  WHERE ((s.id = scan_analyses.scan_id) AND (s.user_id = auth.uid())))));

  create policy "insert_scan_analyses"
  on "public"."scan_analyses"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.scans s
  WHERE ((s.id = scan_analyses.scan_id) AND (s.user_id = auth.uid())))));

  create policy "select_scan_analyses"
  on "public"."scan_analyses"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.scans s
  WHERE ((s.id = scan_analyses.scan_id) AND (s.user_id = auth.uid())))));

  create policy "update_scan_analyses"
  on "public"."scan_analyses"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.scans s
  WHERE ((s.id = scan_analyses.scan_id) AND (s.user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.scans s
  WHERE ((s.id = scan_analyses.scan_id) AND (s.user_id = auth.uid())))));
drop policy "storage_scan_images_service_role" on "storage"."objects";
