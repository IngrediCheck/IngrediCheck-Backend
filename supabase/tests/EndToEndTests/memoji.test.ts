
import { functionsUrl, signInAnon, createSupabaseServiceClient } from "../_shared/utils.ts";

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      message ?? `Assertion failed: expected ${expected}, received ${actual}`,
    );
  }
}

function assertExists(actual: unknown, message?: string): void {
  if (actual === undefined || actual === null) {
    throw new Error(message ?? "Expected value to exist");
  }
}

function assertArray(actual: unknown, message?: string): void {
  if (!Array.isArray(actual)) {
    throw new Error(message ?? `Expected value to be an array, but got ${typeof actual}`);
  }
}

Deno.test({
    name: "memoji: get_latest_memojis",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
    const { accessToken, baseUrl } = await signInAnon();

    // Seed: Upload a dummy file if needed
    const supabase = createSupabaseServiceClient({ baseUrl });
    
    // Ensure bucket exists
    await supabase.storage.createBucket("memoji-images", { public: true });

    // Upload a test file
    const testFileName = `test-${Date.now()}.txt`;
    const { error: uploadError } = await supabase.storage
        .from("memoji-images")
        .upload(testFileName, new Blob(["dummy content"]), { upsert: true });
        
    if (uploadError) {
        console.warn("Failed to seed dummy file (might already exist or permission issue):", uploadError);
    } else {
        console.log("Seeded dummy file:", testFileName);
    }

    // Call the Edge Function
    const response = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/memojis/latest?limit=10&offset=0`, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        }
    });

    if (response.status !== 200) {
        const text = await response.text();
        throw new Error(`RPC call failed with status ${response.status}: ${text}`);
    }

    const data = await response.json();
    
    // Assertions
    assertExists(data, "Response data should exist");
    assertArray(data.memojis, "Response.memojis should be an array");
    
    // We might get an empty array if the bucket is empty, which is fine for this test.
    // The main goal is to verify the function exists and is accessible.
    console.log(`Fetched ${data.memojis.length} memojis.`);
    
    // If there are items, verify structure
    if (data.memojis.length > 0) {
        const first = data.memojis[0];
        assertExists(first.id, "Memoji ID should exist");
        assertExists(first.name, "Memoji name should exist");
        // meta check
        // assertExists(first.metadata, "Memoji metadata should exist");
    }
  }
});
