const textEncoder = new TextEncoder()
const authModuleUrl = new URL("../../functions/shared/auth.ts", import.meta.url).href

function assertEquals(actual: unknown, expected: unknown, message?: string) {
    if (!Object.is(actual, expected)) {
        const actualString = JSON.stringify(actual)
        const expectedString = JSON.stringify(expected)
        throw new Error(message ?? `Expected ${expectedString} but received ${actualString}`)
    }
}

async function createJwt(secret: string, payload: Record<string, unknown>): Promise<string> {
    const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))
    const body = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)))
    const unsignedToken = `${header}.${body}`
    const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    )
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, textEncoder.encode(unsignedToken))
    const signature = base64UrlEncode(new Uint8Array(signatureBuffer))
    return `${unsignedToken}.${signature}`
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = ""
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function importAuthModule(tag: string) {
    return await import(`${authModuleUrl}?test=${tag}`)
}

Deno.test("decodeUserIdFromJwt enforces signature verification", async () => {
    Deno.env.set("SUPABASE_JWT_SECRET", "secret")
    Deno.env.delete("JWT_SECRET")

    const now = Math.floor(Date.now() / 1000)

    const validModule = await importAuthModule("valid")
    const validToken = await createJwt("secret", { sub: "user-123", exp: now + 60 })
    const validUserId = await validModule.decodeUserIdFromJwt(validToken)
    assertEquals(validUserId, "user-123")

    Deno.env.delete("SUPABASE_JWT_SECRET")

    Deno.env.set("SUPABASE_JWT_SECRET", "secret")
    Deno.env.delete("JWT_SECRET")

    const invalidModule = await importAuthModule("invalid")
    const invalidToken = await createJwt("other-secret", { sub: "attacker", exp: now + 60 })
    const invalidUserId = await invalidModule.decodeUserIdFromJwt(invalidToken)
    assertEquals(invalidUserId, null)

    Deno.env.delete("SUPABASE_JWT_SECRET")
    Deno.env.delete("JWT_SECRET")

    const noSecretModule = await importAuthModule("no-secret")
    const noSecretToken = await createJwt("unused", { sub: "user-123", exp: now + 60 })
    const noSecretUserId = await noSecretModule.decodeUserIdFromJwt(noSecretToken)
    assertEquals(noSecretUserId, null)
})

Deno.test("decodeUserIdFromJwt rejects expired tokens", async () => {
    Deno.env.set("SUPABASE_JWT_SECRET", "secret")
    Deno.env.delete("JWT_SECRET")

    const now = Math.floor(Date.now() / 1000)
    const expiredModule = await importAuthModule("expired")
    const expiredToken = await createJwt("secret", { sub: "user-123", exp: now - 10 })
    const expiredUserId = await expiredModule.decodeUserIdFromJwt(expiredToken)

    assertEquals(expiredUserId, null)

    Deno.env.delete("SUPABASE_JWT_SECRET")
})

Deno.test("decodeUserIdFromJwt rejects tokens before nbf", async () => {
    Deno.env.set("SUPABASE_JWT_SECRET", "secret")
    Deno.env.delete("JWT_SECRET")

    const now = Math.floor(Date.now() / 1000)
    const futureModule = await importAuthModule("nbf")
    const futureToken = await createJwt("secret", { sub: "user-123", exp: now + 120, nbf: now + 60 })
    const futureUserId = await futureModule.decodeUserIdFromJwt(futureToken)

    assertEquals(futureUserId, null)

    Deno.env.delete("SUPABASE_JWT_SECRET")
})
