import {
  AuthTokens,
  buildAuthHeaders,
  createSupabaseServiceClient,
  functionsUrl,
  resolveSupabaseConfig,
  signInAnonymously,
} from "../_shared/utils.ts";
import {
  assert,
  assertArrayIncludes,
  assertEquals,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

type DeviceRegisterResponse = {
  is_internal: boolean;
};

type DeviceStatusResponse = {
  is_internal: boolean;
};

type MarkDeviceInternalResponse = {
  device_id: string;
  affected_users: number;
};

async function callDevicesEndpoint<T>(
  tokens: AuthTokens,
  baseFunctionsUrl: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${baseFunctionsUrl}${normalizedPath}`;
  const headers = buildAuthHeaders(tokens, undefined, { acceptJson: true });
  const method = options.method ?? "GET";
  let payload: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(options.body);
  }

  const resp = await fetch(url, { method, headers, body: payload });
  const text = await resp.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch (_error) {
    parsed = undefined;
  }

  if (!resp.ok) {
    throw new Error(
      `${method} ${normalizedPath} failed (${resp.status}): ${text}`,
    );
  }

  return parsed as T;
}

async function getUserIsInternal(
  serviceRoleClient: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await serviceRoleClient.rpc("user_is_internal", {
    _user_id: userId,
  });
  if (error) {
    throw new Error(`user_is_internal failed: ${error.message}`);
  }
  return Boolean(data === true);
}

Deno.test({
  name: "device tracking: registration, gesture, and propagation",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
  const config = await resolveSupabaseConfig();
  const baseUrl = config.baseUrl;
  const anonKey = config.anonKey;
  const functionsBase = functionsUrl(baseUrl);
  const deviceId = crypto.randomUUID();
  const serviceClient = createSupabaseServiceClient({ baseUrl });

  const firstUser = await signInAnonymously(baseUrl, anonKey);

  const registerResponse = await callDevicesEndpoint<DeviceRegisterResponse>(
    firstUser.tokens,
    functionsBase,
    "/ingredicheck/devices/register",
    {
      method: "POST",
      body: { deviceId },
    },
  );

  assertEquals(registerResponse.is_internal, false);
  assertEquals(
    await getUserIsInternal(serviceClient, firstUser.userId),
    false,
  );

  const markResponse = await callDevicesEndpoint<MarkDeviceInternalResponse>(
    firstUser.tokens,
    functionsBase,
    "/ingredicheck/devices/mark-internal",
    {
      method: "POST",
      body: { deviceId },
    },
  );
  assertEquals(markResponse.device_id, deviceId);

  const statusResponse = await callDevicesEndpoint<DeviceStatusResponse>(
    firstUser.tokens,
    functionsBase,
    `/ingredicheck/devices/${deviceId}/is-internal`,
  );
  assertEquals(statusResponse.is_internal, true);
  assertEquals(
    await getUserIsInternal(serviceClient, firstUser.userId),
    true,
  );

  const secondUser = await signInAnonymously(baseUrl, anonKey);
  const secondRegister = await callDevicesEndpoint<DeviceRegisterResponse>(
    secondUser.tokens,
    functionsBase,
    "/ingredicheck/devices/register",
    {
      method: "POST",
      body: { deviceId },
    },
  );
  assertEquals(secondRegister.is_internal, true);
  assertEquals(
    await getUserIsInternal(serviceClient, secondUser.userId),
    true,
  );

  const logins = await serviceClient
    .from("device_user_logins")
    .select("user_id")
    .eq("device_id", deviceId);
  if (logins.error) {
    throw new Error(`Failed to query device logins: ${logins.error.message}`);
  }
  const loginUserIds = (logins.data ?? []).map((row) => row.user_id);
  assertEquals(loginUserIds.length, 2);
  assertArrayIncludes(loginUserIds, [firstUser.userId, secondUser.userId]);
  },
});

Deno.test({
  name: "device tracking: cannot mark device owned by another user",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const config = await resolveSupabaseConfig();
    const baseUrl = config.baseUrl;
    const anonKey = config.anonKey;
    const functionsBase = functionsUrl(baseUrl);
    const serviceClient = createSupabaseServiceClient({ baseUrl });

    const ownerAccount = await signInAnonymously(baseUrl, anonKey);
    const intruderAccount = await signInAnonymously(baseUrl, anonKey);
    const deviceId = crypto.randomUUID();

    // Owner registers the device so the association exists in device_user_logins.
    const registerResponse = await callDevicesEndpoint<DeviceRegisterResponse>(
      ownerAccount.tokens,
      functionsBase,
      "/ingredicheck/devices/register",
      {
        method: "POST",
        body: { deviceId },
      },
    );
    assertEquals(registerResponse.is_internal, false);

    // Intruder attempts to mark the owner's device as internal.
    const headers = buildAuthHeaders(
      intruderAccount.tokens,
      undefined,
      { acceptJson: true },
    );
    headers.set("Content-Type", "application/json");
    const resp = await fetch(
      `${functionsBase}/ingredicheck/devices/mark-internal`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ deviceId }),
      },
    );

    const respBodyText = await resp.text();
    let parsedResp: unknown;
    try {
      parsedResp = respBodyText.length > 0 ? JSON.parse(respBodyText) : undefined;
    } catch (_error) {
      parsedResp = undefined;
    }
    assertEquals(resp.status, 403);
    assertEquals((parsedResp as Record<string, unknown>)?.error, "Device does not belong to the authenticated user");

    // Ensure no internal status changes occurred for either account.
    assertEquals(
      await getUserIsInternal(serviceClient, ownerAccount.userId),
      false,
    );
    assertEquals(
      await getUserIsInternal(serviceClient, intruderAccount.userId),
      false,
    );
    const statusResponse = await callDevicesEndpoint<DeviceStatusResponse>(
      ownerAccount.tokens,
      functionsBase,
      `/ingredicheck/devices/${deviceId}/is-internal`,
    );
    assertEquals(statusResponse.is_internal, false);
  },
});

Deno.test({
  name: "device tracking: device status requires auth and ownership",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const config = await resolveSupabaseConfig();
    const baseUrl = config.baseUrl;
    const anonKey = config.anonKey;
    const functionsBase = functionsUrl(baseUrl);

    const ownerAccount = await signInAnonymously(baseUrl, anonKey);
    const intruderAccount = await signInAnonymously(baseUrl, anonKey);
    const deviceId = crypto.randomUUID();

    // Owner registers the device.
    await callDevicesEndpoint<DeviceRegisterResponse>(
      ownerAccount.tokens,
      functionsBase,
      "/ingredicheck/devices/register",
      {
        method: "POST",
        body: { deviceId },
      },
    );

    // Unauthenticated request should be rejected.
    const unauthHeaders = new Headers({
      "apikey": anonKey,
      "Accept": "application/json",
    });
    const unauthResp = await fetch(
      `${functionsBase}/ingredicheck/devices/${deviceId}/is-internal`,
      { headers: unauthHeaders },
    );
    const unauthText = await unauthResp.text();
    const unauthParsed = unauthText.length > 0 ? JSON.parse(unauthText) : undefined;
    assertEquals(unauthResp.status, 401);
    const errorPayload = unauthParsed as Record<string, unknown> | undefined;
    const unauthorizedMessage = typeof errorPayload?.error === "string"
      ? errorPayload.error
      : typeof errorPayload?.msg === "string"
      ? errorPayload.msg
      : undefined;
    assert(
      unauthorizedMessage === "Unauthorized" ||
        unauthorizedMessage === "Error: Missing authorization header",
      `Unexpected unauthorized response message: ${
        unauthorizedMessage ?? "undefined"
      }`,
    );

    // Authenticated user without ownership should get 403.
    const unauthorizedHeaders = buildAuthHeaders(
      intruderAccount.tokens,
      undefined,
      { acceptJson: true },
    );
    const unauthorizedResp = await fetch(
      `${functionsBase}/ingredicheck/devices/${deviceId}/is-internal`,
      { headers: unauthorizedHeaders },
    );
    const unauthorizedText = await unauthorizedResp.text();
    const unauthorizedParsed = unauthorizedText.length > 0
      ? JSON.parse(unauthorizedText)
      : undefined;
    assertEquals(unauthorizedResp.status, 403);
    assertEquals(
      (unauthorizedParsed as Record<string, unknown>)?.error,
      "Device does not belong to the authenticated user",
    );
  },
});

Deno.test({
  name: "device tracking: register with markInternal promotes immediately",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const config = await resolveSupabaseConfig();
    const baseUrl = config.baseUrl;
    const anonKey = config.anonKey;
    const functionsBase = functionsUrl(baseUrl);
    const serviceClient = createSupabaseServiceClient({ baseUrl });

    const testerAccount = await signInAnonymously(baseUrl, anonKey);
    const deviceId = crypto.randomUUID();

    const registerResponse = await callDevicesEndpoint<DeviceRegisterResponse>(
      testerAccount.tokens,
      functionsBase,
      "/ingredicheck/devices/register",
      {
        method: "POST",
        body: { deviceId, markInternal: true },
      },
    );

    assertEquals(registerResponse.is_internal, true);

    const statusResponse = await callDevicesEndpoint<DeviceStatusResponse>(
      testerAccount.tokens,
      functionsBase,
      `/ingredicheck/devices/${deviceId}/is-internal`,
    );
    assertEquals(statusResponse.is_internal, true);

    assertEquals(
      await getUserIsInternal(serviceClient, testerAccount.userId),
      true,
    );
  },
});
