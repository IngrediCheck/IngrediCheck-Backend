/**
 * @deprecated This entire module is part of the legacy history system.
 *
 * SUPERSEDED BY: scan.ts getHistory() function
 * - New endpoint: GET /ingredicheck/v2/scan/history
 * - New RPC: get_scans() (returns scans with latestAnalysis)
 *
 * This legacy module:
 * - Uses get_check_history() RPC which queries old logging tables:
 *   - log_analyzebarcode
 *   - log_extract
 *   - log_inventory
 *   - log_feedback
 * - Tracks activities by client_activity_id (legacy system)
 * - Does not support favorites, stale analysis detection, or structured feedback
 *
 * The new scan history system:
 * - Uses the `scans` and `scan_analyses` tables
 * - Supports favorites filtering (?favorited=true)
 * - Includes latestAnalysis with isStale flag
 * - Includes isDownvoted status for feedback
 *
 * DO NOT use this for new development. Migrate to GET /ingredicheck/v2/scan/history.
 */
import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

/**
 * @deprecated Use Scan.getHistory() instead (GET /ingredicheck/v2/scan/history)
 */
export async function get(ctx: Context, searchText: string | null) {
    try {
        const { data, error } = await ctx.state.supabaseClient.rpc('get_check_history', { search_query: searchText })

        if (error) {
            console.error('[history#get] rpc error', error)
            ctx.response.status = 500
            ctx.response.body = error.message ?? String(error)
            return
        }

        if (!Array.isArray(data)) {
            console.error('[history#get] received unexpected data', data)
            ctx.response.status = 500
            ctx.response.body = 'Unexpected response from get_check_history'
            return
        }

        // Compatibility - ingredient_recommendations[i].preference was added later.
        for (let i = 0; i < data.length; i++) {
            if (!Array.isArray(data[i].ingredients)) {
                data[i].ingredients = []
            }

            if (!Array.isArray(data[i].images)) {
                data[i].images = []
            }

            if (!Array.isArray(data[i].ingredient_recommendations)) {
                data[i].ingredient_recommendations = []
                continue
            }

            for (let j = 0; j < data[i].ingredient_recommendations.length; j++) {
                const recommendation = data[i].ingredient_recommendations[j]
                if (recommendation && typeof recommendation === 'object' && !('preference' in recommendation)) {
                    recommendation.preference = 'unknown'
                }
                data[i].ingredient_recommendations[j] = recommendation
            }
        }

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        console.error('[history#get] unhandled error', error)
        ctx.response.status = 500
        ctx.response.body = error instanceof Error ? error.message : String(error)
    }
}
