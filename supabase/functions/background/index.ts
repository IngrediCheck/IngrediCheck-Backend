import { Application, Router } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { createClient } from '@supabase/supabase-js'
import { decodeUserIdFromRequest } from '../shared/auth.ts'

const app = new Application()

app.use(async (ctx, next) => {
    try {
        await decodeUserIdFromRequest(ctx)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unauthorized'
        ctx.response.status = 401
        ctx.response.body = { error: message }
        return
    }

    ctx.state.supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        {
            auth: { persistSession: false },
            global: { headers: { Authorization: ctx.request.headers.get('Authorization')! } }
        }
    )
    ctx.state.activityId = crypto.randomUUID()
    await next()
})

const router = new Router()

router
    .post('/background/log_images', async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const user_id = ctx.state.userId
        const entries = body_json.product_images.map((image: any) => {
            return {
                user_id: user_id,
                client_activity_id: body_json.client_activity_id,
                activity_id: body_json.activity_id,
                image_file_hash: image.imageFileHash,
                image_ocrtext_ios: image.imageOCRText,
                barcode_ios: image.barcode
            }
        })
        const result = await ctx.state.supabaseClient
            .from('log_images')
            .insert(entries)
        if (result.error) {
            console.log('supabaseClient.from(log_images).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }
        ctx.response.status = 201
    })
    .post('/background/log_inventory', async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const user_id = ctx.state.userId
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
    .post('/background/log_llmcalls', async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const user_id = ctx.state.userId
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
    .post('/background/log_analyzebarcode', async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const result = await ctx.state.supabaseClient
            .from('log_analyzebarcode')
            .insert({
                user_id: ctx.state.userId,
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
    .post('/background/log_extract', async (ctx) => {
        const body = ctx.request.body({ type: 'json', limit: 0 })
        const body_json = await body.value
        const result = await ctx.state.supabaseClient
            .from('log_extract')
            .insert({
                user_id: ctx.state.userId,
                ...body_json
            })
        if (result.error) {
            console.log('supabaseClient.from(log_extract).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }
        ctx.response.status = 201
    })

app.use(router.routes())
app.use(router.allowedMethods())

await app.listen({ port: 8000 })