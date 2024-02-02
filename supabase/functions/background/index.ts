import { Application, Router } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { createClient } from '@supabase/supabase-js'
import * as KitchenSink from "../shared/kitchensink.ts"

const app = new Application()

app.use((ctx, next) => {
    ctx.state.supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
            auth: { persistSession: false },
            global: { headers: { Authorization: ctx.request.headers.get('Authorization')! } }
        }
    )
    ctx.state.activityId = crypto.randomUUID()
    return next()
})

const router = new Router()

router
    .post('/background/log_inventory', async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const user_id = await KitchenSink.getUserId(ctx)
        const entry = {
            ...body_json,
            user_id: user_id,
        }
        const result = await ctx.state.supabaseClient
            .from('log_inventory')
            .insert(entry)
        if (result.error) {
            console.log('supabaseClient.from(log_inventory).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }
        ctx.response.status = 201
    })
    .post("/background/log_llmcalls", async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const user_id = await KitchenSink.getUserId(ctx)
        const entries = body_json.map((entry: any) => {
            return {
                user_id: user_id,
                ...entry
            }
        })
        const result = await ctx.state.supabaseClient
            .from('log_llmcall')
            .insert(entries)
        if (result.error) {
            console.log('supabaseClient.from(log_llmcall).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }
        ctx.response.status = 201
    })
    .post("/background/log_analyzebarcode", async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const result = await ctx.state.supabaseClient
            .from('log_analyzebarcode')
            .insert({
                user_id: await KitchenSink.getUserId(ctx),
                ...body_json
            })
        if (result.error) {
            console.log('supabaseClient.from(log_analyzebarcode).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }
        ctx.response.status = 201
    })

app.use(router.routes())
app.use(router.allowedMethods())

await app.listen({ port: 8000 })