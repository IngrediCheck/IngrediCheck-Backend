import { functionsUrl, signInAnon } from "../_shared/utils.ts";

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      message ?? `Assertion failed: expected ${expected}, received ${actual}`,
    );
  }
}

Deno.test("ping: returns 204 No Content", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const normalizedPath = "/ingredicheck/ping";
  const url = `${functionsUrl(baseUrl)}${normalizedPath}`;
  const requestHeaders = new Headers();
  requestHeaders.set("Authorization", `Bearer ${accessToken}`);

  const resp = await fetch(url, {
    method: "GET",
    headers: requestHeaders,
  });

  assertEquals(resp.status, 204, "Expected HTTP 204 No Content status");
  assertEquals(await resp.text(), "", "Response body should be empty");
});


