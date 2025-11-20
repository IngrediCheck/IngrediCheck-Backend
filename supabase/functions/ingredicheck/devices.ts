import { Context } from 'oak'
import type { SupabaseClient } from '@supabase/supabase-js'

type JsonRecord = Record<string, unknown>

type DeviceRegisterPayload = {
    deviceId?: string
    platform?: string
    osVersion?: string
    appVersion?: string
}

type ParamContext = Context & { params?: Record<string, string> }

type DeviceRow = {
    device_id: string
    metadata: JsonRecord | null
}

type RpcRegisterResult = DeviceRow | null

function ensureServiceClient(client: SupabaseClient | null): asserts client is SupabaseClient {
    if (!client) {
        throw new Error('Supabase service role client is not configured')
    }
}

function respondWithError(ctx: Context, status: number, message: string): void {
    ctx.response.status = status
    ctx.response.body = { error: message }
}

async function readJsonBody<T>(ctx: Context): Promise<T | null> {
    if (!ctx.request.hasBody) {
        return null
    }
    const body = ctx.request.body({ type: 'json' })
    try {
        return await body.value
    } catch (_error) {
        return null
    }
}

function isValidUuid(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false
    }
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
    return uuidRegex.test(value)
}

async function markUserAsInternal(serviceClient: SupabaseClient, userId: string) {
    const { error } = await serviceClient.rpc('user_set_internal', { _user_id: userId })
    if (error) {
        throw new Error(`Failed to mark user ${userId} internal: ${error.message}`)
    }
}

async function isUserMarkedInternal(ctx: Context, serviceClient: SupabaseClient, userId: string): Promise<boolean> {
    if (!ctx.state.__deviceUserInternalCache) {
        ctx.state.__deviceUserInternalCache = new Map<string, boolean>()
    }
    const cache: Map<string, boolean> = ctx.state.__deviceUserInternalCache
    if (cache.has(userId)) {
        return cache.get(userId) ?? false
    }
    const { data, error } = await serviceClient.rpc('user_is_internal', { _user_id: userId })
    if (error) {
        throw new Error(`Failed to check user internal status: ${error.message}`)
    }
    const result = Boolean(data === true)
    cache.set(userId, result)
    return result
}

async function markDeviceInternalInternal(
    serviceClient: SupabaseClient,
    deviceId: string
): Promise<string[]> {
    const { data, error } = await serviceClient.rpc('device_set_internal', { _device_id: deviceId })
    if (error) {
        throw new Error(`device_set_internal failed: ${error.message}`)
    }

    const userIds = Array.isArray(data) ? data.filter((value): value is string => typeof value === 'string') : []
    return [...new Set(userIds)]
}

async function ensureDeviceExists(serviceClient: SupabaseClient, deviceId: string): Promise<boolean> {
    const { data, error } = await serviceClient
        .from('devices')
        .select('device_id')
        .eq('device_id', deviceId)
        .maybeSingle()
    if (error) {
        throw new Error(`Failed to check device existence: ${error.message}`)
    }
    return Boolean(data)
}

export async function registerDevice(ctx: Context, serviceClient: SupabaseClient | null) {
    try {
        ensureServiceClient(serviceClient)
    } catch (error) {
        respondWithError(ctx, 500, error instanceof Error ? error.message : 'Service unavailable')
        return
    }

    const userId = ctx.state.userId
    if (typeof userId !== 'string' || userId.length === 0) {
        respondWithError(ctx, 401, 'Unauthorized')
        return
    }

    const payload = await readJsonBody<DeviceRegisterPayload>(ctx)
    if (!payload) {
        respondWithError(ctx, 400, 'Invalid JSON payload')
        return
    }

    const { deviceId, platform, osVersion, appVersion } = payload
    if (!isValidUuid(deviceId)) {
        respondWithError(ctx, 400, 'deviceId must be a UUID string')
        return
    }

    try {
        const rpcResult = await serviceClient.rpc('device_register', {
            _device_id: deviceId,
            _user_id: userId,
            _platform: platform ?? null,
            _os_version: osVersion ?? null,
            _app_version: appVersion ?? null
        })

        if (rpcResult.error) {
            throw new Error(`device_register failed: ${rpcResult.error.message}`)
        }

        const deviceRow = rpcResult.data as RpcRegisterResult
        const deviceMetadata = (deviceRow?.metadata ?? {}) as JsonRecord
        let deviceIsInternal = deviceMetadata?.is_internal === true

        let userIsInternal = await isUserMarkedInternal(ctx, serviceClient, userId)

        if (userIsInternal && !deviceIsInternal) {
            const userIds = await markDeviceInternalInternal(serviceClient, deviceId)
            for (const id of userIds) {
                await markUserAsInternal(serviceClient, id)
                ctx.state.__deviceUserInternalCache?.set(id, true)
            }
            deviceIsInternal = true
        } else if (!userIsInternal && deviceIsInternal) {
            await markUserAsInternal(serviceClient, userId)
            ctx.state.__deviceUserInternalCache?.set(userId, true)
            userIsInternal = true
        }

        ctx.response.status = 200
        ctx.response.body = { is_internal: deviceIsInternal }
    } catch (error) {
        console.error('Device registration failed', error)
        const detail = error instanceof Error ? error.message : String(error)
        ctx.response.status = 500
        ctx.response.body = { error: 'Failed to register device', detail }
    }
}

export async function markDeviceInternal(ctx: Context, serviceClient: SupabaseClient | null) {
    try {
        ensureServiceClient(serviceClient)
    } catch (error) {
        respondWithError(ctx, 500, error instanceof Error ? error.message : 'Service unavailable')
        return
    }

    const userId = ctx.state.userId
    if (typeof userId !== 'string' || userId.length === 0) {
        respondWithError(ctx, 401, 'Unauthorized')
        return
    }

    const payload = await readJsonBody<{ deviceId?: string }>(ctx)
    if (!payload) {
        respondWithError(ctx, 400, 'Invalid JSON payload')
        return
    }

    const { deviceId } = payload
    if (!isValidUuid(deviceId)) {
        respondWithError(ctx, 400, 'deviceId must be a UUID string')
        return
    }

    try {
        const exists = await ensureDeviceExists(serviceClient, deviceId)
        if (!exists) {
            respondWithError(ctx, 404, 'Device not registered')
            return
        }

        const { data: ownership, error: ownershipError } = await serviceClient
            .from('device_user_logins')
            .select('device_id')
            .eq('device_id', deviceId)
            .eq('user_id', userId)
            .maybeSingle()
        if (ownershipError) {
            throw new Error(`Failed to verify device ownership: ${ownershipError.message}`)
        }
        if (!ownership) {
            respondWithError(ctx, 403, 'Device does not belong to the authenticated user')
            return
        }

        const propagationTargets = await markDeviceInternalInternal(serviceClient, deviceId)
        for (const targetUserId of propagationTargets) {
            await markUserAsInternal(serviceClient, targetUserId)
            ctx.state.__deviceUserInternalCache?.set(targetUserId, true)
        }
        await markUserAsInternal(serviceClient, userId)
        ctx.state.__deviceUserInternalCache?.set(userId, true)

        ctx.response.status = 200
        ctx.response.body = {
            device_id: deviceId,
            affected_users: propagationTargets.length
        }
    } catch (error) {
        console.error('Mark device internal failed', error)
        const detail = error instanceof Error ? error.message : String(error)
        ctx.response.status = 500
        ctx.response.body = { error: 'Failed to mark device internal', detail }
    }
}

export async function getDeviceInternalStatus(ctx: Context, serviceClient: SupabaseClient | null) {
    try {
        ensureServiceClient(serviceClient)
    } catch (error) {
        respondWithError(ctx, 500, error instanceof Error ? error.message : 'Service unavailable')
        return
    }

    const params = (ctx as ParamContext).params ?? {}
    const deviceId = params.deviceId
    if (!isValidUuid(deviceId)) {
        respondWithError(ctx, 400, 'deviceId must be a UUID string')
        return
    }

    try {
        const { data, error } = await serviceClient.rpc('device_is_internal', { _device_id: deviceId })
        if (error) {
            throw new Error(`device_is_internal failed: ${error.message}`)
        }
        const isInternal = Boolean(data === true)
        ctx.response.status = 200
        ctx.response.body = { is_internal: isInternal }
    } catch (error) {
        console.error('Check device internal failed', error)
        const detail = error instanceof Error ? error.message : String(error)
        ctx.response.status = 500
        ctx.response.body = { error: 'Failed to fetch device status', detail }
    }
}
