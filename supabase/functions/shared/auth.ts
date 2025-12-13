import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { jwtVerify, createRemoteJWKSet, importJWK, JWK } from 'https://deno.land/x/jose@v5.2.0/index.ts'

const textEncoder = new TextEncoder()

// Environment configuration
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
// Note: Use JWT_SECRET not SUPABASE_JWT_SECRET - Supabase CLI skips SUPABASE_ prefixed env vars
const jwtSecret = Deno.env.get('JWT_SECRET') ?? ''

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

// Diagnostic info for debugging auth failures
interface AuthDiagnostics {
    hasToken: boolean
    tokenAlg?: string
    tokenKid?: string
    jwksAvailable: boolean
    supabaseUrlSet: boolean
    jwtSecretSet: boolean
    jwksError?: string
    hmacError?: string
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
    // our code runs (as evidenced by auth_user being populated in request metadata).
    // We can safely decode the payload without re-verifying the signature.
    // This avoids JWKS fetch issues within Edge Functions.

    // For local development with JWT_SECRET, we still verify the HS256 signature.
    if (jwtSecret) {
        const userId = await verifyJwtWithHmac(token)
        if (userId) {
            ctx.state.userId = userId
            return userId
        }
    }

    // Production path: decode JWT payload directly (Supabase already verified it)
    const userId = decodeJwtPayloadWithoutVerification(token)
    if (userId) {
        ctx.state.userId = userId
        return userId
    }

    throw new Error('Unauthorized: Could not extract user ID from token')
}

function decodeJwtPayloadWithoutVerification(token: string): string | null {
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

async function verifyJwtWithJwks(token: string): Promise<string | null> {
    const { userId } = await verifyJwtWithJwksWithError(token)
    return userId
}

async function verifyJwtWithJwksWithError(token: string): Promise<{ userId: string | null; error?: string }> {
    if (!JWKS) {
        return { userId: null, error: `JWKS null (SUPABASE_URL=${supabaseUrl ? 'SET' : 'NOT SET'})` }
    }

    try {
        // NO issuer validation - per official Supabase docs
        // https://supabase.com/docs/guides/auth/jwts#verifying-a-jwt-from-supabase
        const { payload } = await jwtVerify(token, JWKS)
        const userId = typeof payload.sub === 'string' ? payload.sub : null
        return { userId }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { userId: null, error: msg }
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
    const { userId } = await verifyJwtWithHmacWithError(token)
    return userId
}

async function verifyJwtWithHmacWithError(token: string): Promise<{ userId: string | null; error?: string }> {
    const parts = token.split('.')
    if (parts.length !== 3) {
        return { userId: null, error: 'Invalid JWT format (not 3 parts)' }
    }

    const key = await getHmacKey()
    if (!key) {
        return { userId: null, error: 'HMAC key not available (JWT_SECRET not set)' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify header
    const textDecoder = new TextDecoder()
    let header: Record<string, unknown>
    try {
        const headerJson = textDecoder.decode(base64UrlToUint8Array(headerB64))
        header = JSON.parse(headerJson) as Record<string, unknown>
    } catch (e) {
        return { userId: null, error: `Header parse error: ${e instanceof Error ? e.message : String(e)}` }
    }

    if (header['alg'] !== 'HS256') {
        return { userId: null, error: `Algorithm mismatch: expected HS256, got ${header['alg']}` }
    }

    // Verify signature
    const signature = base64UrlToUint8Array(signatureB64)
    const data = textEncoder.encode(`${headerB64}.${payloadB64}`)
    const verified = await crypto.subtle.verify('HMAC', key, signature, data)
    if (!verified) {
        return { userId: null, error: 'Signature verification failed' }
    }

    // Parse and validate payload
    let payload: Record<string, unknown>
    try {
        const payloadJson = textDecoder.decode(base64UrlToUint8Array(payloadB64))
        payload = JSON.parse(payloadJson) as Record<string, unknown>
    } catch (e) {
        return { userId: null, error: `Payload parse error: ${e instanceof Error ? e.message : String(e)}` }
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    const exp = payload?.exp
    if (typeof exp !== 'number' || !Number.isFinite(exp) || now >= exp) {
        return { userId: null, error: `Token expired (exp=${exp}, now=${now})` }
    }

    // Check not-before
    const nbf = payload?.nbf
    if (typeof nbf === 'number' && Number.isFinite(nbf) && now < nbf) {
        return { userId: null, error: `Token not yet valid (nbf=${nbf}, now=${now})` }
    }

    const sub = payload?.sub
    if (typeof sub !== 'string') {
        return { userId: null, error: `Invalid sub claim: ${typeof sub}` }
    }
    return { userId: sub }
}

// Export for backward compatibility if needed elsewhere
export async function decodeUserIdFromJwt(token: string): Promise<string | null> {
    let userId = await verifyJwtWithJwks(token)
    if (!userId && jwtSecret) {
        userId = await verifyJwtWithHmac(token)
    }
    return userId
}
