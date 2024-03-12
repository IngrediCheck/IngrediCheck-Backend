import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

export async function get(ctx: Context, searchText: string | null) {
    const { data } = await ctx.state.supabaseClient.rpc('get_check_history', { search_query: searchText })
    ctx.response.status = 200
    ctx.response.body = data
}