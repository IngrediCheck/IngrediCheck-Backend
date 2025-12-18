import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const MB = 1024 * 1024

// New scan feedback types
interface ScanFeedbackPayload {
    target_type: 'product_info' | 'product_image' | 'analysis' | 'flagged_ingredient' | 'other'
    vote_type?: 'down'
    scan_id?: string
    scan_image_id?: string
    scan_analysis_id?: string
    ingredient_name?: string
    comment?: string
}

export async function submitScanFeedback(ctx: Context) {
    let body: ScanFeedbackPayload

    try {
        body = await ctx.request.body({ type: 'json' }).value as ScanFeedbackPayload
    } catch {
        ctx.response.status = 400
        ctx.response.body = { error: 'Invalid JSON body' }
        return
    }

    if (!body.target_type) {
        ctx.response.status = 400
        ctx.response.body = { error: 'target_type is required' }
        return
    }

    const validTargetTypes = ['product_info', 'product_image', 'analysis', 'flagged_ingredient', 'other']
    if (!validTargetTypes.includes(body.target_type)) {
        ctx.response.status = 400
        ctx.response.body = { error: `target_type must be one of: ${validTargetTypes.join(', ')}` }
        return
    }

    // Validate required fields based on target_type
    if (body.target_type === 'product_info' && !body.scan_id) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scan_id required for product_info feedback' }
        return
    }

    if (body.target_type === 'product_image' && !body.scan_image_id) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scan_image_id required for product_image feedback' }
        return
    }

    if ((body.target_type === 'analysis' || body.target_type === 'flagged_ingredient') && !body.scan_analysis_id) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scan_analysis_id required for analysis/flagged_ingredient feedback' }
        return
    }

    if (body.target_type === 'flagged_ingredient' && !body.ingredient_name) {
        ctx.response.status = 400
        ctx.response.body = { error: 'ingredient_name required for flagged_ingredient feedback' }
        return
    }

    const result = await ctx.state.supabaseClient.rpc('submit_feedback', {
        p_target_type: body.target_type,
        p_vote_type: body.vote_type ?? 'down',
        p_scan_id: body.scan_id ?? null,
        p_scan_image_id: body.scan_image_id ?? null,
        p_scan_analysis_id: body.scan_analysis_id ?? null,
        p_ingredient_name: body.ingredient_name ?? null,
        p_comment: body.comment ?? null
    })

    if (result.error) {
        console.error('[feedback#submitScanFeedback] rpc error', result.error)

        if (result.error.message?.includes('not found') || result.error.message?.includes('access denied')) {
            ctx.response.status = 404
            ctx.response.body = { error: result.error.message }
            return
        }

        ctx.response.status = 500
        ctx.response.body = { error: result.error.message ?? String(result.error) }
        return
    }

    ctx.response.status = 201
    ctx.response.body = result.data
}

/**
 * @deprecated This function is part of the legacy feedback system.
 *
 * SUPERSEDED BY: submitScanFeedback() above
 * - New endpoint: POST /ingredicheck/v2/scan/feedback
 * - New table: `feedback` (replaces `log_feedback`)
 *
 * This legacy function:
 * - Uses the old `log_feedback` table
 * - Tracks feedback by `client_activity_id` (legacy activity system)
 * - Supports generic ratings/reasons (not scan-specific)
 *
 * The new system:
 * - Uses the `feedback` table with polymorphic target types
 * - Links directly to scans, scan_images, scan_analyses
 * - Supports downvotes on: product_info, product_image, analysis, flagged_ingredient
 *
 * DO NOT use this for new development. Migrate to submitScanFeedback().
 */
export async function submitFeedback(ctx: Context) {

    try {
        const body = ctx.request.body({ type: "form-data" })
        const formData = await body.value.read({ maxSize: 10 * MB })

        const clientActivityId = formData.fields['clientActivityId']
        const feedback = JSON.parse(formData.fields['feedback'])

        if (feedback.images) {
            EdgeRuntime.waitUntil(
                ctx.state.supabaseClient.functions.invoke('background/log_images', {
                    body: {
                        activity_id: ctx.state.activityId,
                        client_activity_id: clientActivityId,
                        product_images: feedback.images
                    },
                    method: 'POST'
                })
            )
        }

        const result = await ctx.state.supabaseClient
            .from('log_feedback')
            .upsert({
                user_id: ctx.state.userId,
                activity_id: ctx.state.activityId,
                client_activity_id: clientActivityId,
                rating: feedback.rating,
                reasons: feedback.reasons,
                note: feedback.note,
                images: feedback.images?.map((i: any) => i.imageFileHash)
            }, {
                onConflict: ['client_activity_id']
            })
        if (result.error) {
            console.log('supabaseClient.from(log_feedback).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }

        ctx.response.status = 201
    } catch (error) {
        console.log(`Error submitting feedback: ${error.message}`)
        ctx.response.status = 500
        ctx.response.body = error
    }
}