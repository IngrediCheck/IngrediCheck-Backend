import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''

// Cache the JWKS client (handles internal caching with 5min TTL)
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks() {
    if (!_jwks && SUPABASE_URL) {
        _jwks = createRemoteJWKSet(
            new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
        )
    }
    return _jwks
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

    const jwks = getJwks()
    if (!jwks) {
        throw new Error('SUPABASE_URL not configured')
    }

    try {
        // Try JWKS verification (production uses asymmetric keys)
        const { payload } = await jwtVerify(token, jwks, {
            issuer: `${SUPABASE_URL}/auth/v1`,
            audience: 'authenticated',
        })

        const userId = payload.sub
        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid token: missing sub claim')
        }

        ctx.state.userId = userId
        return userId

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // For local development, fall back to decode-only mode for ANY JWKS error.
        // Local Supabase uses HS256 (symmetric keys) which aren't exposed via JWKS,
        // so JWKS verification will always fail locally (empty keyset, fetch errors, etc.)
        if (isLocalDevelopment()) {
            return decodeTokenWithoutVerification(token, ctx)
        }

        throw new Error(`Unauthorized: ${errorMessage}`)
    }
}

function isLocalDevelopment(): boolean {
    // In Docker, SUPABASE_URL is set to kong:8000, check for that too
    // Also check LOCAL_SUPABASE_URL which explicitly indicates local dev
    const localUrl = Deno.env.get('LOCAL_SUPABASE_URL') ?? ''
    return SUPABASE_URL.includes('127.0.0.1') ||
           SUPABASE_URL.includes('localhost') ||
           SUPABASE_URL.includes('kong:') ||
           localUrl.includes('127.0.0.1') ||
           localUrl.includes('localhost')
}

function decodeTokenWithoutVerification(token: string, ctx: Context): string {
    try {
        const payload = decodeJwt(token)

        // Check expiration
        const now = Math.floor(Date.now() / 1000)
        if (typeof payload.exp === 'number' && now >= payload.exp) {
            throw new Error('Token expired')
        }

        const userId = payload.sub
        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid token: missing sub claim')
        }

        ctx.state.userId = userId
        return userId
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Token decode failed'
        throw new Error(`Unauthorized: ${message}`)
    }
}
