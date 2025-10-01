import { Application, Router } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { createClient } from '@supabase/supabase-js'
import * as KitchenSink from '../shared/kitchensink.ts'
import * as Analyzer from './analyzer.ts'
import * as Extractor from './extractor.ts'
import * as Inventory from './inventory.ts'
import * as Feedback from './feedback.ts'
import * as History from './history.ts'
import * as Lists from './lists.ts'
import * as PreferenceList from './preferencelist.ts'

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
    .post('/ingredicheck/deleteme', async (ctx) => {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        )
        const userId = await KitchenSink.getUserId(ctx)
        console.log('deleting user: ', userId)
        const result = await supabaseClient.auth.admin.deleteUser(
            userId,
            true
        )
        if (result.error) {
            console.log('supabaseClient.auth.admin.deleteUser() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }
        ctx.response.status = 204
    })
    .get('/ingredicheck/inventory/:barcode/analyze-stream', Analyzer.streamInventoryAndAnalysis)
    .get('/ingredicheck/inventory/:barcode', async (ctx) => {
        const clientActivityId = ctx.request.url.searchParams.get("clientActivityId")
        await Inventory.get(ctx, ctx.params.barcode, clientActivityId)
    })
    .get('/ingredicheck/history', async (ctx) => {
        const searchText = ctx.request.url.searchParams.get("searchText")
        await History.get(ctx, searchText)
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
    .delete('/ingredicheck/lists/:listId/:listItemId', async (ctx) => {
        await Lists.deleteListItem(ctx, ctx.params.listId, ctx.params.listItemId)
    })
    .delete('/ingredicheck/lists/:listId', async (ctx) => {
        await Lists.deleteList(ctx, ctx.params.listId)
    })
    .post('/ingredicheck/lists/:listId', async (ctx) => {
        await Lists.addListItem(ctx, ctx.params.listId)
    })
    .get('/ingredicheck/lists/:listId', async (ctx) => {
        const searchText = ctx.request.url.searchParams.get("searchText")
        await Lists.getListItems(ctx, ctx.params.listId, searchText)
    })
    .post('/ingredicheck/lists', async (ctx) => {
        await Lists.createList(ctx)
    })
    .get('/ingredicheck/lists', async (ctx) => {
        await Lists.getLists(ctx)
    })
    .get('/ingredicheck/preferencelists/default', async (ctx) => {
        await PreferenceList.getItems(ctx)
    })
    .post('/ingredicheck/preferencelists/default', async (ctx) => {
        await PreferenceList.addItem(ctx)
    })
    .put('/ingredicheck/preferencelists/default/:itemId', async (ctx) => {
        await PreferenceList.updateItem(ctx, +ctx.params.itemId)
    })
    .delete('/ingredicheck/preferencelists/default/:itemId', async (ctx) => {
        await PreferenceList.deleteItem(ctx, +ctx.params.itemId)
    })
    .post('/ingredicheck/preferencelists/grandfathered', async (ctx) => {
        await PreferenceList.grandfather(ctx)
    })

app.use(router.routes())
app.use(router.allowedMethods())

await app.listen({ port: 8000 })