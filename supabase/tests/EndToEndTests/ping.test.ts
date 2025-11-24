import { functionsUrl, signInAnon } from "../_shared/utils.ts";

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      message ?? `Assertion failed: expected ${expected}, received ${actual}`,
    );
  }
}

type PingResponse = {
  status: string;
  dc: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  timezone: string | null;
};

Deno.test("ping: returns status and Cloudflare metadata", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const normalizedPath = "/ingredicheck/ping";
  const url = `${functionsUrl(baseUrl)}${normalizedPath}`;
  const requestHeaders = new Headers();
  requestHeaders.set("Authorization", `Bearer ${accessToken}`);

  const resp = await fetch(url, {
    method: "GET",
    headers: requestHeaders,
  });

  assertEquals(resp.status, 200, "Expected HTTP 200 status");

  const data = await resp.json() as PingResponse;
  assertEquals(data.status, "ok", "Response should have status 'ok'");
  
  // Verify all expected fields are present (values may be null)
  assertEquals(typeof data.dc === "string" || data.dc === null, true, "dc should be string or null");
  assertEquals(typeof data.country === "string" || data.country === null, true, "country should be string or null");
  assertEquals(typeof data.city === "string" || data.city === null, true, "city should be string or null");
  assertEquals(typeof data.region === "string" || data.region === null, true, "region should be string or null");
  assertEquals(typeof data.timezone === "string" || data.timezone === null, true, "timezone should be string or null");
});


