#!/usr/bin/env -S deno run --allow-run=supabase --allow-env --allow-read --allow-write

import { join } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { parse } from 'https://deno.land/std@0.224.0/flags/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

type RecordingRow = {
    recording_session_id: string
    user_id: string
    recorded_at: string
    request_method: string
    request_path: string
    request_headers: Record<string, string>
    request_body: { type: string; payload: unknown; search?: Record<string, string> } | null
    response_status: number
    response_headers: Record<string, string>
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

const args = parse(Deno.args, {
    string: ['user', 'session', 'feature', 'function', 'output'],
    boolean: ['function-scope', 'skip-unset'],
    default: { feature: 'adhoc', 'function-scope': false, 'skip-unset': false }
})

async function promptValue(message: string, fallback?: string): Promise<string> {
    const input = prompt(message, fallback ?? '')?.trim()
    if (!input) {
        console.error(`Aborted: ${message} is required.`)
        Deno.exit(1)
    }
    return input
}

function resolveOptions(): CaptureOptions {
    const userId = args.user ?? promptValue('Enter the user id to record')
    const sessionTag = args.session ?? promptValue('Enter a unique recording session id')
    const feature = args.feature ?? 'adhoc'
    const functionName = args.function
    const scope = args['function-scope'] ? 'function' as const : 'project' as const
    const outputDir = args.output ?? join('supabase', 'tests', 'recordings', feature, sessionTag)
    const skipUnset = Boolean(args['skip-unset'])

    return {
        userId,
        sessionTag,
        feature,
        functionName,
        scope,
        outputDir,
        skipUnset
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
    if (options.skipUnset) {
        console.log('Skipping secret cleanup (per --skip-unset). Remember to clear them manually.')
        return
    }
    const baseArgs =
        options.scope === 'function'
            ? ['supabase', 'functions', 'secrets', 'unset', 'RECORDING_USER_ID', 'RECORDING_SESSION_ID', '--function', options.functionName ?? 'ingredicheck']
            : ['supabase', 'secrets', 'unset', 'RECORDING_USER_ID', 'RECORDING_SESSION_ID']
    await runCommand('Clearing recording secrets', baseArgs)
}

function getSupabaseClient() {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) {
        console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.')
        Deno.exit(1)
    }
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

function buildArtifact(options: CaptureOptions, rows: RecordingRow[]) {
    return {
        recordingSessionId: options.sessionTag,
        recordedUserId: options.userId,
        exportedAt: new Date().toISOString(),
        totalEntries: rows.length,
        requests: rows.map((row) => ({
            recordedAt: row.recorded_at,
            request: {
                method: row.request_method,
                path: row.request_path,
                headers: row.request_headers ?? {},
                query: row.request_body?.search ?? {},
                bodyType: row.request_body?.type ?? 'empty',
                body: row.request_body?.payload ?? null
            },
            response: {
                status: row.response_status,
                headers: row.response_headers ?? {},
                body: row.response_body
            }
        }))
    }
}

async function writeArtifact(options: CaptureOptions, artifact: unknown) {
    await Deno.mkdir(options.outputDir, { recursive: true })
    const filePath = join(options.outputDir, 'session.json')
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
