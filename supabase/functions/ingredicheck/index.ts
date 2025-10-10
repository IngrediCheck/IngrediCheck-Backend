import { Application, Router, Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
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
const supabaseServiceUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabaseServiceClient = supabaseServiceUrl && supabaseServiceRoleKey
    ? createClient(supabaseServiceUrl, supabaseServiceRoleKey)
    : null

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

type CapturedBody =
    | { type: 'json'; payload: unknown }
    | { type: 'form-data'; payload: { fields: Record<string, unknown>; files: Array<Record<string, unknown>> } }
    | { type: 'text'; payload: string }
    | { type: 'bytes'; payload: string }
    | { type: 'empty'; payload: null }

function toBase64(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary)
}

function captureRequestBody(ctx: Context, container: { body: CapturedBody | null }) {
    if (ctx.state.__recordingBodyPatched) {
        return
    }

    ctx.state.__recordingBodyPatched = true
    const originalBody = ctx.request.body.bind(ctx.request)

    ctx.request.body = (...args: unknown[]) => {
        const body = originalBody(...args)

        switch (body.type) {
            case 'json': {
                const valuePromise = Promise.resolve(body.value)
                body.value = valuePromise.then((value: unknown) => {
                    container.body = { type: 'json', payload: value }
                    return value
                })
                break
            }
            case 'form-data': {
                const reader = body.value
                if (reader?.read) {
                    const originalRead = reader.read.bind(reader)
                    reader.read = async (...readArgs: unknown[]) => {
                        const result = await originalRead(...readArgs)
                        const files = (result.files ?? []).map((file: Record<string, unknown>) => {
                            const content = file?.content
                            const normalized = { ...file }
                            if (content instanceof Uint8Array) {
                                normalized.content = toBase64(content)
                            }
                            return normalized
                        })
                        container.body = {
                            type: 'form-data',
                            payload: {
                                fields: result.fields ?? {},
                                files
                            }
                        }
                        return result
                    }
                }
                break
            }
            case 'text': {
                const valuePromise = Promise.resolve(body.value)
                body.value = valuePromise.then((value: string) => {
                    container.body = { type: 'text', payload: value }
                    return value
                })
                break
            }
            case 'bytes': {
                const valuePromise = Promise.resolve(body.value)
                body.value = valuePromise.then((value: Uint8Array) => {
                    container.body = { type: 'bytes', payload: toBase64(value) }
                    return value
                })
                break
            }
            default:
                container.body = { type: 'empty', payload: null }
                break
        }

        return body
    }
}

function serializeResponseBody(body: unknown): unknown {
    if (body === undefined || body === null) return body
    if (body instanceof Uint8Array) {
        return { type: 'bytes', value: toBase64(body) }
    }
    if (typeof body === 'string') {
        return body  // Don't wrap strings - return them directly
    }
    try {
        return JSON.parse(JSON.stringify(body))
    } catch (_error) {
        return String(body)
    }
}

app.use(async (ctx, next) => {
    const recordingUserId = Deno.env.get('RECORDING_USER_ID') ?? ''
    const recordingSessionId = Deno.env.get('RECORDING_SESSION_ID') ?? ''
    const shouldCapture = Boolean(recordingUserId && recordingSessionId && supabaseServiceClient)

    if (!shouldCapture) {
        return next()
    }

    let userId: string | null = null
    try {
        userId = await KitchenSink.getUserId(ctx)
    } catch (_error) {
        userId = null
    }

    if (userId !== recordingUserId) {
        return next()
    }

    const bodyContainer: { body: CapturedBody | null } = { body: null }

    captureRequestBody(ctx, bodyContainer)

    await next()

    const responseBody = serializeResponseBody(ctx.response.body)
    const requestBodyPayload = bodyContainer.body ?? { type: 'empty', payload: null }

    try {
        await supabaseServiceClient.from('recorded_sessions').insert({
            recording_session_id: recordingSessionId,
            user_id: userId,
            request_method: ctx.request.method,
            request_path: ctx.request.url.pathname,
            request_body: {
                type: requestBodyPayload.type,
                payload: requestBodyPayload.payload,
                search: Object.fromEntries(ctx.request.url.searchParams.entries())
            },
            response_status: ctx.response.status,
            response_body: responseBody
        })
    } catch (error) {
        console.error('Failed to insert recorded session entry', error)
    }
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
