import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

function parseAuthorizationHeader(ctx: Context): string | null {
    const authHeader = ctx.request.headers.get('authorization') ?? ''
    if (!authHeader) return null
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7)
    }
    return authHeader
}

export async function decodeUserIdFromRequest(ctx: Context): Promise<string> {
    if (ctx.state.userId && typeof ctx.state.userId === 'string' && ctx.state.userId.length > 0) {
        return ctx.state.userId
    }

    const token = parseAuthorizationHeader(ctx)
    if (!token) {
        throw new Error('Missing authorization header')
    }

    // In production, Supabase's edge runtime already verifies the JWT before
    // our code runs. We decode the payload without re-verifying the signature.
    // In local development, tokens come from the local Supabase auth service
    // and the database is local, so signature verification adds no security value.
    const userId = decodeJwtPayload(token)
    if (userId) {
        ctx.state.userId = userId
        return userId
    }

    throw new Error('Unauthorized: Could not extract user ID from token')
}

function decodeJwtPayload(token: string): string | null {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null

        const payloadB64 = parts[1]
        const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadB64))
        const payload = JSON.parse(payloadJson) as Record<string, unknown>

        // Check expiration
        const now = Math.floor(Date.now() / 1000)
        const exp = payload?.exp
        if (typeof exp === 'number' && now >= exp) {
            return null // Token expired
        }

        const sub = payload?.sub
        return typeof sub === 'string' ? sub : null
    } catch {
        return null
    }
}

function base64UrlToUint8Array(input: string): Uint8Array {
    let normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
    if (padding) {
        normalized += '='.repeat(4 - padding)
    }
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}
