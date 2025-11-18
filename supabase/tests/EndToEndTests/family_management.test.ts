import { functionsUrl, signInAnon } from "../_shared/utils.ts";

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      message ?? `Assertion failed: expected ${expected}, received ${actual}`,
    );
  }
}

function assertNotEquals<T>(actual: T, expected: T, message?: string): void {
  if (Object.is(actual, expected)) {
    throw new Error(
      message ?? `Assertion failed: expected values to differ (${actual})`,
    );
  }
}

type FamilyCallOptionsBase = {
  accessToken: string;
  baseUrl: string;
  path: string;
  method?: string;
  body?: unknown;
  expectStatus?: number;
  headers?: HeadersInit;
};

type FamilyCallOptionsJson<T> = FamilyCallOptionsBase & {
  parseJson: true;
};

type FamilyCallOptionsText = FamilyCallOptionsBase & {
  parseJson?: false;
};

type FamilyCallResult<T> = {
  status: number;
  data: T | string;
};

async function callFamily<T>(
  options: FamilyCallOptionsJson<T>,
): Promise<{ status: number; data: T }>;
async function callFamily(
  options: FamilyCallOptionsText,
): Promise<{ status: number; data: string }>;
async function callFamily<T>(
  options: FamilyCallOptionsJson<T> | FamilyCallOptionsText,
): Promise<FamilyCallResult<T>> {
  const {
    accessToken,
    baseUrl,
    body,
    headers,
    method = "GET",
    path,
    expectStatus,
  } = options;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${functionsUrl(baseUrl)}${normalizedPath}`;
  const requestHeaders = new Headers(headers ?? {});
  requestHeaders.set("Authorization", `Bearer ${accessToken}`);

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }

  const resp = await fetch(url, {
    method,
    headers: requestHeaders,
    body: payload,
  });
  if (expectStatus !== undefined && resp.status !== expectStatus) {
    const errorText = await resp.text();
    throw new Error(
      `${method} ${normalizedPath} expected ${expectStatus} but received ${resp.status}: ${errorText}`,
    );
  }

  if ("parseJson" in options && options.parseJson) {
    const data = await resp.json() as T;
    return { status: resp.status, data };
  }

  const text = await resp.text();
  return { status: resp.status, data: text };
}

Deno.test("family management: create and retrieve household", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const createBody = {
    name: "Morgan Household",
    selfMember: {
      id: crypto.randomUUID(),
      name: "Morgan Shaw",
      nicknames: ["Mo"],
      info: "Account owner",
      color: "#264653",
    },
    otherMembers: [{
      id: crypto.randomUUID(),
      name: "Alex Shaw",
      color: "#2A9D8F",
    }],
  };

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: createBody,
    expectStatus: 201,
  });

  const { data } = await callFamily<{ selfMember?: { joined?: boolean } }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(data?.selfMember?.joined, true);
});

Deno.test("family management: member lifecycle CRUD", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const selfId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Lifecycle",
      selfMember: { id: selfId, name: "Owner", color: "#000000" },
    },
    expectStatus: 201,
  });

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/members",
    method: "POST",
    body: { id: memberId, name: "Member", color: "#FF0000" },
    expectStatus: 201,
  });

  await callFamily({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}`,
    method: "PATCH",
    body: { name: "Member v2", color: "#00FF00" },
    expectStatus: 200,
  });

  await callFamily({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}`,
    method: "DELETE",
    expectStatus: 200,
  });
});

Deno.test("family management: invite + join flow", async () => {
  const owner = await signInAnon();
  const invited = await signInAnon();
  const ownerSelfId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  await callFamily({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Team Alpha",
      selfMember: { id: ownerSelfId, name: "User A", color: "#111111" },
      otherMembers: [{ id: memberId, name: "User B", color: "#222222" }],
    },
    expectStatus: 201,
  });

  const invite = await callFamily<{ inviteCode?: string }>({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: memberId },
    expectStatus: 201,
    parseJson: true,
  });

  const inviteCode = invite.data?.inviteCode ?? "";
  assertNotEquals(inviteCode.length, 0);

  const join = await callFamily<{ selfMember?: { joined?: boolean } }>({
    accessToken: invited.accessToken,
    baseUrl: invited.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode },
    expectStatus: 201,
    parseJson: true,
  });

  assertEquals(join.data?.selfMember?.joined, true);
});

Deno.test("family management: leave household removes access", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const selfId = crypto.randomUUID();

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Gamma",
      selfMember: { id: selfId, name: "Leaver", color: "#123456" },
    },
    expectStatus: 201,
  });

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/leave",
    method: "POST",
    expectStatus: 200,
  });

  const postLeave = await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
  });

  assertNotEquals(postLeave.status, 200);
});

Deno.test("family management: validation and guard rails", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/members",
    method: "POST",
    body: { id: "bad-id", name: "X", color: "#000000" },
    expectStatus: 400,
  });

  const selfId = crypto.randomUUID();
  const otherId = crypto.randomUUID();

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Delta",
      selfMember: { id: selfId, name: "Owner", color: "#111111" },
    },
    expectStatus: 201,
  });

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/members",
    method: "POST",
    body: { id: otherId, name: "Kid", color: "#ff0000" },
    expectStatus: 201,
  });

  const duplicate = await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/members",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "Kid", color: "#00ff00" },
  });
  assertNotEquals(duplicate.status, 201);

  const deleteSelf = await callFamily({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${selfId}`,
    method: "DELETE",
  });
  assertNotEquals(deleteSelf.status, 200);

  const joinInvalid = await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: "invalid" },
  });
  assertNotEquals(joinInvalid.status, 201);
});
