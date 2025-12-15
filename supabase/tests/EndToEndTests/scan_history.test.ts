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

type ScanImage =
    | { type: 'inventory'; url: string }
    | { type: 'user'; content_hash: string; storage_path: string | null; status: string; extraction_error: string | null };

type Scan = {
    id: string;
    scan_type: 'barcode' | 'photo';
    barcode: string | null;
    status: string;
    product_info: Record<string, unknown>;
    product_info_source: string | null;
    analysis_status: string | null;
    analysis_result: Record<string, unknown> | null;
    images: ScanImage[];
    latest_guidance: string | null;
    created_at: string;
    last_activity_at: string;
};

type ScanHistoryResponse = {
    scans: Scan[];
    total: number;
    has_more: boolean;
};

Deno.test("scan history: returns empty array for new user", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const url = `${functionsUrl(baseUrl)}/ingredicheck/scan/history`;
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;
    assertArrayLength(data.scans, 0, "Expected empty scans array for new user");
    assertEquals(data.total, 0, "Expected total to be 0");
    assertEquals(data.has_more, false, "Expected has_more to be false");
});

Deno.test("scan history: returns 401 without auth", async () => {
    const { baseUrl } = await signInAnon();
    const url = `${functionsUrl(baseUrl)}/ingredicheck/scan/history`;

    const resp = await fetch(url, { method: "GET" });
    await resp.text(); // Consume body to avoid leak

    assertEquals(resp.status, 401, "Expected HTTP 401 status without auth");
});

Deno.test("scan history: validates limit parameter", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const invalidLimitUrl = `${functionsUrl(baseUrl)}/ingredicheck/scan/history?limit=0`;
    const resp = await fetch(invalidLimitUrl, { method: "GET", headers });
    await resp.text(); // Consume body to avoid leak

    assertEquals(resp.status, 400, "Expected HTTP 400 for invalid limit");
});

Deno.test("scan history: validates offset parameter", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const invalidOffsetUrl = `${functionsUrl(baseUrl)}/ingredicheck/scan/history?offset=-1`;
    const resp = await fetch(invalidOffsetUrl, { method: "GET", headers });
    await resp.text(); // Consume body to avoid leak

    assertEquals(resp.status, 400, "Expected HTTP 400 for negative offset");
});

Deno.test("scan history: respects pagination parameters", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const url = `${functionsUrl(baseUrl)}/ingredicheck/scan/history?limit=5&offset=0`;
    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;
    assertEquals(Array.isArray(data.scans), true, "Expected scans to be an array");
    assertEquals(typeof data.total, "number", "Expected total to be a number");
    assertEquals(typeof data.has_more, "boolean", "Expected has_more to be a boolean");
});

Deno.test("scan history: returns scan with correct structure", async () => {
    const { accessToken, baseUrl } = await signInAnon();
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${accessToken}`);

    const url = `${functionsUrl(baseUrl)}/ingredicheck/scan/history?limit=1&offset=0`;
    const resp = await fetch(url, { method: "GET", headers });

    assertEquals(resp.status, 200, "Expected HTTP 200 status");

    const data = await resp.json() as ScanHistoryResponse;

    // If there are scans, verify structure
    if (data.scans.length > 0) {
        const scan = data.scans[0];
        assertEquals(typeof scan.id, "string", "Expected scan.id to be a string");
        assertEquals(
            scan.scan_type === "barcode" || scan.scan_type === "photo",
            true,
            "Expected scan_type to be 'barcode' or 'photo'"
        );
        assertEquals(typeof scan.status, "string", "Expected scan.status to be a string");
        assertEquals(typeof scan.product_info, "object", "Expected scan.product_info to be an object");
        assertEquals(Array.isArray(scan.images), true, "Expected scan.images to be an array");
        assertEquals(typeof scan.created_at, "string", "Expected scan.created_at to be a string");
        assertEquals(typeof scan.last_activity_at, "string", "Expected scan.last_activity_at to be a string");
    }
});
