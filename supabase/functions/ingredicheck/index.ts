import { Application, Router, Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { createClient } from '@supabase/supabase-js'
import * as Analyzer from './analyzer.ts'
import * as AnalyzerV2 from './analyzerv2.ts'
import * as Extractor from './extractor.ts'
import * as Inventory from './inventory.ts'
import * as Feedback from './feedback.ts'
import * as History from './history.ts'
import * as Lists from './lists.ts'
import * as PreferenceList from './preferencelist.ts'
import { registerMemojiRoutes } from './memoji.ts'
import { decodeUserIdFromRequest } from '../shared/auth.ts'
import { registerFamilyRoutes } from './family.ts'
import * as Devices from './devices.ts'
import * as Scan from './scan.ts'

const app = new Application()
const supabaseServiceUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabaseServiceClient = supabaseServiceUrl && supabaseServiceRoleKey
    ? createClient(supabaseServiceUrl, supabaseServiceRoleKey)
    : null

app.use(async (ctx, next) => {
    try {
        await decodeUserIdFromRequest(ctx)
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unauthorized'
        ctx.response.status = 401
        // Return full error detail for debugging auth issues
        ctx.response.body = { error: detail }
        return
    }

    // Lazy client creation - only creates when first accessed
    let _supabaseClient: ReturnType<typeof createClient> | null = null
    Object.defineProperty(ctx.state, 'supabaseClient', {
        get() {
            if (!_supabaseClient) {
                _supabaseClient = createClient(
                    Deno.env.get('SUPABASE_URL') ?? '',
                    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                    {
                        auth: { persistSession: false },
                        global: { headers: { Authorization: ctx.request.headers.get('Authorization')! } }
                    }
                )
            }
            return _supabaseClient
        },
        configurable: true
    })
    ctx.state.activityId = crypto.randomUUID()
    await next()
})

type CapturedBody =
    | { type: 'json'; payload: unknown }
    | { type: 'form-data'; payload: { fields: Record<string, unknown>; files: Array<Record<string, unknown>> } }
    | { type: 'text'; payload: string }
    | { type: 'bytes'; payload: string }
    | { type: 'empty'; payload: null }
    | { type: 'sse'; payload: Array<{ event: string; data: unknown }> }

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

type CapturedSseEvent = { event: string; data: unknown }

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
    return value instanceof ReadableStream
}

function extractSseEventsFromBuffer(buffer: string, events: CapturedSseEvent[]): string {
    let working = buffer

    while (true) {
        const separatorIndex = working.indexOf('\n\n')
        if (separatorIndex === -1) {
            break
        }

        const rawBlock = working.slice(0, separatorIndex)
        working = working.slice(separatorIndex + 2)

        const normalized = rawBlock.replace(/\r/g, '')
        if (!normalized.trim()) {
            continue
        }

        const lines = normalized.split('\n')
        let eventName = 'message'
        const dataLines: string[] = []

        for (const line of lines) {
            if (!line) continue
            const colonIndex = line.indexOf(':')
            const field = colonIndex === -1 ? line : line.slice(0, colonIndex)
            const value = colonIndex === -1 ? '' : line.slice(colonIndex + 1).replace(/^\s*/, '')

            switch (field.trim()) {
                case 'event':
                    if (value.length > 0) {
                        eventName = value
                    }
                    break
                case 'data':
                    dataLines.push(value)
                    break
                default:
                    break
            }
        }

        const rawData = dataLines.join('\n')
        let parsed: unknown = rawData
        if (rawData.length === 0) {
            parsed = null
        } else {
            try {
                parsed = JSON.parse(rawData)
            } catch (_error) {
                parsed = rawData
            }
        }

        events.push({ event: eventName, data: parsed })
    }

    return working
}

async function collectSseEvents(stream: ReadableStream<Uint8Array>): Promise<CapturedSseEvent[]> {
    const events: CapturedSseEvent[] = []
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }
        buffer += decoder.decode(value, { stream: true })
        buffer = extractSseEventsFromBuffer(buffer, events)
    }

    buffer += decoder.decode()
    extractSseEventsFromBuffer(buffer, events)

    return events
}

app.use(async (ctx, next) => {
    const recordingUserId = Deno.env.get('RECORDING_USER_ID') ?? ''
    const recordingSessionId = Deno.env.get('RECORDING_SESSION_ID') ?? ''
    const shouldCapture = Boolean(recordingUserId && recordingSessionId && supabaseServiceClient)

    if (!shouldCapture) {
        return next()
    }

    const userId = typeof ctx.state.userId === 'string' ? ctx.state.userId : null

    if (userId !== recordingUserId) {
        return next()
    }

    const bodyContainer: { body: CapturedBody | null } = { body: null }

    captureRequestBody(ctx, bodyContainer)

    await next()

    let responseBody: unknown
    const contentType = ctx.response.headers.get('Content-Type') ?? ctx.response.headers.get('content-type') ?? ''
    const shouldCaptureSse = contentType.toLowerCase().includes('text/event-stream') && isReadableStream(ctx.response.body)

    if (shouldCaptureSse) {
        const originalStream = ctx.response.body as ReadableStream<Uint8Array>
        const [clientStream, captureStream] = originalStream.tee()
        ctx.response.body = clientStream
        try {
            const events = await collectSseEvents(captureStream)
            responseBody = { type: 'sse', payload: events }
        } catch (error) {
            console.error('Failed to collect SSE events for recording', error)
            responseBody = { type: 'sse', payload: [] }
        }
    } else {
        responseBody = serializeResponseBody(ctx.response.body)
    }

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

registerFamilyRoutes(router)
registerMemojiRoutes(router, supabaseServiceClient)

router
    .get('/ingredicheck/ping', (ctx) => {
        ctx.response.status = 204
    })
    .post('/ingredicheck/devices/register', async (ctx) => {
        await Devices.registerDevice(ctx, supabaseServiceClient)
    })
    .post('/ingredicheck/devices/mark-internal', async (ctx) => {
        await Devices.markDeviceInternal(ctx, supabaseServiceClient)
    })
    .get('/ingredicheck/devices/:deviceId/is-internal', async (ctx) => {
        await Devices.getDeviceInternalStatus(ctx, supabaseServiceClient)
    })
    .post('/ingredicheck/deleteme', async (ctx) => {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        )
        const userId = ctx.state.userId as string
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
    // @deprecated - Use POST /ingredicheck/v2/scan/barcode instead (see inventory.ts)
    .get('/ingredicheck/inventory/:barcode', async (ctx) => {
        const clientActivityId = ctx.request.url.searchParams.get("clientActivityId")
        await Inventory.get(ctx, ctx.params.barcode, clientActivityId)
    })
    // @deprecated - Use GET /ingredicheck/v2/scan/history instead (see history.ts)
    .get('/ingredicheck/history', async (ctx) => {
        const searchText = ctx.request.url.searchParams.get("searchText")
        await History.get(ctx, searchText)
    })
    // v1 Scan API (deprecated - use v2 below)
    .get('/ingredicheck/scan/history', async (ctx) => {
        await Scan.getHistory(ctx)
    })
    // v2 Scan API endpoints (preferred)
    .get('/ingredicheck/v2/scan/history', async (ctx) => {
        await Scan.getHistoryV2(ctx)
    })
    .get('/ingredicheck/v2/scan/:scanId', async (ctx) => {
        await Scan.getScanDetail(ctx)
    })
    .patch('/ingredicheck/v2/scan/:scanId/favorite', async (ctx) => {
        await Scan.toggleFavorite(ctx)
    })
    .post('/ingredicheck/v2/scan/:scanId/reanalyze', async (ctx) => {
        await Scan.reanalyze(ctx)
    })
    .post('/ingredicheck/v2/scan/:scanId/image', async (ctx) => {
        await Scan.uploadImage(ctx)
    })
    .post('/ingredicheck/v2/scan/feedback', async (ctx) => {
        await Feedback.submitScanFeedback(ctx)
    })
    // @deprecated - Use POST /ingredicheck/v2/scan/barcode instead (see analyzer.ts)
    .post('/ingredicheck/analyze', async (ctx) => {
        await Analyzer.analyze(ctx)
    })
    // @deprecated - Use POST /ingredicheck/v2/scan/barcode or /v2/scan/{id}/image instead (see analyzerv2.ts)
    .post('/ingredicheck/analyze-stream', async (ctx) => {
        await AnalyzerV2.analyzeV2(ctx)
    })
    // @deprecated - Use POST /ingredicheck/v2/scan/{id}/image instead (see extractor.ts)
    .post('/ingredicheck/extract', async (ctx) => {
        await Extractor.extract(ctx)
    })
    // @deprecated - Use POST /ingredicheck/v2/scan/feedback instead (see feedback.ts)
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
