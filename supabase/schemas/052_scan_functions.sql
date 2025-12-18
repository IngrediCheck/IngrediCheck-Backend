-- Functions for scan queries.

-- Helper: Check if analysis is stale (food notes have changed since analysis)
CREATE OR REPLACE FUNCTION public.is_analysis_stale(
    p_food_note_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    snapshot_family jsonb;
    snapshot_members jsonb;
    member_snapshot jsonb;
    current_family_version integer;
    current_member_version integer;
BEGIN
    IF p_food_note_snapshot IS NULL THEN
        RETURN false;
    END IF;

    -- Get current user's member
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    snapshot_family := p_food_note_snapshot->'family';
    snapshot_members := p_food_note_snapshot->'members';

    -- Check family-level note if present in snapshot
    IF snapshot_family IS NOT NULL AND snapshot_family != 'null'::jsonb THEN
        SELECT fn.version INTO current_family_version
        FROM public.food_notes fn
        WHERE fn.family_id = current_member.family_id;

        IF current_family_version IS NOT NULL AND
           current_family_version != (snapshot_family->>'version')::integer THEN
            RETURN true;
        END IF;
    END IF;

    -- Check member notes
    IF snapshot_members IS NOT NULL AND jsonb_typeof(snapshot_members) = 'array' THEN
        FOR member_snapshot IN SELECT * FROM jsonb_array_elements(snapshot_members)
        LOOP
            SELECT fn.version INTO current_member_version
            FROM public.food_notes fn
            WHERE fn.member_id = (member_snapshot->>'id')::uuid;

            IF current_member_version IS NOT NULL AND
               current_member_version != (member_snapshot->>'version')::integer THEN
                RETURN true;
            END IF;
        END LOOP;
    END IF;

    RETURN false;
END;
$$;

-- V1: Get paginated scan history (backward compatible - snake_case, includes analysis_* fields)
CREATE OR REPLACE FUNCTION public.get_scans(
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    scan_type text,
    barcode text,
    product_info_source text,
    product_info jsonb,
    images_processed integer,
    status text,
    analysis_status text,
    analysis_started_at timestamptz,
    analysis_completed_at timestamptz,
    analysis_result jsonb,
    latest_guidance text,
    latest_error_message text,
    created_at timestamptz,
    last_activity_at timestamptz,
    total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total bigint;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM public.scans s
    WHERE s.user_id = auth.uid();

    RETURN QUERY
    SELECT
        s.id,
        s.scan_type,
        s.barcode,
        s.product_info_source,
        s.product_info,
        s.images_processed,
        s.status,
        sa.status AS analysis_status,
        sa.started_at AS analysis_started_at,
        sa.completed_at AS analysis_completed_at,
        sa.result AS analysis_result,
        s.latest_guidance,
        s.latest_error_message,
        s.created_at,
        s.last_activity_at,
        v_total AS total_count
    FROM public.scans s
    LEFT JOIN LATERAL (
        SELECT sa2.*
        FROM public.scan_analyses sa2
        WHERE sa2.scan_id = s.id
        ORDER BY sa2.created_at DESC
        LIMIT 1
    ) sa ON true
    WHERE s.user_id = auth.uid()
    ORDER BY s.last_activity_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- V2: Get paginated scan history (camelCase, includes latestAnalysis with isStale, isDownvoted)
CREATE OR REPLACE FUNCTION public.get_scans_v2(
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0,
    p_favorited boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total bigint;
    v_scans jsonb;
BEGIN
    -- Count total (with filter)
    SELECT COUNT(*) INTO v_total
    FROM public.scans s
    WHERE s.user_id = auth.uid()
      AND (p_favorited IS NULL OR s.is_favorited = p_favorited);

    -- Get scans with latest analysis
    SELECT COALESCE(jsonb_agg(scan_data ORDER BY scan_data->>'lastActivityAt' DESC), '[]'::jsonb)
    INTO v_scans
    FROM (
        SELECT jsonb_build_object(
            'id', s.id,
            'scanType', s.scan_type,
            'barcode', s.barcode,
            'productInfoSource', s.product_info_source,
            'productInfo', s.product_info,
            'imagesProcessed', s.images_processed,
            'status', s.status,
            'isFavorited', s.is_favorited,
            'latestGuidance', s.latest_guidance,
            'latestErrorMessage', s.latest_error_message,
            'createdAt', s.created_at,
            'lastActivityAt', s.last_activity_at,
            'latestAnalysis', (
                SELECT jsonb_build_object(
                    'id', sa.id,
                    'status', sa.status,
                    'isStale', public.is_analysis_stale(sa.food_note_snapshot),
                    'result', sa.result,
                    'isDownvoted', EXISTS(
                        SELECT 1 FROM public.feedback f
                        WHERE f.scan_analysis_id = sa.id
                          AND f.user_id = auth.uid()
                          AND f.target_type = 'analysis'
                    ),
                    'startedAt', sa.started_at,
                    'completedAt', sa.completed_at,
                    'createdAt', sa.created_at
                )
                FROM public.scan_analyses sa
                WHERE sa.scan_id = s.id
                ORDER BY sa.created_at DESC
                LIMIT 1
            )
        ) AS scan_data
        FROM public.scans s
        WHERE s.user_id = auth.uid()
          AND (p_favorited IS NULL OR s.is_favorited = p_favorited)
        ORDER BY s.last_activity_at DESC
        LIMIT p_limit
        OFFSET p_offset
    ) sub;

    RETURN jsonb_build_object(
        'scans', v_scans,
        'totalCount', v_total
    );
END;
$$;

-- Get single scan with full details
CREATE OR REPLACE FUNCTION public.get_scan_detail(
    p_scan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scan record;
    v_images jsonb;
    v_latest_analysis jsonb;
BEGIN
    -- Get scan
    SELECT * INTO v_scan
    FROM public.scans s
    WHERE s.id = p_scan_id
      AND s.user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Get images
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', si.id,
            'contentHash', si.content_hash,
            'status', si.status,
            'storagePath', si.storage_path,
            'extractionResult', si.extraction_result,
            'extractionError', si.extraction_error,
            'queuedAt', si.queued_at,
            'processedAt', si.processed_at
        ) ORDER BY si.queued_at DESC
    ), '[]'::jsonb) INTO v_images
    FROM public.scan_images si
    WHERE si.scan_id = p_scan_id;

    -- Get latest analysis with downvote status and flagged ingredient downvotes
    SELECT jsonb_build_object(
        'id', sa.id,
        'status', sa.status,
        'isStale', public.is_analysis_stale(sa.food_note_snapshot),
        'result', CASE
            WHEN sa.result IS NULL THEN NULL
            ELSE jsonb_set(
                sa.result,
                '{flaggedIngredients}',
                COALESCE((
                    SELECT jsonb_agg(
                        ing || jsonb_build_object(
                            'isDownvoted', EXISTS(
                                SELECT 1 FROM public.feedback f
                                WHERE f.scan_analysis_id = sa.id
                                  AND f.user_id = auth.uid()
                                  AND f.target_type = 'flagged_ingredient'
                                  AND f.ingredient_name = ing->>'name'
                            )
                        )
                    )
                    FROM jsonb_array_elements(sa.result->'flaggedIngredients') ing
                ), '[]'::jsonb)
            )
        END,
        'isDownvoted', EXISTS(
            SELECT 1 FROM public.feedback f
            WHERE f.scan_analysis_id = sa.id
              AND f.user_id = auth.uid()
              AND f.target_type = 'analysis'
        ),
        'startedAt', sa.started_at,
        'completedAt', sa.completed_at,
        'createdAt', sa.created_at
    ) INTO v_latest_analysis
    FROM public.scan_analyses sa
    WHERE sa.scan_id = p_scan_id
    ORDER BY sa.created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'id', v_scan.id,
        'scanType', v_scan.scan_type,
        'barcode', v_scan.barcode,
        'productInfoSource', v_scan.product_info_source,
        'productInfo', v_scan.product_info,
        'imagesProcessed', v_scan.images_processed,
        'status', v_scan.status,
        'isFavorited', v_scan.is_favorited,
        'latestGuidance', v_scan.latest_guidance,
        'latestErrorMessage', v_scan.latest_error_message,
        'createdAt', v_scan.created_at,
        'lastActivityAt', v_scan.last_activity_at,
        'images', v_images,
        'latestAnalysis', v_latest_analysis
    );
END;
$$;

-- Get images for a list of scan IDs (for building full Scan response)
CREATE OR REPLACE FUNCTION public.get_scan_images(
    p_scan_ids uuid[]
)
RETURNS TABLE (
    id uuid,
    scan_id uuid,
    content_hash text,
    status text,
    storage_path text,
    extraction_result jsonb,
    extraction_error text,
    queued_at timestamptz,
    processed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        si.id,
        si.scan_id,
        si.content_hash,
        si.status,
        si.storage_path,
        si.extraction_result,
        si.extraction_error,
        si.queued_at,
        si.processed_at
    FROM public.scan_images si
    JOIN public.scans s ON s.id = si.scan_id
    WHERE si.scan_id = ANY(p_scan_ids)
      AND s.user_id = auth.uid()
    ORDER BY si.queued_at DESC;
END;
$$;

-- Toggle scan favorite status
CREATE OR REPLACE FUNCTION public.toggle_scan_favorite(
    p_scan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_status boolean;
BEGIN
    UPDATE public.scans
    SET is_favorited = NOT is_favorited
    WHERE id = p_scan_id
      AND user_id = auth.uid()
    RETURNING is_favorited INTO v_new_status;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Scan not found or access denied';
    END IF;

    RETURN jsonb_build_object('isFavorited', v_new_status);
END;
$$;

-- Submit feedback
CREATE OR REPLACE FUNCTION public.submit_feedback(
    p_target_type text,
    p_vote_type text DEFAULT 'down',
    p_scan_id uuid DEFAULT NULL,
    p_scan_image_id uuid DEFAULT NULL,
    p_scan_analysis_id uuid DEFAULT NULL,
    p_ingredient_name text DEFAULT NULL,
    p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_feedback_id uuid;
BEGIN
    -- Validate target_type
    IF p_target_type NOT IN ('product_info', 'product_image', 'analysis', 'flagged_ingredient', 'other') THEN
        RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
    END IF;

    -- Validate required references based on target_type
    IF p_target_type = 'product_info' AND p_scan_id IS NULL THEN
        RAISE EXCEPTION 'scan_id required for product_info feedback';
    END IF;

    IF p_target_type = 'product_image' AND p_scan_image_id IS NULL THEN
        RAISE EXCEPTION 'scan_image_id required for product_image feedback';
    END IF;

    IF p_target_type IN ('analysis', 'flagged_ingredient') AND p_scan_analysis_id IS NULL THEN
        RAISE EXCEPTION 'scan_analysis_id required for analysis/flagged_ingredient feedback';
    END IF;

    IF p_target_type = 'flagged_ingredient' AND p_ingredient_name IS NULL THEN
        RAISE EXCEPTION 'ingredient_name required for flagged_ingredient feedback';
    END IF;

    -- Verify ownership of referenced entities
    IF p_scan_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.scans s
            WHERE s.id = p_scan_id AND s.user_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Scan not found or access denied';
        END IF;
    END IF;

    IF p_scan_image_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.scan_images si
            JOIN public.scans s ON s.id = si.scan_id
            WHERE si.id = p_scan_image_id AND s.user_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Scan image not found or access denied';
        END IF;
    END IF;

    IF p_scan_analysis_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.scan_analyses sa
            JOIN public.scans s ON s.id = sa.scan_id
            WHERE sa.id = p_scan_analysis_id AND s.user_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Scan analysis not found or access denied';
        END IF;
    END IF;

    -- Insert feedback
    INSERT INTO public.feedback (
        user_id,
        target_type,
        scan_id,
        scan_image_id,
        scan_analysis_id,
        ingredient_name,
        vote_type,
        comment
    ) VALUES (
        auth.uid(),
        p_target_type,
        p_scan_id,
        p_scan_image_id,
        p_scan_analysis_id,
        p_ingredient_name,
        p_vote_type,
        p_comment
    )
    RETURNING id INTO v_feedback_id;

    RETURN jsonb_build_object(
        'id', v_feedback_id,
        'success', true
    );
END;
$$;

-- Get food note snapshot for analysis
CREATE OR REPLACE FUNCTION public.get_food_note_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_member record;
    family_note record;
    member_notes jsonb;
BEGIN
    -- Get current user's member
    SELECT * INTO current_member
    FROM public.members
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Get family-level note if exists
    SELECT fn.* INTO family_note
    FROM public.food_notes fn
    WHERE fn.family_id = current_member.family_id;

    -- Get all member notes in the family
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', fn.member_id,
            'version', fn.version
        )
    ), '[]'::jsonb) INTO member_notes
    FROM public.food_notes fn
    JOIN public.members m ON m.id = fn.member_id
    WHERE m.family_id = current_member.family_id
      AND m.deleted_at IS NULL;

    RETURN jsonb_build_object(
        'family', CASE
            WHEN family_note.id IS NOT NULL THEN
                jsonb_build_object(
                    'id', current_member.family_id,
                    'version', family_note.version
                )
            ELSE NULL
        END,
        'members', member_notes
    );
END;
$$;
