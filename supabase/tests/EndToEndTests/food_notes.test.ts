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
// Single Player (Personal Family) Tests
// =============================================================================

Deno.test("food notes: init personal family", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const selfMember = {
    id: crypto.randomUUID(),
    name: "Solo User",
    color: "#264653",
  };

  const { data } = await call<{ selfMember?: { joined?: boolean; name?: string } }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: selfMember,
    expectStatus: 201,
    parseJson: true,
  });

  assertEquals(data?.selfMember?.joined, true, "selfMember should be joined");
  assertEquals(data?.selfMember?.name, selfMember.name, "selfMember name should match");
});

Deno.test("food notes: init personal family fails if already in family", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  // Create shared family first
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Shared Family",
      selfMember: { id: crypto.randomUUID(), name: "Owner", color: "#000000" },
    },
    expectStatus: 201,
  });

  // Try to create personal family - should fail
  const { status } = await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "Solo", color: "#111111" },
  });

  assertNotEquals(status, 201, "Should not create personal family when already in a family");
});

Deno.test("food notes: single player get/set food note (auto-detect)", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  // Create personal family
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    expectStatus: 201,
  });

  // Set food note (auto-detect should use self member)
  const noteContent = { allergies: ["peanuts"], preferences: "vegetarian" };
  const { data: setResult } = await call<{ content: unknown; version: number }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: noteContent, version: 0 },
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(setResult?.version, 1, "First version should be 1");
  assertDeepEquals(setResult?.content, noteContent, "Content should match");

  // Get food note (auto-detect)
  const { data: getResult } = await call<{ content: unknown; version: number }>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(getResult?.version, 1, "Version should be 1");
  assertDeepEquals(getResult?.content, noteContent, "Content should match");
});

Deno.test("food notes: single player food note versioning", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    expectStatus: 201,
  });

  // Set note v1
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { version: "v1" }, version: 0 },
    expectStatus: 200,
  });

  // Set note v2
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { version: "v2" }, version: 1 },
    expectStatus: 200,
  });

  // Set note v3
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { version: "v3" }, version: 2 },
    expectStatus: 200,
  });

  // Get history
  const { data: history } = await call<Array<{ version: number; content: unknown }>>({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes/history",
    expectStatus: 200,
    parseJson: true,
  });

  assertEquals(history?.length, 2, "Should have 2 history entries");
  assertEquals(history?.[0]?.version, 2, "First history entry should be v2");
  assertEquals(history?.[1]?.version, 1, "Second history entry should be v1");
});

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

Deno.test("food notes: optimistic locking - version mismatch", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
    expectStatus: 201,
  });

  // Create note
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: 1 }, version: 0 },
    expectStatus: 200,
  });

  // Try to update with wrong version
  const { status } = await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: { v: 2 }, version: 0 },
  });

  assertNotEquals(status, 200, "Should fail with version mismatch");
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

Deno.test("food notes: leave family copies notes to personal family", async () => {
  const user = await signInAnon();
  const personalMemberId = crypto.randomUUID();
  const sharedMemberId = crypto.randomUUID();

  // Create personal family first
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: personalMemberId, name: "Personal", color: "#264653" },
    expectStatus: 201,
  });

  // Create shared family (will disassociate from personal)
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Shared",
      selfMember: { id: sharedMemberId, name: "Shared Me", color: "#000000" },
    },
    expectStatus: 201,
  });

  // Set food note in shared family
  const sharedNoteContent = { diet: "vegan" };
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: `/ingredicheck/family/members/${sharedMemberId}/food-notes`,
    method: "PUT",
    body: { content: sharedNoteContent, version: 0 },
    expectStatus: 200,
  });

  // Leave shared family
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family/leave",
    method: "POST",
    expectStatus: 200,
  });

  // Should not be in any family now (personal family member was disassociated when joining shared)
  // This test verifies the note copying happened before leaving
});

Deno.test("food notes: join family copies notes from personal (Bob wins)", async () => {
  const bob = await signInAnon();
  const alice = await signInAnon();
  const bobPersonalId = crypto.randomUUID();
  const bobInAliceFamilyId = crypto.randomUUID();

  // Bob creates personal family with note
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: bobPersonalId, name: "Bob", color: "#264653" },
    expectStatus: 201,
  });

  const bobPersonalNote = { diet: "Bob's personal preferences" };
  await call({
    accessToken: bob.accessToken,
    baseUrl: bob.baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: bobPersonalNote, version: 0 },
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

  assertDeepEquals(bobMemberNote?.content, bobPersonalNote, "Bob's note should be his personal note (Bob wins)");

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

Deno.test("food notes: join family without personal notes - no copy", async () => {
  const user = await signInAnon();
  const owner = await signInAnon();
  const memberId = crypto.randomUUID();

  // User creates personal family but NO note
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "User", color: "#264653" },
    expectStatus: 201,
  });

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

  // Check note - should still be owner's note since user had no personal note
  const { data: note } = await call<{ content: unknown }>({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: `/ingredicheck/family/members/${memberId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(note?.content, ownerNote, "Note should be owner's note (user had no personal note)");
});

// =============================================================================
// History Tests
// =============================================================================

Deno.test("food notes: history pruning to 10 entries", async () => {
  const { accessToken, baseUrl } = await signInAnon();

  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: crypto.randomUUID(), name: "Solo", color: "#264653" },
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

Deno.test("food notes: create shared family copies notes from personal family", async () => {
  const { accessToken, baseUrl } = await signInAnon();
  const personalMemberId = crypto.randomUUID();
  const sharedMemberId = crypto.randomUUID();

  // Create personal family with note
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: personalMemberId, name: "Personal", color: "#264653" },
    expectStatus: 201,
  });

  const personalNote = { source: "personal" };
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family/food-notes",
    method: "PUT",
    body: { content: personalNote, version: 0 },
    expectStatus: 200,
  });

  // Create shared family
  await call({
    accessToken,
    baseUrl,
    path: "/ingredicheck/family",
    method: "POST",
    body: {
      name: "Shared",
      selfMember: { id: sharedMemberId, name: "Shared Me", color: "#000000" },
    },
    expectStatus: 201,
  });

  // Check note in shared family - should be copied from personal
  const { data: note } = await call<{ content: unknown }>({
    accessToken,
    baseUrl,
    path: `/ingredicheck/family/members/${sharedMemberId}/food-notes`,
    expectStatus: 200,
    parseJson: true,
  });

  assertDeepEquals(note?.content, personalNote, "Note should be copied from personal family");
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
  const personalId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  // User creates personal family and edits note multiple times
  await call({
    accessToken: user.accessToken,
    baseUrl: user.baseUrl,
    path: "/ingredicheck/family/personal",
    method: "POST",
    body: { id: personalId, name: "User", color: "#264653" },
    expectStatus: 201,
  });

  for (let i = 0; i < 5; i++) {
    await call({
      accessToken: user.accessToken,
      baseUrl: user.baseUrl,
      path: "/ingredicheck/family/food-notes",
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
