import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

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
