
import { Context } from "https://deno.land/x/oak@v13.0.0/mod.ts"
import * as KitchenSink from "../shared/kitchensink.ts"

export async function get(ctx: Context) {
    const userId = await KitchenSink.getUserId(ctx)
    const result = await ctx.state.supabaseClient
    .from('preferences')
    .select('preference')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

    if (result.error) {
        console.log(`Error fetching preference: ${result.error.message}`)
        ctx.response.status = 500
        ctx.response.body = result.error
    } else {
        ctx.response.status = 200
        ctx.response.body = result.data.content
    }
}

export async function set(ctx: Context) {
    const userId = await KitchenSink.getUserId(ctx)
    const preference = await ctx.request.body.text()
    const { error } = await ctx.state.supabaseClient
        .from('preferences')
        .insert({
            user_id: userId,
            preference: preference
        })
    if (error) {
        throw error
    }
    ctx.response.status = 201
}