import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { SupabaseClient } from '@supabase/supabase-js'

export async function getUserId(ctx: Context): Promise<string> {
	const supabaseClient: SupabaseClient = ctx.state.supabaseClient
	const authHeader = ctx.request.headers.get('authorization') ?? ''
	const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
	const userResponse = await supabaseClient.auth.getUser(token)
	const userId = userResponse.data.user?.id
	if (!userId) {
		throw new Error('Unauthorized: No valid user found')
	}
	return userId
}