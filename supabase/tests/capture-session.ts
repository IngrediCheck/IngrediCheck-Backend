#!/usr/bin/env -S deno run --allow-run=supabase --allow-env --allow-read --allow-write --allow-net

import { join, dirname, fromFileUrl } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

type RecordingRow = {
    recording_session_id: string
    user_id: string
    recorded_at: string
    request_method: string
    request_path: string
    request_body: { type: string; payload: unknown; search?: Record<string, string> } | null
    response_status: number
    response_body: unknown
}

type CaptureOptions = {
    userId: string
    sessionTag: string
    feature: string
    functionName?: string
    scope: 'project' | 'function'
    outputDir: string
    skipUnset: boolean
}

function promptValue(message: string, fallback?: string): string {
    const input = prompt(message, fallback ?? '')?.trim()
    if (!input) {
        console.error(`Aborted: ${message} is required.`)
        Deno.exit(1)
    }
    return input
}

function ensureEnvVar(name: string, promptMessage: string): string {
    const current = Deno.env.get(name)?.trim()
    if (current) {
        return current
    }
    const value = promptValue(promptMessage)
    Deno.env.set(name, value)
    return value
}

function slugify(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function resolveOptions(): CaptureOptions {
    const [userArg, ...descriptionParts] = Deno.args
    const userId = userArg?.trim() || promptValue('Enter the user id to record')
    const descriptionInput =
        descriptionParts.join(' ').trim() ||
        promptValue('Describe the scenario being recorded (natural language)')

    const now = new Date()
    const datePart = now.toISOString().slice(0, 10)
    const timePart = now.toISOString().slice(11, 16).replace(':', '')
    const sessionTag = slugify(`${datePart}-${timePart}-${descriptionInput}`)
    const feature = slugify(descriptionInput) || 'adhoc'
    const scriptDir = dirname(fromFileUrl(import.meta.url))
    const outputDir = join(scriptDir, 'recordings', feature, sessionTag)

    return {
        userId,
        sessionTag,
        feature,
        functionName: undefined,
        scope: 'project',
        outputDir,
        skipUnset: false
    }
}

async function runCommand(description: string, command: string[], opts: { cwd?: string } = {}) {
    console.log(`$ ${command.join(' ')}`)
    const proc = new Deno.Command(command[0], {
        args: command.slice(1),
        cwd: opts.cwd ?? Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped'
    })
    const { code, stdout, stderr } = await proc.output()
    if (code !== 0) {
        console.error(`${description} failed`)
        console.error(new TextDecoder().decode(stderr))
        Deno.exit(code)
    }
    if (stdout.length) {
        console.log(new TextDecoder().decode(stdout))
    }
}

async function setSecrets(options: CaptureOptions) {
    const { userId, sessionTag, scope, functionName } = options
    const baseArgs =
        scope === 'function'
            ? ['supabase', 'functions', 'secrets', 'set', `RECORDING_USER_ID=${userId}`, `RECORDING_SESSION_ID=${sessionTag}`, '--function', functionName ?? 'ingredicheck']
            : ['supabase', 'secrets', 'set', `RECORDING_USER_ID=${userId}`, `RECORDING_SESSION_ID=${sessionTag}`]
    await runCommand('Setting recording secrets', baseArgs)
}

async function unsetSecrets(options: CaptureOptions) {
    const baseArgs =
        options.scope === 'function'
            ? ['supabase', 'functions', 'secrets', 'unset', 'RECORDING_USER_ID', 'RECORDING_SESSION_ID', '--function', options.functionName ?? 'ingredicheck']
            : ['supabase', 'secrets', 'unset', 'RECORDING_USER_ID', 'RECORDING_SESSION_ID']
    await runCommand('Clearing recording secrets', baseArgs)
}

function getSupabaseClient() {
    const url = ensureEnvVar('SUPABASE_BASE_URL', 'Enter SUPABASE_BASE_URL (starts with https://...)')
    const serviceKey = ensureEnvVar('SUPABASE_SERVICE_ROLE_KEY', 'Enter SUPABASE_SERVICE_ROLE_KEY')
    return createClient(url, serviceKey, { auth: { persistSession: false } })
}

async function fetchRecordingRows(sessionTag: string): Promise<RecordingRow[]> {
    const client = getSupabaseClient()
    const { data, error } = await client
        .from<RecordingRow>('recorded_sessions')
        .select()
        .eq('recording_session_id', sessionTag)
        .order('recorded_at', { ascending: true })

    if (error) {
        console.error('Failed to fetch recorded session entries:', error)
        Deno.exit(1)
    }
    return data ?? []
}

type RecordingArtifact = {
    recordingSessionId: string
    recordedUserId: string
    exportedAt: string
    totalEntries: number
    variables?: Record<string, string>
    requests: Array<{
        recordedAt: string
        request: {
            method: string
            path: string
            query: Record<string, string>
            bodyType: string
            body: unknown
        }
        response: {
            status: number
            body: unknown
        }
    }>
}

function buildArtifact(options: CaptureOptions, rows: RecordingRow[]): RecordingArtifact {
    const artifact: RecordingArtifact = {
        recordingSessionId: options.sessionTag,
        recordedUserId: options.userId,
        exportedAt: new Date().toISOString(),
        totalEntries: rows.length,
        requests: rows.map((row) => ({
            recordedAt: row.recorded_at,
            request: {
                method: row.request_method,
                path: row.request_path,
                query: row.request_body?.search ?? {},
                bodyType: row.request_body?.type ?? 'empty',
                body: row.request_body?.payload ?? null
            },
            response: {
                status: row.response_status,
                body: row.response_body
            }
        }))
    }

    injectVariablePlaceholders(artifact)

    return artifact
}

function injectVariablePlaceholders(artifact: RecordingArtifact) {
    const idMap = new Map<string, string>()
    const counter = { value: 1 }

    for (const entry of artifact.requests) {
        collectIds(entry.request.body, idMap, counter)
        collectIds(entry.response.body, idMap, counter)
    }

    if (idMap.size === 0) {
        return
    }

    for (const entry of artifact.requests) {
        entry.request.path = replacePathSegments(entry.request.path, idMap)
        entry.request.query = applyPlaceholders(entry.request.query, idMap) as Record<string, string>
        entry.request.body = applyPlaceholders(entry.request.body, idMap)
        entry.response.body = applyPlaceholders(entry.response.body, idMap)
    }

    artifact.variables = Object.fromEntries(
        Array.from(idMap.entries()).map(([value, token]) => [token, value])
    )
}

function collectIds(node: unknown, map: Map<string, string>, counter: { value: number }) {
    if (Array.isArray(node)) {
        for (const item of node) {
            collectIds(item, map, counter)
        }
        return
    }

    if (!isPlainObject(node)) {
        return
    }

    for (const [key, value] of Object.entries(node)) {
        if (key.toLowerCase() === 'id' && (typeof value === 'string' || typeof value === 'number')) {
            const idValue = String(value)
            if (!map.has(idValue)) {
                const token = `ID_${String(counter.value).padStart(3, '0')}`
                map.set(idValue, token)
                counter.value += 1
            }
        }
        collectIds(value, map, counter)
    }
}

function applyPlaceholders(node: unknown, map: Map<string, string>): unknown {
    if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
            node[index] = applyPlaceholders(node[index], map)
        }
        return node
    }

    if (isPlainObject(node)) {
        const record = node as Record<string, unknown>
        for (const [key, value] of Object.entries(record)) {
            if (key === 'path' && typeof value === 'string') {
                record[key] = replacePathSegments(value, map)
                continue
            }
            record[key] = applyPlaceholders(value, map)
        }
        return record
    }

    if (typeof node === 'string' || typeof node === 'number') {
        const token = map.get(String(node))
        if (token) {
            return `{{var:${token}}}`
        }
    }

    return node
}

function replacePathSegments(path: string, map: Map<string, string>): string {
    return path
        .split('/')
        .map((segment) => {
            const token = map.get(segment)
            return token ? `{{var:${token}}}` : segment
        })
        .join('/')
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
async function writeArtifact(options: CaptureOptions, artifact: RecordingArtifact) {
    await Deno.mkdir(options.outputDir, { recursive: true })
    const filePath = join(options.outputDir, 'session.json')
    try {
        await Deno.remove(filePath)
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error
        }
    }
    await Deno.writeTextFile(filePath, JSON.stringify(artifact, null, 2))
    console.log(`Saved recording to ${filePath}`)
}

async function main() {
    const options = resolveOptions()
    await setSecrets(options)

    console.log('\nRecording started.')
    console.log('Perform the desired user actions now.')
    prompt('Press enter once the session should stop capturing...')

    const rows = await fetchRecordingRows(options.sessionTag)
    if (rows.length === 0) {
        console.warn('Warning: No entries captured for this session.')
    }

    const artifact = buildArtifact(options, rows)
    await writeArtifact(options, artifact)

    await unsetSecrets(options)
    console.log('Capture complete.')
}

if (import.meta.main) {
    await main()
}
