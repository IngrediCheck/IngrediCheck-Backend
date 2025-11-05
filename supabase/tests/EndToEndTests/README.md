# Family End-to-End Test Suite

This directory contains deterministic fixtures that exercise the new family-management APIs. The goal is to keep these flows separate from the legacy Replay suite so mobile/backend devs can iterate quickly without noise.

## Files

- `family-create-and-fetch.json` – creates a family and immediately fetches it.
- `family-invite-join.json` – owner issues an invite, leaves, second user joins with the code.
- `family-member-lifecycle.json` – add, edit, and delete a household member.
- `family-e2e-plan.md` – planning notes describing target scenarios.
 

## Prerequisites

Run everything from `supabase/tests/`:

```bash
./local-env.ts setup      # start local Supabase stack (Docker required)
./local-env.ts teardown   # stop the stack when finished
```

During setup the script prints the local base URL (`http://127.0.0.1:54321`) and anon key. If you need to expose your machine externally (e.g., via ngrok), follow the instructions in `FamilyFeatureLocalGuide.md`.

## Running the End-to-End Suite

Use the dedicated runner so Replay flows remain isolated:

```bash
./run-testcase-endtoend.ts             # run all family fixtures
./run-testcase-endtoend.ts 1           # single fixture (by index)
./run-testcase-endtoend.ts family-invite-join
```

Output is a pass/fail report per request step. All fixtures resolve placeholders such as `{{var:SELF_MEMBER_ID}}` at runtime.

## Capturing or Updating Fixtures

1. Start the local stack (`./local-env.ts setup`).
2. Record a new flow:
   ```bash
   ./capture-testcase.ts "family-my-new-flow"
   ```
3. Perform the actions in the mobile app or API client.
4. When finished, press Enter; the JSON file is saved to `EndToEndTests/`.
5. Move the new file into this `EndToEndTests/` folder. Keep placeholder variables (`{{var:...}}`) consistent across requests/responses.
6. Update `family-e2e-plan.md` with the new scenario.

> Tip: avoid sharing test data with sensitive information—fixtures are meant to be deterministic and safely committed.

## Auth Notes

- All RPCs rely on `auth.uid()`. The runner signs in anonymously for each request. If you test manually, obtain a user access token (`run-testcase-endtoend.ts` prints the anonymous user ID; check `.env-state.json` for base URL and keys).
- Colors must be valid hex values. Member names are case-insensitive unique within a family.

## Sharing with Mobile Developers

- Point them to `FamilyFeatureLocalGuide.md` for curl samples and tunnel setup instructions.
- Provide the anon key and either your local IP:port or tunnel URL if they need to connect to your machine.

Keeping this directory self-contained ensures Replay regression coverage stays stable while the family experience evolves.

