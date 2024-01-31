import { createClient } from '@supabase/supabase-js'
import supabaseConfig from './supabase-service.json' assert { type: 'json' }

export const supabase = createClient(supabaseConfig.url, supabaseConfig.anon_key, { auth: { persistSession: false } })

export async function signIn() {
    const result = await supabase.auth.signInWithPassword({
        email: supabaseConfig.email,
        password: supabaseConfig.password,
    })

    if (result.error) {
        throw result.error
    }
}