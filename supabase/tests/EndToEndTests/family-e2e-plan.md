# Family End-to-End Testcases Plan

This document captures the concrete plan for building deterministic EndToEnd fixtures that exercise the Supabase `ingredicheck/family` API surface. It complements the general testing README by drilling into the family domain.

## 1. API Catalog

| Endpoint | Method | Required Auth | Payload Fields | Response | Underlying RPC | Notes |
|----------|--------|---------------|----------------|----------|----------------|-------|
| `/family` | `POST` | Service user (anon token) | `name` (string), `selfMember` (member payload), optional `otherMembers[]` | `201` empty body | `create_family` | Fails if caller already tied to a family. `selfMember.id` must be UUID. |
| `/family` | `GET` | Service user (anon token) | – | `200` JSON family object | `get_family` | Raises error if caller not tied to a family. |
| `/family/invite` | `POST` | Service user with existing family membership | `memberID` (UUID) | `201 { inviteCode }` | `create_invite` | Member must be unclaimed slot in same family. |
| `/family/join` | `POST` | Service user (anon token) | `inviteCode` (string) | `201` JSON family object | `join_family` | Caller detached from prior membership before join. Invite must be active. |
| `/family/leave` | `POST` | Service user with family membership | – | `200 { message }` | `leave_family` | Clears `user_id` field for caller. |
| `/family/members` | `POST` | Service user with family membership | Member payload (`id`, `name`, optional `nicknames`, `info`, `color`) | `201` JSON family | `add_member` | Ensures unique name + UUID within family. |
| `/family/members/:id` | `PATCH` | Service user with family membership | Same fields as POST (id optional if path supplies) | `200` JSON family | `edit_member` | Validates name uniqueness and membership. |
| `/family/members/:id` | `DELETE` | Service user with family membership | – | `200` JSON family | `delete_member` | Prohibits deleting self (must call `leave_family`). |

**Member payload shape**

```
{
  "id": "uuid",
  "name": "string",
  "nicknames": ["string"?],
  "info": "string?",
  "color": "#RRGGBB"
}
```

## 2. Scenario Definitions

- `family-create-and-fetch.json`
  - User A signs in anonymously.
  - `POST /family` with deterministic `selfMember` and two seeded `otherMembers` (unclaimed slots).
  - `GET /family` validates structure (self member joined, others unjoined, version monotonic).

- `family-invite-and-join.json`
  - User A (existing family owner) calls `POST /family/invite` targeting a known unclaimed member.
  - Capture invite code (placeholder `{{var:INVITE_CODE}}`).
  - User B signs in separately, `POST /family/join` with placeholder substitution.
  - User B `GET /family` demonstrates joined status on target member, ownership unchanged.

- `family-member-lifecycle.json`
  - User A `POST /family/members` to add new member (fresh UUID placeholder `{{var:NEW_MEMBER_ID}}`).
  - `PATCH /family/members/:id` mutate name, nicknames, info, color.
  - `DELETE /family/members/:id` soft deletes.
  - `GET /family` before/after delete to sanity check membership list.

- `family-leave.json`
  - User B (already joined) hits `POST /family/leave`.
  - Follow-up `GET /family` expected to raise error -> capture `400` (Supabase error) for regression.
  - Optional final `POST /family/join` to reattach if needed for cleanup.

- Negative add-ons (candidate future fixtures)
  - `family-join-expired-invite.json`: produce invite, advance time or patch expiry to fail join.
  - `family-delete-self.json`: attempt delete of self member -> expect `400` error.

## 3. Deterministic Test Data

- **UUIDs**: use placeholders in recordings (`{{var:SELF_MEMBER_ID}}`, `{{var:MEMBER_CHILD_ID}}`, etc.) to allow replay substitution. Seed values from capture session to keep Supabase validation happy.
- **Colors**: choose hex codes from palette (`#1F77B4`, `#FF7F0E`, `#2CA02C`, `#D62728`).
- **Nicknames / Info**: simple strings (`"Sam"`, `"Peanut allergy"`). Avoid dynamic content.
- **Auth identities**:
  - User A: first anonymous user produced by `run-testcase.ts` (owner).
  - User B: second anonymous user captured within same fixture when necessary (invite/join, leave).
- **Variables**: follow existing Replay style (`variables` block at bottom). For secrets like invite code, store as `{{var:INVITE_CODE}}` to bind across requests.

## 4. Capture Strategy

1. Prepare local Supabase via `./local-env.ts setup` (ensures service role + anon keys available for capture client).
2. Use `./capture-testcase.ts "family-<scenario>"` and manually place the exported JSON into `EndToEndTests`.
3. Before recording, seed deterministic IDs using mobile app dev tools or scripted GraphQL where possible; otherwise, edit artifact post capture to inject placeholders.
4. Sequence each scenario in a single uninterrupted session per test file to keep anonymous auth tokens aligned.
5. After capture, move JSON into `supabase/tests/EndToEndTests`, fill `variables` section, and verify with `./run-testcase-endtoend.ts` against the local stack.
6. Update README regression matrix once fixtures land.

## 5. Current Fixtures

- `family-create-and-fetch.json` — baseline family creation and retrieval flow.
- `family-member-lifecycle.json` — add, edit, delete lifecycle for household members.
- `family-invite-join.json` — invite issuance, leave, error fetch, and rejoin via invite code.

This plan keeps Replay fixtures (historical API flows) isolated while establishing reproducible EndToEnd family coverage.

