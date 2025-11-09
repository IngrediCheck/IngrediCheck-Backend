# Family RPC End-to-End Tests

This directory contains Deno tests that call the family RPCs through the published edge function (`/ingredicheck/family`). Each test is code-first and independent—no JSON fixtures or Replay dependencies.

## Covered Scenarios

- `create_get_family.test.ts` – bootstrap a household and fetch it back.
- `member_lifecycle.test.ts` – add, update, and remove household members.
- `invite_join_flow.test.ts` – invite a new member, leave as owner, join with invite code.
- `leave_family.test.ts` – ensure members can exit and lose access.
- `validation_errors.test.ts` – guard rails for duplicate names, invalid IDs, bad invites, and self-deletion attempts.
- `test_utils.ts` – anonymous sign-in helper and functions URL builder.

## Prerequisites

- **Deno** v1.40 or later.
- **Supabase CLI** and **Docker Desktop** if you run against a local stack.
- `SUPABASE_BASE_URL` and `SUPABASE_ANON_KEY` environment variables. The local stack prints these as `http://127.0.0.1:54321` and the generated anon key.

## Local Environment

Reuse the ReplayTests setup script so both suites share infrastructure:

```bash
cd ../ReplayTests
./local-env.ts setup      # starts docker containers
cd ../EndToEndTests
```

When you are done testing:

```bash
cd ../ReplayTests
./local-env.ts teardown
```

## Running Tests

From this directory run:

```bash
deno test -A
```

Useful variations:

- `deno test -A --filter invite` – run a single scenario.
- `SUPABASE_BASE_URL=... SUPABASE_ANON_KEY=... deno test -A` – target a remote project.

Each test signs in anonymously, issues HTTP requests against the edge function, asserts the status code, and inspects response JSON. Responses are always drained (`await resp.text()` / `await resp.json()`) to suppress Deno leak warnings.

## Adding Coverage

1. Create a new `*.test.ts` file mirroring the existing structure.
2. Import utilities from `./test_utils.ts` to get an anon token and function URL.
3. Keep tests deterministic—use random IDs only for isolation, and assert on returned data.
4. Run `deno test -A` until the new file passes.

## Tips & Troubleshooting

- `Operation not permitted` usually means the local Supabase stack is not running.
- After changing edge functions or SQL, redeploy or restart the stack before re-running tests.
- If Auth rate limits complain, slow down invite/join loops or reuse tokens across assertions within a test.
- Use `console.warn` sparingly for debugging; clean up before committing.

Maintaining this suite alongside ReplayTests gives fast feedback on RPC behavior while keeping regression flows stable.

