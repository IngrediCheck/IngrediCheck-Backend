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
      color: "#264653",
      imageFileHash: "",
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

Deno.test("family management: get_family returns otherMembers", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const otherMemberId = crypto.randomUUID();
  const otherMemberName = "Test Other Member";
  const otherMemberColor = "#FF5733";
  const otherMemberImageHash = "hash-123";

  await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: {
        id: crypto.randomUUID(),
        name: "Self",
        color: "#000000",
      },
      otherMembers: [{
        id: otherMemberId,
        name: otherMemberName,
        color: otherMemberColor,
        imageFileHash: otherMemberImageHash,
      }],
    },
    expectStatus: 201,
  });

  const { data } = await callFamily<{
    otherMembers?: Array<{ id?: string; name?: string; color?: string; joined?: boolean; imageFileHash?: string }>;
  }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    expectStatus: 200,
    parseJson: true,
  });

  // This assertion would fail with the old RLS policy that only allowed
  // users to see members where user_id = auth.uid()
  assertNotEquals(data?.otherMembers?.length, 0, "otherMembers should not be empty");
  assertEquals(data?.otherMembers?.length, 1, "should have exactly one otherMember");
  assertEquals(data?.otherMembers?.[0]?.id, otherMemberId, "otherMember ID should match");
  assertEquals(data?.otherMembers?.[0]?.name, otherMemberName, "otherMember name should match");
  assertEquals(data?.otherMembers?.[0]?.color, otherMemberColor, "otherMember color should match");
  assertEquals(data?.otherMembers?.[0]?.imageFileHash, otherMemberImageHash, "otherMember imageFileHash should match");
  assertEquals(data?.otherMembers?.[0]?.joined, false, "unassociated member should have joined=false");
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

Deno.test("family management: cannot leave when only active member", async () => {
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

  // Try to leave - should fail since user is only active member
  const leaveResult = await callFamily({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/leave",
    method: "POST",
  });

  assertNotEquals(leaveResult.status, 200, "Should not be able to leave when only active member");
});

Deno.test("family management: leave multi-member family creates new single-member family", async () => {
  const user1 = await signInAnon();
  const user2 = await signInAnon();
  const user1Id = crypto.randomUUID();
  const user2Id = crypto.randomUUID();

  // User1 creates a family with a placeholder for user2
  await callFamily({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Multi Family",
      selfMember: { id: user1Id, name: "User One", color: "#111111" },
      otherMembers: [{ id: user2Id, name: "User Two", color: "#222222" }],
    },
    expectStatus: 201,
  });

  // User1 creates invite for user2
  const invite = await callFamily<{ inviteCode?: string }>({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: user2Id },
    expectStatus: 201,
    parseJson: true,
  });

  // User2 joins the family
  await callFamily({
    accessToken: user2.accessToken,
    baseUrl: user2.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite.data?.inviteCode },
    expectStatus: 201,
  });

  // User1 leaves the family - should succeed since there are 2 active members
  await callFamily({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family/leave",
    method: "POST",
    expectStatus: 200,
  });

  // User1 should now be in a new single-member family
  const user1Family = await callFamily<{ name?: string; otherMembers?: unknown[] }>({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(user1Family.data?.name, "User One", "New family should be named after the user");
  assertEquals(user1Family.data?.otherMembers?.length, 0, "New family should have no other members");
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
