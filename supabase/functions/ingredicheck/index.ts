import { Application, Router } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { createClient } from '@supabase/supabase-js'
import * as Analyzer from './analyzer.ts'
import * as Extractor from './extractor.ts'
import * as Inventory from './inventory.ts'
import * as Feedback from './feedback.ts'

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
    .get('/ingredicheck/inventory/:barcode', async (ctx) => {
        const clientActivityId = ctx.request.headers.get('clientActivityId')
        await Inventory.get(ctx, ctx.params.barcode, clientActivityId)
    })
    .post('/ingredicheck/analyze', async (ctx) => {
        await Analyzer.analyze(ctx)
    })
    .post('/ingredicheck/extract', async (ctx) => {
        await Extractor.extract(ctx)
    })
    .post('/ingredicheck/feedback', async (ctx) => {
        await Feedback.submitFeedback(ctx)
    })

app.use(router.routes())
app.use(router.allowedMethods())

await app.listen({ port: 8000 })