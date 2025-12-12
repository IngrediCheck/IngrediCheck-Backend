import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { jwtVerify, createRemoteJWKSet, importJWK, JWK } from 'https://deno.land/x/jose@v5.2.0/index.ts'

const textEncoder = new TextEncoder()

// Environment configuration
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET') ?? Deno.env.get('JWT_SECRET') ?? ''

// JWKS for asymmetric key verification (production)
const JWKS = supabaseUrl
    ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`))
    : null

// Cached HMAC key for HS256 verification (local development)
let hmacKeyPromise: Promise<CryptoKey | null> | null = null

async function getHmacKey(): Promise<CryptoKey | null> {
    if (!jwtSecret) {
        return null
    }
    if (!hmacKeyPromise) {
        hmacKeyPromise = crypto.subtle.importKey(
            'raw',
            textEncoder.encode(jwtSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        ).catch(() => null)
    }
    return await hmacKeyPromise
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
        throw new Error('Missing authorization header')
    }

    // Try JWKS first (production path - asymmetric keys)
    let userId = await verifyJwtWithJwks(token)

    // Fall back to HS256 if JWKS verification fails and JWT_SECRET is available
    if (!userId && jwtSecret) {
        userId = await verifyJwtWithHmac(token)
    }

    if (userId && userId.length > 0) {
        ctx.state.userId = userId
        return userId
    }

    throw new Error('Unauthorized: No valid user found')
}

async function verifyJwtWithJwks(token: string): Promise<string | null> {
    if (!JWKS) {
        return null
    }

    try {
        const { payload } = await jwtVerify(token, JWKS, {
            issuer: `${supabaseUrl}/auth/v1`
        })
        return typeof payload.sub === 'string' ? payload.sub : null
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

async function verifyJwtWithHmac(token: string): Promise<string | null> {
    const parts = token.split('.')
    if (parts.length !== 3) {
        return null
    }

    const key = await getHmacKey()
    if (!key) {
        return null
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify header
    const textDecoder = new TextDecoder()
    const headerJson = textDecoder.decode(base64UrlToUint8Array(headerB64))
    const header = JSON.parse(headerJson) as Record<string, unknown>
    if (header['alg'] !== 'HS256') {
        return null
    }

    // Verify signature
    const signature = base64UrlToUint8Array(signatureB64)
    const data = textEncoder.encode(`${headerB64}.${payloadB64}`)
    const verified = await crypto.subtle.verify('HMAC', key, signature, data)
    if (!verified) {
        return null
    }

    // Parse and validate payload
    const payloadJson = textDecoder.decode(base64UrlToUint8Array(payloadB64))
    const payload = JSON.parse(payloadJson) as Record<string, unknown>

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    const exp = payload?.exp
    if (typeof exp !== 'number' || !Number.isFinite(exp) || now >= exp) {
        return null
    }

    // Check not-before
    const nbf = payload?.nbf
    if (typeof nbf === 'number' && Number.isFinite(nbf) && now < nbf) {
        return null
    }

    const sub = payload?.sub
    return typeof sub === 'string' ? sub : null
}

// Export for backward compatibility if needed elsewhere
export async function decodeUserIdFromJwt(token: string): Promise<string | null> {
    let userId = await verifyJwtWithJwks(token)
    if (!userId && jwtSecret) {
        userId = await verifyJwtWithHmac(token)
    }
    return userId
}
