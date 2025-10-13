import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET') ?? Deno.env.get('JWT_SECRET') ?? ''
let jwtKeyPromise: Promise<CryptoKey | null> | null = null

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

async function getJwtKey(): Promise<CryptoKey | null> {
    if (!jwtSecret) {
        return null
    }
    if (!jwtKeyPromise) {
        jwtKeyPromise = crypto.subtle.importKey(
            'raw',
            textEncoder.encode(jwtSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        ).catch(() => null)
    }
    return await jwtKeyPromise
}

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
        throw new Error('Unauthorized: No valid user found')
    }

    const userId = await decodeUserIdFromJwt(token)
    if (userId && userId.length > 0) {
        ctx.state.userId = userId
        return userId
    }

    throw new Error('Unauthorized: No valid user found')
}

export async function decodeUserIdFromJwt(token: string): Promise<string | null> {
    let payload: Record<string, unknown> | null = null

    try {
        payload = await verifyJwt(token)
    } catch (_error) {
        payload = null
    }

    const sub = payload?.sub
    return typeof sub === 'string' ? sub : null
}

async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
    const parts = token.split('.')
    if (parts.length !== 3) {
        return null
    }

    const key = await getJwtKey()
    if (!key) {
        return null
    }

    const [headerB64, payloadB64, signatureB64] = parts
    const headerJson = textDecoder.decode(base64UrlToUint8Array(headerB64))
    const header = JSON.parse(headerJson) as Record<string, unknown>
    if (header['alg'] !== 'HS256') {
        return null
    }

    const signature = base64UrlToUint8Array(signatureB64)
    const data = textEncoder.encode(`${headerB64}.${payloadB64}`)

    const verified = await crypto.subtle.verify('HMAC', key, signature, data)
    if (!verified) {
        return null
    }

    const payloadJson = textDecoder.decode(base64UrlToUint8Array(payloadB64))
    const payload = JSON.parse(payloadJson) as Record<string, unknown>

    const now = Math.floor(Date.now() / 1000)
    const exp = payload?.exp
    if (typeof exp !== 'number' || !Number.isFinite(exp) || now >= exp) {
        return null
    }

    const nbf = payload?.nbf
    if (typeof nbf === 'number' && Number.isFinite(nbf) && now < nbf) {
        return null
    }

    return payload
}
