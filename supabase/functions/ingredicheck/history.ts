import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

export async function get(ctx: Context, searchText: string | null) {
    const { data } = await ctx.state.supabaseClient.rpc('get_check_history', { search_query: searchText })

    // Compatibility - ingredient_recommendations[i].preference was added later.

    for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < data[i].ingredient_recommendations.length; j++) {
            if (!('preference' in data[i].ingredient_recommendations[j])) {
                data[i].ingredient_recommendations[j].preference = 'unknown'
            }
        }
    }
    
    ctx.response.status = 200
    ctx.response.body = data
}