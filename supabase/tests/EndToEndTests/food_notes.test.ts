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

function assertDeepEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ?? `Assertion failed: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

type CallOptions = {
  accessToken: string;
  baseUrl: string;
  path: string;
  method?: string;
  body?: unknown;
  expectStatus?: number;
};

async function call<T>(options: CallOptions & { parseJson: true }): Promise<{ status: number; data: T }>;
async function call(options: CallOptions & { parseJson?: false }): Promise<{ status: number; data: string }>;
async function call<T>(options: CallOptions & { parseJson?: boolean }): Promise<{ status: number; data: T | string }> {
  const { accessToken, baseUrl, body, method = "GET", path, expectStatus, parseJson } = options;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${functionsUrl(baseUrl)}${normalizedPath}`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${accessToken}`);

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }

  const resp = await fetch(url, { method, headers, body: payload });
  if (expectStatus !== undefined && resp.status !== expectStatus) {
    const errorText = await resp.text();
    throw new Error(`${method} ${normalizedPath} expected ${expectStatus} but received ${resp.status}: ${errorText}`);
  }

  if (parseJson) {
    const data = await resp.json() as T;
    return { status: resp.status, data };
  }

  const text = await resp.text();
  return { status: resp.status, data: text };
}

// =============================================================================
// Multi-Member Family Tests
// =============================================================================

Deno.test("food notes: get all food notes", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const selfId = crypto.randomUUID();
  const otherId = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: selfId, name: "Self", color: "#000000" },
      otherMembers: [{ id: otherId, name: "Other", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Set self member note
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${selfId}/food-notes`,
    method: "PUT",
    body: { content: { diet: "self" }, version: 0 },
    expectStatus: 200,
  });

  // Set other member note
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${otherId}/food-notes`,
    method: "PUT",
    body: { content: { diet: "other" }, version: 0 },
    expectStatus: 200,
  });

  // Set family note
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { shared: true }, version: 0 },
    expectStatus: 200,
  });

  // Get all food notes
  const { data } = await call<{
    familyNote: { content: unknown } | null;
    memberNotes: Record<string, { content: unknown }>;
  }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes/all",
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(data?.familyNote?.content, { shared: true }, "Family note content should match");
  assertEquals(Object.keys(data?.memberNotes ?? {}).length, 2, "Should have 2 member notes");
  assertDeepEquals(data?.memberNotes?.[selfId]?.content, { diet: "self" }, "Self member note should match");
  assertDeepEquals(data?.memberNotes?.[otherId]?.content, { diet: "other" }, "Other member note should match");
});

Deno.test("food notes: family-level food note CRUD", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Multi Family",
      selfMember: { id: crypto.randomUUID(), name: "Self", color: "#000000" },
      otherMembers: [{ id: crypto.randomUUID(), name: "Other", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Create family note
  const { data: created } = await call<{ content: unknown; version: number }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { rule: "no nuts" }, version: 0 },
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(created?.version, 1, "Created version should be 1");

  // Update family note
  const { data: updated } = await call<{ content: unknown; version: number }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { rule: "no dairy" }, version: 1 },
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(updated?.version, 2, "Updated version should be 2");
  assertDeepEquals(updated?.content, { rule: "no dairy" }, "Content should be updated");
});

Deno.test("food notes: member food note CRUD", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const memberId = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Self", color: "#000000" },
      otherMembers: [{ id: memberId, name: "Other", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Set note for other member
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    method: "PUT",
    body: { content: { likes: "pizza" }, version: 0 },
    expectStatus: 200,
  });

  // Get note for other member
  const { data } = await call<{ content: unknown }>({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(data?.content, { likes: "pizza" }, "Member note content should match");
});

Deno.test("food notes: optimistic locking - version mismatch returns 409 with current note", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    },
    expectStatus: 201,
  });

  // Create note
  const originalContent = { v: 1, data: "original" };
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: originalContent, version: 0 },
    expectStatus: 200,
  });

  // Try to update with wrong version - should get 409 with current note
  const { status, data } = await call<{ error: string; currentNote: { content: unknown; version: number; updatedAt: string } }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: 2 }, version: 0 },
    parseJson: true,
  });

  assertEquals(status, 409, "Should return 409 Conflict");
  assertEquals(data?.error, "version_mismatch", "Error should be version_mismatch");
  assertDeepEquals(data?.currentNote?.content, originalContent, "Current note content should match");
  assertEquals(data?.currentNote?.version, 1, "Current note version should be 1");
  assertNotEquals(data?.currentNote?.updatedAt, undefined, "Current note should have updatedAt");
});

Deno.test("food notes: optimistic locking - member note version mismatch returns 409", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const memberId = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Self", color: "#000000" },
      otherMembers: [{ id: memberId, name: "Other", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Create member note
  const originalContent = { diet: "vegan" };
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    method: "PUT",
    body: { content: originalContent, version: 0 },
    expectStatus: 200,
  });

  // Try to update with wrong version
  const { status, data } = await call<{ error: string; currentNote: { content: unknown; version: number } }>({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    method: "PUT",
    body: { content: { diet: "keto" }, version: 0 },
    parseJson: true,
  });

  assertEquals(status, 409, "Should return 409 Conflict");
  assertEquals(data?.error, "version_mismatch", "Error should be version_mismatch");
  assertDeepEquals(data?.currentNote?.content, originalContent, "Current note should contain original content");
});

Deno.test("food notes: optimistic locking - client can retry with correct version", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    },
    expectStatus: 201,
  });

  // Create note v1
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: 1 }, version: 0 },
    expectStatus: 200,
  });

  // First client tries to update with stale version 0 - gets conflict with current state
  const { data: conflictData } = await call<{ error: string; currentNote: { version: number } }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: "stale_update" }, version: 0 },
    expectStatus: 409,
    parseJson: true,
  });

  // Client retries with correct version from conflict response
  const { data: retryResult } = await call<{ content: unknown; version: number }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: "retry_success" }, version: conflictData?.currentNote?.version ?? 1 },
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(retryResult?.version, 2, "Retry should succeed with version 2");
  assertDeepEquals(retryResult?.content, { v: "retry_success" }, "Content should be updated");
});

Deno.test("food notes: optimistic locking - creating new note with non-zero version fails", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    },
    expectStatus: 201,
  });

  // Try to create note with non-zero version
  const { status, data } = await call<{ error: string; currentNote: null }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: 1 }, version: 5 },
    parseJson: true,
  });

  assertEquals(status, 409, "Should return 409 Conflict");
  assertEquals(data?.error, "version_mismatch", "Error should be version_mismatch");
  assertEquals(data?.currentNote, null, "Current note should be null since no note exists");
});

Deno.test("food notes: optimistic locking - client behind by multiple versions", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    },
    expectStatus: 201,
  });

  // Create note and update multiple times
  for (let i = 0; i < 5; i++) {
    await call({
      accessToken,
      baseUrl,
      path: "/ingredicheck/family/food-notes",
      method: "PUT",
      body: { content: { iteration: i + 1 }, version: i },
      expectStatus: 200,
    });
  }

  // Client tries to update with very old version
  const { status, data } = await call<{ error: string; currentNote: { content: unknown; version: number } }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { stale: true }, version: 1 },
    parseJson: true,
  });

  assertEquals(status, 409, "Should return 409 Conflict");
  assertEquals(data?.currentNote?.version, 5, "Should return current version 5");
  assertDeepEquals(data?.currentNote?.content, { iteration: 5 }, "Should return latest content");
});

Deno.test("food notes: concurrent updates - second update fails with current state", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    },
    expectStatus: 201,
  });

  // Create initial note
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { initial: true }, version: 0 },
    expectStatus: 200,
  });

  // Simulate concurrent updates by making two requests with the same version
  // First update succeeds
  const { data: firstResult } = await call<{ content: unknown; version: number }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { updatedBy: "first" }, version: 1 },
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(firstResult?.version, 2, "First update should succeed with version 2");

  // Second update with same original version fails
  const { status, data: secondResult } = await call<{ error: string; currentNote: { content: unknown; version: number } }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { updatedBy: "second" }, version: 1 },
    parseJson: true,
  });

  assertEquals(status, 409, "Second update should return 409");
  assertDeepEquals(secondResult?.currentNote?.content, { updatedBy: "first" }, "Should return first update's content");
  assertEquals(secondResult?.currentNote?.version, 2, "Should return version from first update");
});

Deno.test("food notes: concurrent updates from different users in same family", async () => {
  const alice = await signInAnon();
  const bob = await signInAnon();
  const aliceId = crypto.randomUUID();
  const bobId = crypto.randomUUID();

  // Alice creates family
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family",
      selfMember: { id: aliceId, name: "Alice", color: "#000000" },
      otherMembers: [{ id: bobId, name: "Bob", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Alice invites Bob
  const { data: invite } = await call<{ inviteCode: string }>({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: bobId },
    expectStatus: 201,
    parseJson: true,
  });

  // Bob joins
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite?.inviteCode },
    expectStatus: 201,
  });

  // Alice creates family note
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { by: "alice", version: "initial" }, version: 0 },
    expectStatus: 200,
  });

  // Both Alice and Bob read the note (both have version 1)
  // Alice updates first
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { by: "alice", version: "updated" }, version: 1 },
    expectStatus: 200,
  });

  // Bob tries to update with stale version
  const { status, data } = await call<{ error: string; currentNote: { content: { by: string } } }>({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { by: "bob" }, version: 1 },
    parseJson: true,
  });

  assertEquals(status, 409, "Bob's update should fail with 409");
  assertEquals(data?.currentNote?.content?.by, "alice", "Current note should show Alice's update");
});

Deno.test("food notes: unjoined member can have notes", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const unjoinedId = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family",
      selfMember: { id: crypto.randomUUID(), name: "Owner", color: "#000000" },
      otherMembers: [{ id: unjoinedId, name: "Child", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Set note for unjoined member
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${unjoinedId}/food-notes`,
    method: "PUT",
    body: { content: { allergies: ["milk"] }, version: 0 },
    expectStatus: 200,
  });

  // Get note for unjoined member
  const { data } = await call<{ content: unknown }>({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${unjoinedId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(data?.content, { allergies: ["milk"] }, "Unjoined member note should be accessible");
});

// =============================================================================
// Join/Leave Note Copying Tests
// =============================================================================

Deno.test("food notes: leave family creates new single-member family with notes", async () => {
  const user1 = await signInAnon();
  const user2 = await signInAnon();
  const user1MemberId = crypto.randomUUID();
  const user2MemberId = crypto.randomUUID();

  // User1 creates family with placeholder for user2
  await call({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Multi-Member Family",
      selfMember: { id: user1MemberId, name: "User1", color: "#264653" },
      otherMembers: [{ id: user2MemberId, name: "User2", color: "#000000" }],
    },
    expectStatus: 201,
  });

  // Create invite for user2
  const { data: invite } = await call<{ inviteCode: string }>({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: user2MemberId },
    expectStatus: 201,
    parseJson: true,
  });

  // User2 joins the family
  await call({
    accessToken: user2.accessToken,
    baseUrl: user2.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite?.inviteCode },
    expectStatus: 201,
  });

  // Set food note for user1
  const noteContent = { diet: "vegan" };
  await call({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: `/ingredicheck/family/members/${user1MemberId}/food-notes`,
    method: "PUT",
    body: { content: noteContent, version: 0 },
    expectStatus: 200,
  });

  // User1 leaves family (should create new single-member family)
  await call({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family/leave",
    method: "POST",
    expectStatus: 200,
  });

  // Verify user1 is in a new family with notes copied
  const { data: newFamily } = await call<{ selfMember?: { id?: string; name?: string } }>({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: "/ingredicheck/family",
    expectStatus: 200,
    parseJson: true,
  });

  assertNotEquals(newFamily?.selfMember?.id, user1MemberId, "Should be in a new family with different member ID");

  // Check that notes were copied
  const { data: note } = await call<{ content: unknown }>({
    accessToken: user1.accessToken,
    baseUrl: user1.baseUrl,
    path: `/ingredicheck/family/members/${newFamily?.selfMember?.id}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(note?.content, noteContent, "Notes should be copied to new family");
});

Deno.test("food notes: cannot leave family if only active member", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Solo Family",
      selfMember: { id: crypto.randomUUID(), name: "Owner", color: "#000000" },
    },
    expectStatus: 201,
  });

  // Try to leave - should fail since user is only member
  const { status } = await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/leave",
    method: "POST",
  });

  assertNotEquals(status, 200, "Should not be able to leave when only active member");
});

Deno.test("food notes: join family copies notes from single-member family (Bob wins)", async () => {
  const bob = await signInAnon();
  const alice = await signInAnon();
  const bobSingleMemberId = crypto.randomUUID();
  const bobInAliceFamilyId = crypto.randomUUID();

  // Bob creates single-member family with note
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Bob's Family",
      selfMember: { id: bobSingleMemberId, name: "Bob", color: "#264653" },
    },
    expectStatus: 201,
  });

  const bobNote = { diet: "Bob's preferences" };
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: `/ingredicheck/family/members/${bobSingleMemberId}/food-notes`,
    method: "PUT",
    body: { content: bobNote, version: 0 },
    expectStatus: 200,
  });

  // Alice creates family with Bob placeholder member
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Alice Family",
      selfMember: { id: crypto.randomUUID(), name: "Alice", color: "#000000" },
      otherMembers: [{ id: bobInAliceFamilyId, name: "Bob", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Alice sets note for Bob
  const aliceNoteForBob = { diet: "Alice thinks Bob likes pizza" };
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: `/ingredicheck/family/members/${bobInAliceFamilyId}/food-notes`,
    method: "PUT",
    body: { content: aliceNoteForBob, version: 0 },
    expectStatus: 200,
  });

  // Alice invites Bob
  const { data: invite } = await call<{ inviteCode: string }>({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: bobInAliceFamilyId },
    expectStatus: 201,
    parseJson: true,
  });

  // Bob joins Alice's family
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite?.inviteCode },
    expectStatus: 201,
  });

  // Check Bob's member note in Alice's family - should be Bob's personal note (Bob wins)
  // Note: In multi-member family, auto-detect returns family note, so we check member note directly
  const { data: bobMemberNote } = await call<{ content: unknown }>({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: `/ingredicheck/family/members/${bobInAliceFamilyId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(bobMemberNote?.content, bobNote, "Bob's note should be his note from single-member family (Bob wins)");

  // Check history - Alice's note should be preserved
  const { data: history } = await call<Array<{ content: unknown }>>({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: `/ingredicheck/family/members/${bobInAliceFamilyId}/food-notes/history`,
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(history?.length, 1, "Should have 1 history entry (Alice's note)");
  assertDeepEquals(history?.[0]?.content, aliceNoteForBob, "History should contain Alice's original note");
});

Deno.test("food notes: join family from new user - no copy", async () => {
  const user = await signInAnon();
  const owner = await signInAnon();
  const memberId = crypto.randomUUID();

  // User has NO existing family

  // Owner creates family with member for user
  await call({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Owner Family",
      selfMember: { id: crypto.randomUUID(), name: "Owner", color: "#000000" },
      otherMembers: [{ id: memberId, name: "User", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Owner sets note for user's member
  const ownerNote = { diet: "Owner's note" };
  await call({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    method: "PUT",
    body: { content: ownerNote, version: 0 },
    expectStatus: 200,
  });

  // Owner invites user
  const { data: invite } = await call<{ inviteCode: string }>({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: memberId },
    expectStatus: 201,
    parseJson: true,
  });

  // User joins
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite?.inviteCode },
    expectStatus: 201,
  });

  // Check note - should still be owner's note since user had no existing family
  const { data: note } = await call<{ content: unknown }>({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(note?.content, ownerNote, "Note should be owner's note (user had no existing family)");
});

// =============================================================================
// History Tests
// =============================================================================

Deno.test("food notes: history pruning to 10 entries", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Test Family",
      selfMember: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    },
    expectStatus: 201,
  });

  // Create 12 versions
  for (let i = 0; i < 12; i++) {
    await call({
      accessToken,
      baseUrl,
      path: "/ingredicheck/family/food-notes",
      method: "PUT",
      body: { content: { version: i + 1 }, version: i },
      expectStatus: 200,
    });
  }

  // Get history
  const { data: history } = await call<Array<{ version: number }>>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes/history?limit=20",
    expectStatus: 200,
    parseJson: true,
  });

  // Should have 10 entries (11 versions created, current is v12, history has v11-v2)
  assertEquals(history?.length, 10, "Should have exactly 10 history entries");
  assertEquals(history?.[0]?.version, 11, "Newest history entry should be v11");
  assertEquals(history?.[9]?.version, 2, "Oldest history entry should be v2 (v1 pruned)");
});

Deno.test("food notes: history preserves changed_by_member_id", async () => {
  const alice = await signInAnon();
  const bob = await signInAnon();
  const aliceId = crypto.randomUUID();
  const bobId = crypto.randomUUID();

  // Alice creates family
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family",
      selfMember: { id: aliceId, name: "Alice", color: "#000000" },
      otherMembers: [{ id: bobId, name: "Bob", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Alice sets family note
  await call({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { by: "alice" }, version: 0 },
    expectStatus: 200,
  });

  // Bob joins
  const { data: invite } = await call<{ inviteCode: string }>({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: bobId },
    expectStatus: 201,
    parseJson: true,
  });

  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite?.inviteCode },
    expectStatus: 201,
  });

  // Bob updates family note
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { by: "bob" }, version: 1 },
    expectStatus: 200,
  });

  // Get history
  const { data: history } = await call<Array<{ changedByMemberId: string }>>({
    accessToken: alice.accessToken,
    baseUrl: alice.baseUrl,
    path: "/ingredicheck/family/food-notes/history",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(history?.length, 1, "Should have 1 history entry");
  assertEquals(history?.[0]?.changedByMemberId, bobId, "History should show Bob as the one who made the change");
});

// =============================================================================
// Validation Tests
// =============================================================================

Deno.test("food notes: cannot get/set note for member in different family", async () => {
  const userA = await signInAnon();
  const userB = await signInAnon();
  const memberInFamilyB = crypto.randomUUID();

  // User A creates family
  await call({
    accessToken: userA.accessToken,
    baseUrl: userA.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family A",
      selfMember: { id: crypto.randomUUID(), name: "A", color: "#000000" },
    },
    expectStatus: 201,
  });

  // User B creates family with a member
  await call({
    accessToken: userB.accessToken,
    baseUrl: userB.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family B",
      selfMember: { id: memberInFamilyB, name: "B", color: "#111111" },
    },
    expectStatus: 201,
  });

  // User A tries to get note for member in Family B
  const { status } = await call({
    accessToken: userA.accessToken,
    baseUrl: userA.baseUrl,
    path: `/ingredicheck/family/members/${memberInFamilyB}/food-notes`,
  });

  assertNotEquals(status, 200, "Should not be able to access note for member in different family");
});

Deno.test("food notes: cannot get/set note without being in a family", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  // Try to get food note without being in a family
  const { status } = await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
  });

  assertNotEquals(status, 200, "Should not be able to get food note without being in a family");
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("food notes: soft-deleted member's notes behavior", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const memberId = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family",
      selfMember: { id: crypto.randomUUID(), name: "Owner", color: "#000000" },
      otherMembers: [{ id: memberId, name: "Deletable", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Set note for member
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    method: "PUT",
    body: { content: { test: "data" }, version: 0 },
    expectStatus: 200,
  });

  // Delete member
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${memberId}`,
    method: "DELETE",
    expectStatus: 200,
  });

  // Get all notes - deleted member's note should not appear
  const { data } = await call<{ memberNotes: Record<string, unknown> }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes/all",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(data?.memberNotes?.[memberId], undefined, "Deleted member's note should not appear in get_all_food_notes");
});

Deno.test("food notes: get all food notes returns empty when no notes exist", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Empty Family",
      selfMember: { id: crypto.randomUUID(), name: "Self", color: "#000000" },
      otherMembers: [{ id: crypto.randomUUID(), name: "Other", color: "#111111" }],
    },
    expectStatus: 201,
  });

  const { data } = await call<{ familyNote: null; memberNotes: Record<string, unknown> }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes/all",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(data?.familyNote, null, "Family note should be null");
  assertDeepEquals(data?.memberNotes, {}, "Member notes should be empty object");
});

Deno.test("food notes: get all returns dictionary with only members that have notes", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const member1 = crypto.randomUUID();
  const member2 = crypto.randomUUID();
  const member3 = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family",
      selfMember: { id: member1, name: "M1", color: "#000000" },
      otherMembers: [
        { id: member2, name: "M2", color: "#111111" },
        { id: member3, name: "M3", color: "#222222" },
      ],
    },
    expectStatus: 201,
  });

  // Set notes for member1 and member3 only
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${member1}/food-notes`,
    method: "PUT",
    body: { content: { who: "m1" }, version: 0 },
    expectStatus: 200,
  });

  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${member3}/food-notes`,
    method: "PUT",
    body: { content: { who: "m3" }, version: 0 },
    expectStatus: 200,
  });

  const { data } = await call<{ memberNotes: Record<string, unknown> }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes/all",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(Object.keys(data?.memberNotes ?? {}).length, 2, "Should have exactly 2 member notes");
  assertNotEquals(data?.memberNotes?.[member1], undefined, "Member1 note should exist");
  assertEquals(data?.memberNotes?.[member2], undefined, "Member2 note should not exist");
  assertNotEquals(data?.memberNotes?.[member3], undefined, "Member3 note should exist");
});

Deno.test("food notes: copied note does not include history", async () => {
  const user = await signInAnon();
  const owner = await signInAnon();
  const userMemberId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  // User creates single-member family and edits note multiple times
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "User's Family",
      selfMember: { id: userMemberId, name: "User", color: "#264653" },
    },
    expectStatus: 201,
  });

  for (let i = 0; i < 5; i++) {
    await call({
      accessToken: user.accessToken,
      baseUrl: user.baseUrl,
      path: `/ingredicheck/family/members/${userMemberId}/food-notes`,
      method: "PUT",
      body: { content: { edit: i + 1 }, version: i },
      expectStatus: 200,
    });
  }

  // Owner creates family with user placeholder
  await call({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Owner Family",
      selfMember: { id: crypto.randomUUID(), name: "Owner", color: "#000000" },
      otherMembers: [{ id: memberId, name: "User", color: "#111111" }],
    },
    expectStatus: 201,
  });

  // Owner invites user
  const { data: invite } = await call<{ inviteCode: string }>({
    accessToken: owner.accessToken,
    baseUrl: owner.baseUrl,
    path: "/ingredicheck/family/invite",
    method: "POST",
    body: { memberID: memberId },
    expectStatus: 201,
    parseJson: true,
  });

  // User joins
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family/join",
    method: "POST",
    body: { inviteCode: invite?.inviteCode },
    expectStatus: 201,
  });

  // Check note version - should be 1 (reset)
  const { data: note } = await call<{ version: number }>({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(note?.version, 1, "Copied note version should be reset to 1");

  // Check history - should be empty (no history copied)
  const { data: history } = await call<Array<unknown>>({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes/history`,
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(history?.length, 0, "Copied note should have no history");
});

Deno.test("food notes: only unjoined members can be removed", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const selfId = crypto.randomUUID();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Family",
      selfMember: { id: selfId, name: "Self", color: "#000000" },
    },
    expectStatus: 201,
  });

  // Set note for self
  await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${selfId}/food-notes`,
    method: "PUT",
    body: { content: { test: "data" }, version: 0 },
    expectStatus: 200,
  });

  // Try to delete self (joined member) - should fail
  const { status } = await call({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${selfId}`,
    method: "DELETE",
  });

  assertNotEquals(status, 200, "Should not be able to delete joined member");

  // Note should still exist
  const { data: note } = await call<{ content: unknown }>({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${selfId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(note?.content, { test: "data" }, "Note should still exist after failed deletion");
});
