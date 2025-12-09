import { signInAnon, functionsUrl } from "../_shared/utils.ts";

const RUN_E2E = Deno.env.get("MEMOJI_E2E") === "true";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

// Skip if not explicitly enabled or no OpenAI key provided.
if (RUN_E2E && OPENAI_KEY) {
  const baseUrl = Deno.env.get("SUPABASE_BASE_URL") ?? "http://127.0.0.1:54321";
  const memojiUrl = `${functionsUrl(baseUrl)}/ingredicheck/memoji`;

  async function callMemoji(accessToken: string, body: unknown) {
    const resp = await fetch(memojiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    return { status: resp.status, json };
  }

  Deno.test("memoji E2E: generate then cache hit", async () => {
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const { accessToken } = await signInAnon({ baseUrl, anonKey });

    const payload = {
      familyType: "father",
      gesture: "thumbs_up",
      hair: "short",
      skinTone: "medium",
      background: "auto",
      size: "1024x1024",
      model: "gpt-image-1",
      subscriptionTier: "free",
    };

    // First call: allow cached=true if a prior run stored this config; require imageUrl
    const first = await callMemoji(accessToken, payload);
    if (first.status !== 200) {
      throw new Error(`first call failed: ${first.status} ${JSON.stringify(first.json)}`);
    }
    if (!first.json?.imageUrl) throw new Error("first call missing imageUrl");

    // Second call: expect cache hit (cached=true)
    const second = await callMemoji(accessToken, payload);
    if (second.status !== 200) {
      throw new Error(`second call failed: ${second.status} ${JSON.stringify(second.json)}`);
    }
    if (!second.json?.cached) throw new Error("second call should be cached");
    if (!second.json?.imageUrl) throw new Error("second call missing imageUrl");
  });
} else {
  Deno.test("memoji E2E (skipped: set MEMOJI_E2E=true and OPENAI_API_KEY)", () => {
    // noop
  });
}

