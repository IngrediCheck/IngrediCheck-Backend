import { Router, RouterContext } from "oak";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

type MemojiContext = RouterContext<string>;

type RateRecord = { count: number; windowStart: number };
const rateLimitStore = new Map<string, RateRecord>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_BURST = 5;

const MONTHLY_CREDIT_LIMITS: Record<string, number> = {
  free: 2,
  monthly_basic: 100,
  monthly_standard: 300,
  monthly_pro: 1000,
  monthly: 100,
  lifetime: 10_000_000,
};

function getSupabaseServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    "";
  if (!url || !key) {
    throw new Error("Supabase env not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = new TextEncoder().encode(a);
  const bBuf = new TextEncoder().encode(b);
  if (aBuf.length !== bBuf.length) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const key = `rate_${ip}`;
  const record = rateLimitStore.get(key);
  if (!record) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  if (now - record.windowStart > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.windowStart = now;
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  if (record.count >= RATE_LIMIT_BURST && now - record.windowStart < 10_000) {
    return { allowed: false, remaining: 0, resetTime: record.windowStart + RATE_LIMIT_WINDOW };
  }
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetTime: record.windowStart + RATE_LIMIT_WINDOW };
  }
  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count };
}

function normalizeConfig(body: Record<string, unknown>) {
  return {
    model: (body.model as string) ?? "gpt-image-1",
    size: (body.size as string) ?? "1024x1024",
    familyType: (body.familyType as string) ?? "father",
    gesture: (body.gesture as string) ?? "wave",
    hair: ((body.hair as string) ?? "short").toLowerCase(),
    skinTone: ((body.skinTone as string) ?? "medium").toLowerCase(),
    accessories: Array.isArray(body.accessories)
      ? [...(body.accessories as string[])].sort()
      : [],
    colorTheme: (body.colorTheme as string) ?? "pastel-blue",
    background: (body.background as string) ?? "auto",
  };
}

async function generatePromptHash(config: ReturnType<typeof normalizeConfig>): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(config));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getUserCredits(
  client: SupabaseClient,
  userId: string,
  tier: string,
): Promise<{ credits_remaining: number; tier: string; current_month: string }> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data, error } = await client
    .from("memoji_user_credits")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  if (!data || data.current_month !== currentMonth || data.tier !== tier) {
    const creditsRemaining = MONTHLY_CREDIT_LIMITS[tier] ?? MONTHLY_CREDIT_LIMITS["monthly_basic"];
    const { data: upserted, error: upsertErr } = await client
      .from("memoji_user_credits")
      .upsert({
        user_id: userId,
        current_month: currentMonth,
        credits_remaining: creditsRemaining,
        tier,
      }, { onConflict: "user_id" })
      .select()
      .single();
    if (upsertErr) throw upsertErr;
    return upserted;
  }
  return data;
}

async function debitCredit(client: SupabaseClient, userId: string, tier: string): Promise<number> {
  const current = await getUserCredits(client, userId, tier);
  if (current.credits_remaining <= 0) return -1;
  const { data, error } = await client
    .from("memoji_user_credits")
    .update({
      credits_remaining: current.credits_remaining - 1,
    })
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data.credits_remaining;
}

async function checkCache(client: SupabaseClient, promptHash: string) {
  const { data, error } = await client
    .from("memoji_cache")
    .select("*")
    .eq("prompt_hash", promptHash)
    .eq("archived", false)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data ?? null;
}

async function incrementCacheUsage(client: SupabaseClient, promptHash: string) {
  await client.rpc("increment_memoji_usage", { hash: promptHash });
}

async function uploadToStorage(client: SupabaseClient, base64: string, promptHash: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const path = `${year}/${month}/${promptHash}.png`;
  const buffer = Uint8Array.from(atob(base64.replace(/^data:image\\/\\w+;base64,/, "")), (c) =>
    c.charCodeAt(0)
  );
  const { error } = await client.storage
    .from("memoji-images")
    .upload(path, buffer, { contentType: "image/png", upsert: true });
  if (error) throw error;
  const { data } = client.storage.from("memoji-images").getPublicUrl(path);
  return data.publicUrl;
}

async function storeInCache(
  client: SupabaseClient,
  promptHash: string,
  imageUrl: string,
  config: Record<string, unknown>,
) {
  const { error } = await client
    .from("memoji_cache")
    .insert({
      prompt_hash: promptHash,
      image_url: imageUrl,
      prompt_config: config,
      generation_cost: 0.02,
      usage_count: 1,
    });
  if (error) throw error;
}

function validateRequest(body: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  const prompt = body.prompt as string | undefined;
  const hasCompact = body.familyType || body.gesture || body.hair || body.skinTone || body.accessories || body.colorTheme;
  if ((!prompt || typeof prompt !== "string") && !hasCompact) {
    return { ok: false, message: "Either prompt or compact option IDs are required." };
  }
  const size = body.size as string | undefined;
  if (size && !["1024x1024", "1024x1536", "1536x1024"].includes(size)) {
    return { ok: false, message: "Invalid size parameter." };
  }
  const background = body.background as string | undefined;
  if (background && !["auto", "transparent"].includes(background)) {
    return { ok: false, message: "Invalid background parameter." };
  }
  const model = body.model as string | undefined;
  if (model && !["gpt-image-1", "dall-e-3", "dall-e-2"].includes(model)) {
    return { ok: false, message: "Invalid model parameter." };
  }
  return { ok: true };
}

export function registerMemojiRoutes(router: Router, serviceClient: SupabaseClient | null) {
  router.post("/ingredicheck/memoji", async (ctx: MemojiContext) => {
    const clientIP = ctx.request.headers.get("x-forwarded-for") ??
      ctx.request.ip ??
      ctx.request.conn.remoteAddr?.hostname ??
      "unknown";

    const rate = checkRateLimit(clientIP ?? "unknown");
    if (!rate.allowed) {
      ctx.response.status = 429;
      ctx.response.body = { error: { message: "Rate limit exceeded." } };
      return;
    }

    const secret = Deno.env.get("BACKEND_SECRET") ?? "";
    if (!secret) {
      ctx.response.status = 500;
      ctx.response.body = { error: { message: "Server secret missing." } };
      return;
    }

    const body = await ctx.request.body({ type: "json" }).value.catch(() => ({} as Record<string, unknown>));
    const timestamp = ctx.request.headers.get("x-timestamp") ?? "";
    const signature = ctx.request.headers.get("x-signature") ?? "";
    const rawBody = JSON.stringify(body ?? {});
    const expectedSig = timestamp ? await hmacSha256Hex(secret, `${timestamp}.${rawBody}`) : "";
    const isAuth =
      timestamp &&
      signature &&
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) <= 300 &&
      timingSafeEqual(signature, expectedSig);
    if (!isAuth) {
      ctx.response.status = 401;
      ctx.response.body = { error: { message: "Unauthorized" } };
      return;
    }

    const validation = validateRequest(body);
    if (!validation.ok) {
      ctx.response.status = 400;
      ctx.response.body = { error: { message: validation.message } };
      return;
    }

    const supabase = serviceClient ?? getSupabaseServiceClient();
    const userId = ctx.state.userId as string | undefined;
    if (!userId) {
      ctx.response.status = 401;
      ctx.response.body = { error: { code: "AUTH_REQUIRED", message: "Sign in required." } };
      return;
    }

    const tier = (body.subscriptionTier as string) ?? "free";

    // Credit enforcement
    try {
      const remainingAfterDebit = await debitCredit(supabase, userId, tier);
      if (remainingAfterDebit < 0) {
        ctx.response.status = 402;
        ctx.response.body = {
          error: { code: "OUT_OF_CREDITS", message: "You are out of credits." },
          remaining: 0,
        };
        return;
      }
      ctx.response.headers.set("X-Credits-Remaining", String(remainingAfterDebit));
    } catch (e) {
      console.error("Credit enforcement error", e);
      ctx.response.status = 500;
      ctx.response.body = { error: { message: "Credit system error." } };
      return;
    }

    const config = normalizeConfig(body);
    const promptHash = await generatePromptHash(config);

    // Cache check
    try {
      const cached = await checkCache(supabase, promptHash);
      if (cached) {
        await incrementCacheUsage(supabase, promptHash);
        ctx.response.status = 200;
        ctx.response.body = {
          success: true,
          imageUrl: cached.image_url,
          cached: true,
          cacheId: cached.id,
          creditsConsumed: true,
        };
        return;
      }
    } catch (err) {
      console.warn("Cache lookup failed, continuing to generation", err);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      ctx.response.status = 500;
      ctx.response.body = { error: { message: "OPENAI_API_KEY missing." } };
      return;
    }

    try {
      const openai = new OpenAI({ apiKey: openaiKey });
      const selectedModel = (body.model as string) ?? "gpt-image-1";
      const generationParams: Record<string, unknown> = {
        model: selectedModel,
        prompt: (body.prompt as string) ?? "",
        n: 1,
      };
      if (selectedModel === "gpt-image-1") {
        generationParams.size = config.size;
        generationParams.background = config.background;
        generationParams.output_format = "png";
      } else {
        generationParams.size = config.size;
      }

      const image = await openai.images.generate(generationParams as any);
      const b64 = image.data?.[0]?.b64_json;
      if (!b64 || typeof b64 !== "string") {
        throw new Error("Image generation failed: empty response");
      }

      const imageUrl = await uploadToStorage(supabase, b64, promptHash);

      try {
        await storeInCache(supabase, promptHash, imageUrl, config);
      } catch (cacheErr) {
        console.error("Failed to store cache", cacheErr);
      }

      ctx.response.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
      ctx.response.headers.set("X-RateLimit-Remaining", String(rate.remaining));

      ctx.response.status = 200;
      ctx.response.body = {
        success: true,
        cached: false,
        imageUrl,
      };
    } catch (error) {
      console.error("Memoji generation error", error);
      ctx.response.status = 500;
      ctx.response.body = { error: { message: "Internal error during memoji generation." } };
    }
  });
}


