import { functionsUrl, signInAnon } from "../_shared/utils.ts";

function assertEquals<T>(actual: T, expected: T, message?: string): void {
    if (!Object.is(actual, expected)) {
        throw new Error(
            message ?? `Assertion failed: expected ${expected}, received ${actual}`,
        );
    }
}

function assertArrayLength(actual: unknown[], expected: number, message?: string): void {
    if (actual.length !== expected) {
        throw new Error(
            message ?? `Assertion failed: expected array length ${expected}, received ${actual.length}`,
        );
    }
}

type ScanAnalysis = {
    id: string;
    status: string;
    isStale: boolean;
    result: Record<string, unknown> | null;
    isDownvoted: boolean;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
};

type Scan = {
    id: string;
    scanType: 'barcode' | 'photo';
    barcode: string | null;
    status: string;
    productInfo: Record<string, unknown>;
    productInfoSource: string | null;
    isFavorited: boolean;
    latestAnalysis: ScanAnalysis | null;
    latestGuidance: string | null;
    latestErrorMessage: string | null;
    createdAt: string;
    lastActivityAt: string;
};

type ScanHistoryResponse = {
    scans: Scan[];
    total: number;
    has_more: boolean;
};

Deno.test("v2 scan history: returns empty array for new user", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const url = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history`;
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;
    assertArrayLength(data.scans, 0, "Expected empty scans array for new user");
    assertEquals(data.total, 0, "Expected total to be 0");
    assertEquals(data.has_more, false, "Expected has_more to be false");
});

Deno.test("v2 scan history: returns 401 without auth", async () => {
    const { baseUrl } = await signInAnon();
    const url = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history`;

    const resp = await fetch(url, { method: "GET" });
    await resp.text(); // Consume body to avoid leak

    assertEquals(resp.status, 401, "Expected HTTP 401 status without auth");
});

Deno.test("v2 scan history: validates limit parameter", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const invalidLimitUrl = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history?limit=0`;
    const resp = await fetch(invalidLimitUrl, { method: "GET", headers });
    await resp.text(); // Consume body to avoid leak

    assertEquals(resp.status, 400, "Expected HTTP 400 for invalid limit");
});

Deno.test("v2 scan history: validates offset parameter", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const invalidOffsetUrl = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history?offset=-1`;
    const resp = await fetch(invalidOffsetUrl, { method: "GET", headers });
    await resp.text(); // Consume body to avoid leak

    assertEquals(resp.status, 400, "Expected HTTP 400 for negative offset");
});

Deno.test("v2 scan history: respects pagination parameters", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const url = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history?limit=5&offset=0`;
    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;
    assertEquals(Array.isArray(data.scans), true, "Expected scans to be an array");
    assertEquals(typeof data.total, "number", "Expected total to be a number");
    assertEquals(typeof data.has_more, "boolean", "Expected has_more to be a boolean");
});

Deno.test("v2 scan history: returns scan with correct structure", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const url = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history?limit=1&offset=0`;
    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;

    // If there are scans, verify structure
    if (data.scans.length > 0) {
        const scan = data.scans[0];
        assertEquals(typeof scan.id, "string", "Expected scan.id to be a string");
        assertEquals(
            scan.scanType === "barcode" || scan.scanType === "photo",
            true,
            "Expected scanType to be 'barcode' or 'photo'"
        );
        assertEquals(typeof scan.status, "string", "Expected scan.status to be a string");
        assertEquals(typeof scan.productInfo, "object", "Expected scan.productInfo to be an object");
        assertEquals(typeof scan.isFavorited, "boolean", "Expected scan.isFavorited to be a boolean");
        assertEquals(typeof scan.createdAt, "string", "Expected scan.createdAt to be a string");
        assertEquals(typeof scan.lastActivityAt, "string", "Expected scan.lastActivityAt to be a string");
    }
});

Deno.test("v2 scan history: supports favorited filter", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    // Test with favorited=true filter
    const url = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history?favorited=true`;
    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;
    assertEquals(Array.isArray(data.scans), true, "Expected scans to be an array");

    // All returned scans should be favorited
    for (const scan of data.scans) {
        assertEquals(scan.isFavorited, true, "Expected all scans to be favorited when filtering by favorited=true");
    }
});

Deno.test("v2 scan history: supports favorited=false filter", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    // Test with favorited=false filter
    const url = `${functionsUrl(baseUrl)}/ingredicheck/v2/scan/history?favorited=false`;
    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;
    assertEquals(Array.isArray(data.scans), true, "Expected scans to be an array");

    // All returned scans should not be favorited
    for (const scan of data.scans) {
        assertEquals(scan.isFavorited, false, "Expected all scans to not be favorited when filtering by favorited=false");
    }
});
