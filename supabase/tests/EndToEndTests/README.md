# Family RPC End-to-End Tests

This directory contains Deno tests that call the family RPCs through the published edge function (`/ingredicheck/family`). Each test is code-first and independent—no JSON fixtures or Replay dependencies.

## Covered Scenarios

- `family_management.test.ts` – exercise create/get, member lifecycle, invite/join, leave, and validation/error cases in one file.
- `../_shared/utils.ts` – shared Supabase helpers (`signInAnon`, `functionsUrl`, auth client wrappers).

## Prerequisites

- **Deno** v1.40 or later.
- **Supabase CLI** and **Docker Desktop** if you run against a local stack.
- `SUPABASE_BASE_URL` and `SUPABASE_ANON_KEY` environment variables. The local stack prints these as `http://127.0.0.1:54321` and the generated anon key.

## Local Environment

Use the shared setup script to start the local Supabase stack:

```bash
cd ../_shared
./local-env.ts setup      # starts docker containers
cd ../EndToEndTests
```

When you are done testing:

```bash
cd ../_shared
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

1. Extend `family_management.test.ts` (or add a new test file beside it) and follow the established `callFamily` helper pattern.
2. Import utilities from `../_shared/utils.ts` to get anonymous credentials and build function URLs.
3. Keep tests deterministic—use random IDs only for isolation, and assert on returned data.
4. Run `deno test -A` until the new file passes.

## Tips & Troubleshooting

- `Operation not permitted` usually means the local Supabase stack is not running.
- After changing edge functions or SQL, redeploy or restart the stack before re-running tests.
- If Auth rate limits complain, slow down invite/join loops or reuse tokens across assertions within a test.
- Use `console.warn` sparingly for debugging; clean up before committing.

This suite provides fast feedback on RPC behavior through code-first tests that exercise the family domain endpoints.
