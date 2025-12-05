import { Router, RouterContext } from "oak";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type MemojiContext = RouterContext<string>;

type RateRecord = { count: number; windowStart: number };
const rateLimitStore = new Map<string, RateRecord>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_BURST = 5;

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

export function normalizeConfig(body: Record<string, unknown>) {
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

export async function generatePromptHash(config: ReturnType<typeof normalizeConfig>): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(config));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getOrInitAvatarUsage(
  client: SupabaseClient,
  userId: string,
): Promise<{ avatar_generation_count: number; updated_at: string }> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data, error } = await client
    .from("users")
    .select("avatar_generation_count, updated_at")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") throw error;

  if (!data) {
    const { data: inserted, error: insertErr } = await client
      .from("users")
      .upsert(
        {
          user_id: userId,
          avatar_generation_count: 0,
        },
        { onConflict: "user_id" },
      )
      .select("avatar_generation_count, updated_at")
      .single();
    if (insertErr) throw insertErr;
    return inserted;
  }

  const lastUpdatedMonth =
    typeof data.updated_at === "string"
      ? data.updated_at.slice(0, 7)
      : new Date(data.updated_at as string).toISOString().slice(0, 7);

  if (lastUpdatedMonth !== currentMonth) {
    const { data: reset, error: resetErr } = await client
      .from("users")
      .update({ avatar_generation_count: 0 })
      .eq("user_id", userId)
      .select("avatar_generation_count, updated_at")
      .single();
    if (resetErr) throw resetErr;
    return reset;
  }

  return data;
}

async function recordAvatarGeneration(client: SupabaseClient, userId: string): Promise<void> {
  const usage = await getOrInitAvatarUsage(client, userId);
  const { error } = await client
    .from("users")
    .update({
      avatar_generation_count: usage.avatar_generation_count + 1,
    })
    .eq("user_id", userId);
  if (error) throw error;
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
  // Ensure bucket exists (idempotent)
  const bucketName = "memoji-images";
  try {
    const { error: bucketErr } = await client.storage.createBucket(bucketName, {
      public: true,
    });
    const bucketStatus = (bucketErr as { statusCode?: string } | null)?.statusCode;
    const bucketMessage = (bucketErr as { message?: string } | null)?.message;
    if (bucketErr && bucketStatus !== "409" && bucketMessage !== "The resource already exists") {
      throw bucketErr;
    }
  } catch (e) {
    // If bucket already exists, continue; otherwise surface the error
    if (!(e as { statusCode?: string; message?: string })?.message?.includes("exists")) {
      throw e;
    }
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const path = `${year}/${month}/${promptHash}.png`;
  const cleaned = base64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
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

export function validateRequest(body: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
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

export function buildPromptFromOptions(body: Record<string, unknown>): string {
  const familyType = (body.familyType as string) ?? "father";
  const gesture = ((body.gesture as string) ?? "wave").replace(/_/g, "-");
  const hair = (body.hair as string) ?? "short";
  const skinTone = (body.skinTone as string) ?? "medium";
  const accessories = Array.isArray(body.accessories) && (body.accessories as string[]).length
    ? `wearing ${(body.accessories as string[])[0]}`
    : "";
  const clothing = (body.colorTheme as string) === "warm-pink"
    ? "soft pastel sweater"
    : "casual pastel shirt";
  const bg = (body.background === "transparent" || body.colorTheme === "transparent")
    ? ""
    : "Pastel circular background.";
  return `A premium 3D Memoji-style avatar of a ${familyType} with ${hair} and ${skinTone} skin tone. Include head, shoulders, and hands with a ${gesture} gesture. ${clothing}. ${accessories}. ${bg} Soft rounded shapes, glossy textures, minimal modern style. Cheerful happy face with warm eyes.`.trim();
}

export function buildGenerationParams(
  selectedModel: string,
  prompt: string,
  config: ReturnType<typeof normalizeConfig>,
): Record<string, unknown> {
  const generationParams: Record<string, unknown> = {
    model: selectedModel,
    prompt,
    n: 1,
  };
  if (selectedModel === "gpt-image-1") {
    generationParams.size = config.size;
    generationParams.background = config.background;
    generationParams.output_format = "png";
  } else {
    generationParams.size = config.size;
  }
  return generationParams;
}

export function registerMemojiRoutes(router: Router, serviceClient: SupabaseClient | null) {
  router.post("/ingredicheck/memoji", async (ctx: MemojiContext) => {
    const clientIP = ctx.request.headers.get("x-forwarded-for") ??
      ctx.request.ip ??
      "unknown";

    const rate = checkRateLimit(clientIP ?? "unknown");
    if (!rate.allowed) {
      ctx.response.status = 429;
      ctx.response.body = { error: { message: "Rate limit exceeded." } };
      return;
    }

    const body = await ctx.request.body({ type: "json" }).value.catch(() => ({} as Record<string, unknown>));

    if (!body.prompt) {
      try {
        body.prompt = buildPromptFromOptions(body);
      } catch (_err) {
        // fall through to validation error
      }
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

    // Usage tracking (best effort; does not block generation)
    try {
      await recordAvatarGeneration(supabase, userId);
    } catch (e) {
      console.warn("Usage tracking skipped", e);
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
        };
        return;
      }
    } catch (err) {
      console.warn("Cache lookup failed, continuing to generation", err);
    }

    const testMode = Deno.env.get("MEMOJI_TEST_MODE") === "true";
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    try {
      let imageUrl: string;

      if (testMode) {
        // In test mode, skip OpenAI and storage; return a deterministic stub URL.
        imageUrl = `test://memoji/${promptHash}.png`;
      } else {
        if (!openaiKey) {
          ctx.response.status = 500;
          ctx.response.body = { error: { message: "OPENAI_API_KEY missing." } };
          return;
        }

        const { default: OpenAI } = await import("openai");
        const openai = new OpenAI({ apiKey: openaiKey });
      const selectedModel = (body.model as string) ?? "gpt-image-1";
      const generationParams = buildGenerationParams(
        selectedModel,
        (body.prompt as string) ?? "",
        config,
      );

        const image = await openai.images.generate(generationParams as any);
        const b64 = image.data?.[0]?.b64_json;
        if (!b64 || typeof b64 !== "string") {
          throw new Error("Image generation failed: empty response");
        }

        imageUrl = await uploadToStorage(supabase, b64, promptHash);

        try {
          await storeInCache(supabase, promptHash, imageUrl, config);
        } catch (cacheErr) {
          console.error("Failed to store cache", cacheErr);
        }
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

// Test helpers (exported for offline/unit tests)
export const testExports = {
  normalizeConfig,
  generatePromptHash,
  validateRequest,
  buildPromptFromOptions,
  buildGenerationParams,
};


