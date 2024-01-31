import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { SupabaseClient } from '@supabase/supabase-js'

export async function getUserId(ctx: Context): Promise<string> {
    const supabaseClient: SupabaseClient = ctx.state.supabaseClient
    const userResponse = await supabaseClient.auth.getUser()
    return userResponse.data.user?.id ?? ''
}