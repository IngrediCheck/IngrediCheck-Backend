
import { functionsUrl, signInAnon, createSupabaseServiceClient, resolveSupabaseConfig } from "../_shared/utils.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { assertEquals, assertExists, assert } from "https://deno.land/std@0.192.0/testing/asserts.ts";

const BUCKET_NAME = "memoji-images";

async function setupUser(baseUrl: string) {
    const { accessToken } = await signInAnon();
    // Create a client scoped to this user ("authenticated" role)
    // We explicitly use the ANON key but pass the User's Access Token in the Authorization header.
    // This ensures that 'auth.uid()' in Postgres resolves to this user.
    const { anonKey } = await resolveSupabaseConfig();
    const client = createClient(baseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
    
    return { client, accessToken };
}

Deno.test({
    name: "memoji: lifecycle (seed, fetch, pagination, cleanup)",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async (t) => {
        // Shared setup
        const { baseUrl } = await signInAnon();
        const serviceClient = createSupabaseServiceClient({ baseUrl });
        // Ensure bucket exists (using service role to be safe/idempotent)
        await serviceClient.storage.createBucket(BUCKET_NAME, { public: true });
        
        // 1. Unauthorized Access Test
        await t.step("should fail without auth (401)", async () => {
            const res = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/memojis/latest`, {
                method: "GET"
            });
            assertEquals(res.status, 401);
        });

        // 2. Pagination & Security Test
        await t.step("should return only user OWNED memojis and support pagination", async () => {
             // Create User A
             const userA = await setupUser(baseUrl);
             
             // Upload 3 files for User A with delays to ensure order
             const filesA = ["fileA1.txt", "fileA2.txt", "fileA3.txt"];
             for (const f of filesA) {
                 const { error } = await userA.client.storage.from(BUCKET_NAME).upload(f, new Blob(["content"]), { upsert: true });
                 if (error) throw error;
                 // robust time gap for ordering
                 await new Promise(r => setTimeout(r, 100)); 
             }
             
             // Verify User A sees 3 files
             const listResponse = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/memojis/latest?limit=10`, {
                 headers: { Authorization: `Bearer ${userA.accessToken}` }
             });
             if (listResponse.status !== 200) {
                 console.error("Fetch failed:", listResponse.status, await listResponse.text());
             }
             assertEquals(listResponse.status, 200);
             const data = await listResponse.json();
             assertExists(data.memojis);
             assertEquals(data.memojis.length, 3);
             
             // Check Pagination: Limit 2
             const page1Res = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/memojis/latest?limit=2`, {
                 headers: { Authorization: `Bearer ${userA.accessToken}` }
             });
             const page1 = await page1Res.json();
             assertEquals(page1.memojis.length, 2);
             // Ordered by created_at DESC -> A3 (newest), A2
             assertEquals(page1.memojis[0].name, "fileA3.txt");
             assertEquals(page1.memojis[1].name, "fileA2.txt");
             
             // Check Pagination: Offset 2
             const page2Res = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/memojis/latest?limit=2&offset=2`, {
                 headers: { Authorization: `Bearer ${userA.accessToken}` }
             });
             const page2 = await page2Res.json();
             assertEquals(page2.memojis.length, 1);
             assertEquals(page2.memojis[0].name, "fileA1.txt");
             
             // Cleanup User A files
             await userA.client.storage.from(BUCKET_NAME).remove(filesA);
        });
    }
});
