#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read

import { basename, resolve as resolvePath } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { parse } from 'https://deno.land/std@0.224.0/flags/mod.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

type RecordingArtifact = {
    recordingSessionId: string
    recordedUserId: string
    exportedAt: string
    totalEntries: number
    variables?: Record<string, string>
    requests: RecordedRequest[]
}

type RecordedRequest = {
    recordedAt: string
    request: {
        method: string
        path: string
        query: Record<string, string>
        bodyType: 'json' | 'form-data' | 'text' | 'bytes' | 'empty'
        body: unknown
    }
    response: {
        status: number
        body: unknown
    }
}

type RuntimeConfig = {
    sessionPath: string
    baseUrl: string
    anonKey: string
    email: string
    password: string
    stopOnFailure: boolean
}

type ReplayStats = {
    total: number
    passed: number
    failed: number
}

type PlaceholderValue = {
    raw: unknown
    text: string
}

type PlaceholderStore = Map<string, PlaceholderValue>

const PLACEHOLDER_REGEXP = /\{\{var:([A-Z0-9_:-]+)\}\}/g

function loadConfig(): RuntimeConfig {
    const args = parse(Deno.args, {
        string: ['session', 'base-url', 'anon-key', 'email', 'password'],
        boolean: ['stop-on-failure'],
        default: { 'stop-on-failure': false }
    })

    const sessionPath = (args.session ?? args._[0]) as string | undefined
    if (!sessionPath) {
        console.error('Error: --session <path> (or positional path) is required.')
        Deno.exit(1)
    }

    const baseUrl = (args['base-url'] as string | undefined) ?? Deno.env.get('REGRESSION_BASE_URL') ?? 'https://wqidjkpfdrvomfkmefqc.supabase.co'
    const anonKey = (args['anon-key'] as string | undefined) ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const email = (args.email as string | undefined) ?? Deno.env.get('REGRESSION_EMAIL') ?? ''
    const password = (args.password as string | undefined) ?? Deno.env.get('REGRESSION_PASSWORD') ?? ''

    const missing: string[] = []
    if (!anonKey) missing.push('--anon-key or SUPABASE_ANON_KEY')
    if (!email) missing.push('--email or REGRESSION_EMAIL')
    if (!password) missing.push('--password or REGRESSION_PASSWORD')
    if (missing.length > 0) {
        console.error(`Error: Missing required configuration: ${missing.join(', ')}`)
        Deno.exit(1)
    }

    return {
        sessionPath: resolvePath(sessionPath),
        baseUrl,
        anonKey,
        email,
        password,
        stopOnFailure: Boolean(args['stop-on-failure'])
    }
}

async function signIn(baseUrl: string, anonKey: string, email: string, password: string): Promise<{ client: SupabaseClient; accessToken: string; userId: string }> {
    const client = createClient(baseUrl, anonKey, { auth: { persistSession: false } })
    const result = await client.auth.signInWithPassword({ email, password })
    if (result.error || !result.data.session) {
        console.error('Error: failed to sign in regression user:', result.error?.message ?? 'unknown error')
        Deno.exit(1)
    }
    return {
        client,
        accessToken: result.data.session.access_token,
        userId: result.data.user?.id ?? ''
    }
}

async function loadArtifact(path: string): Promise<RecordingArtifact> {
    const contents = await Deno.readTextFile(path)
    const artifact = JSON.parse(contents) as RecordingArtifact
    if (!artifact.requests || !Array.isArray(artifact.requests)) {
        console.error('Error: recording artifact is missing requests array.')
        Deno.exit(1)
    }
    return artifact
}

function requireVariable(name: string, variables: PlaceholderStore): PlaceholderValue {
    const record = variables.get(name)
    if (!record) {
        throw new Error(`Missing value for placeholder {{var:${name}}}`)
    }
    return record
}

function resolvePlaceholdersInString(value: string, variables: PlaceholderStore): string {
    return value.replace(PLACEHOLDER_REGEXP, (_match, name: string) => requireVariable(name, variables).text)
}

function resolveJsonValue(value: unknown, variables: PlaceholderStore): unknown {
    if (typeof value === 'string') {
        const match = value.match(/^\{\{var:([A-Z0-9_:-]+)\}\}$/)
        if (match) {
            return requireVariable(match[1], variables).raw ?? requireVariable(match[1], variables).text
        }
        return value
    }
    if (Array.isArray(value)) {
        return value.map((entry) => resolveJsonValue(entry, variables))
    }
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(value)) {
            result[key] = resolveJsonValue(child, variables)
        }
        return result
    }
    return value
}

function resolvePlaceholdersInPath(path: string, variables: PlaceholderStore): string {
    if (!path.includes('{{')) return path
    return resolvePlaceholdersInString(path, variables)
}

function resolvePlaceholdersInQuery(query: Record<string, string>, variables: PlaceholderStore): URLSearchParams {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        params.append(key, resolvePlaceholdersInString(value, variables))
    }
    return params
}

function decodeBase64(value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

type BuiltRequestBody = {
    body?: BodyInit
    headers: HeadersInit
}

function resolveFormScalar(value: unknown, variables: PlaceholderStore): string {
    if (typeof value === 'string') {
        return resolvePlaceholdersInString(value, variables)
    }
    if (value === null || value === undefined) {
        return ''
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveFormScalar(item, variables)).join(',')
    }
    return String(value)
}

function buildRequestBody(entry: RecordedRequest, variables: PlaceholderStore): BuiltRequestBody {
    const headers: Record<string, string> = {}
    const { bodyType, body } = entry.request

    if (bodyType === 'empty' || body === null || body === undefined) {
        return { headers }
    }

    if (bodyType === 'json') {
        const resolved = resolveJsonValue(body, variables)
        headers['Content-Type'] = 'application/json'
        return { body: JSON.stringify(resolved), headers }
    }

    if (bodyType === 'text') {
        const resolved = resolveFormScalar(body, variables)
        headers['Content-Type'] = 'text/plain'
        return { body: String(resolved), headers }
    }

    if (bodyType === 'bytes') {
        if (typeof body !== 'string') {
            throw new Error('Expected base64 string for byte payload')
        }
        const resolved = resolvePlaceholdersInString(body, variables)
        return { body: decodeBase64(resolved), headers: { ...headers, 'Content-Type': 'application/octet-stream' } }
    }

    if (bodyType === 'form-data') {
        if (!body || typeof body !== 'object') {
            throw new Error('Expected object payload for form-data request')
        }
        const { fields = {}, files = [] } = body as { fields?: Record<string, unknown>; files?: Array<Record<string, unknown>> }
        const form = new FormData()

        for (const [key, raw] of Object.entries(fields)) {
            const resolved = resolveJsonValue(raw, variables)
            if (Array.isArray(resolved)) {
                for (const item of resolved) {
                    form.append(key, item == null ? '' : String(item))
                }
            } else {
                form.append(key, resolved == null ? '' : String(resolved))
            }
        }

        for (const descriptor of files ?? []) {
            const name = typeof descriptor.name === 'string' ? descriptor.name : 'file'
            const filename = typeof descriptor.filename === 'string' ? descriptor.filename : basename(name)
            const contentType = typeof descriptor.contentType === 'string' ? descriptor.contentType : (typeof descriptor.type === 'string' ? descriptor.type : 'application/octet-stream')
            const encodedContent = typeof descriptor.content === 'string' ? resolvePlaceholdersInString(descriptor.content, variables) : ''
            const bytes = decodeBase64(encodedContent)
            const blob = new Blob([bytes], { type: contentType })
            form.append(name, blob, filename)
        }

        return { body: form, headers }
    }

    throw new Error(`Unsupported body type: ${bodyType}`)
}

function coerceToString(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    return String(value)
}

function compareBodies(expected: unknown, actual: unknown, variables: PlaceholderStore, path: string, errors: string[]) {
    if (typeof expected === 'string') {
        const match = expected.match(/^\{\{var:([A-Z0-9_:-]+)\}\}$/)
        if (match) {
            const [, name] = match
            if (actual === undefined || actual === null) {
                errors.push(`${path}: expected value for placeholder {{var:${name}}} but received ${actual}`)
                return
            }
            const record: PlaceholderValue = { raw: actual, text: coerceToString(actual) }
            const existing = variables.get(name)
            if (existing && existing.text !== record.text) {
                errors.push(`${path}: placeholder {{var:${name}}} mismatch. Expected ${existing.text}, received ${record.text}`)
                return
            }
            variables.set(name, record)
            return
        }
    }

    if (expected === null || expected === undefined) {
        if (actual !== expected) {
            errors.push(`${path}: expected ${expected}, received ${actual}`)
        }
        return
    }

    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) {
            errors.push(`${path}: expected array, received ${typeof actual}`)
            return
        }
        if (expected.length !== actual.length) {
            errors.push(`${path}: array length mismatch. Expected ${expected.length}, received ${actual.length}`)
            return
        }
        expected.forEach((item, index) => {
            compareBodies(item, actual[index], variables, `${path}[${index}]`, errors)
        })
        return
    }

    if (typeof expected === 'object') {
        if (!actual || typeof actual !== 'object') {
            errors.push(`${path}: expected object, received ${typeof actual}`)
            return
        }
        for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
            const childPath = `${path}.${key}`
            compareBodies(value, (actual as Record<string, unknown>)[key], variables, childPath, errors)
        }
        return
    }

    if (expected !== actual) {
        errors.push(`${path}: expected ${expected}, received ${actual}`)
    }
}

async function replayRequest(entry: RecordedRequest, config: RuntimeConfig, tokens: { accessToken: string; anonKey: string }, variables: PlaceholderStore): Promise<{ ok: boolean; errors: string[]; response: Response; body: unknown }> {
    const resolvedPath = resolvePlaceholdersInPath(entry.request.path, variables)
    const queryParams = resolvePlaceholdersInQuery(entry.request.query ?? {}, variables)

    const url = new URL(resolvedPath.replace(/^\//, ''), config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`)
    queryParams.forEach((value, key) => {
        url.searchParams.append(key, value)
    })

    const { body, headers: bodyHeaders } = buildRequestBody(entry, variables)
    const headers = new Headers({
        ...bodyHeaders,
        Authorization: `Bearer ${tokens.accessToken}`,
        apikey: tokens.anonKey,
        Accept: 'application/json'
    })

    const response = await fetch(url.toString(), {
        method: entry.request.method,
        headers,
        body
    })

    const errors: string[] = []
    if (response.status !== entry.response.status) {
        errors.push(`status: expected ${entry.response.status}, received ${response.status}`)
    }

    let parsedBody: unknown = null
    if (response.status !== 204) {
        const contentType = response.headers.get('content-type') ?? ''
        const text = await response.text()
        if (!text) {
            parsedBody = null
        } else if (contentType.includes('application/json') || contentType.includes('+json')) {
            try {
                parsedBody = JSON.parse(text)
            } catch (_error) {
                errors.push('body: failed to parse JSON response')
                parsedBody = text
            }
        } else {
            parsedBody = text
        }
    }

    compareBodies(entry.response.body, parsedBody, variables, '$', errors)

    return { ok: errors.length === 0, errors, response, body: parsedBody }
}

async function run() {
    const config = loadConfig()
    const artifact = await loadArtifact(config.sessionPath)
    const { accessToken, userId } = await signIn(config.baseUrl, config.anonKey, config.email, config.password)

    if (artifact.recordedUserId && artifact.recordedUserId !== userId) {
        console.warn('Warning: replay user does not match recorded user. Recorded:', artifact.recordedUserId, 'Replay:', userId)
    }

    const runtimeVariables: PlaceholderStore = new Map<string, string>()

    const stats: ReplayStats = { total: artifact.requests.length, passed: 0, failed: 0 }

    console.log(`Replaying ${stats.total} requests from ${basename(config.sessionPath)} against ${config.baseUrl}`)

    for (let index = 0; index < artifact.requests.length; index += 1) {
        const step = artifact.requests[index]
        const label = `${index + 1}/${artifact.requests.length} ${step.request.method.toUpperCase()} ${step.request.path}`

        try {
            const result = await replayRequest(step, config, { accessToken, anonKey: config.anonKey }, runtimeVariables)
            if (result.ok) {
                stats.passed += 1
                console.log(`✅ ${label}`)
            } else {
                stats.failed += 1
                console.error(`❌ ${label}`)
                for (const message of result.errors) {
                    console.error(`   - ${message}`)
                }
                if (config.stopOnFailure) {
                    break
                }
            }
        } catch (error) {
            stats.failed += 1
            console.error(`❌ ${label}`)
            console.error(`   - Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
            if (config.stopOnFailure) {
                break
            }
        }
    }

    console.log(`Finished. Passed ${stats.passed}/${stats.total}, Failed ${stats.failed}/${stats.total}`)

    if (stats.failed > 0) {
        Deno.exit(1)
    }
}

if (import.meta.main) {
    await run()
}
