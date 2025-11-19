# Regression-Focused End-to-End Testing Strategy for IngrediCheck

This document defines how we will detect regressions in IngrediCheck’s Supabase edge functions by replaying predefined inputs and confirming predefined outputs. The entire approach assumes real-world sessions are captured, converted into fixtures, and replayed without altering internal database state or stubbing third-party integrations.

## 1. Goals & Scope
- Exercise the public API surface in `supabase/functions/ingredicheck/index.ts` (inventory, extract, analyze, history, preference lists, feedback, delete-me) exactly as production clients do.
- Focus strictly on observable inputs and outputs: HTTP responses and externally-visible effects (no direct assertions on Postgres tables or stored procedures).
- Detect regressions by replaying previously-recorded user flows and verifying their responses stay consistent.
- Keep the suite hermetic with respect to infrastructure (local Supabase stack, edge functions) but preserve real calls to external services such as OpenFoodFacts or LLM providers.

## 2. Environment Bootstrapping
- **Supabase CLI + Docker**: Install the CLI, ensure Docker is available, and launch the local stack with `supabase start`. Capture anon/service keys and generated URLs for use during testing.
- **Environment variables**: Copy `.env.template` to `.env` (or export equivalent variables) and fill in `SUPABASE_BASE_URL`, `SUPABASE_FUNCTIONS_URL` (defaults to `${SUPABASE_BASE_URL}/functions/v1` when omitted), `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` so capture/replay scripts can authenticate automatically. The capture and replay scripts automatically load `.env` from the repo root via Deno’s dotenv loader.
- **Schema reset**: Apply project schema via `supabase db reset --file supabase/database/tables.sql` before each run so database structure matches production.
- **Test credentials**: Use `supabase auth admin createuser` to provision a dedicated regression-test user. Store credentials alongside the Supabase keys in `.env.test`.
- **Edge functions**: Run both `ingredicheck` and `background` functions with `supabase functions serve ... --env-file .env.test`. Tests will target the standard HTTP endpoints.

## 3. Harness Architecture
- **Test workspace**: Place all regression tooling under `supabase/tests/` so scripts, fixtures, and test cases travel with the edge functions they exercise.
- **Environment bootstrap script**: Implement `supabase/tests/setup-local-env.ts` that starts the Supabase CLI stack, launches required edge functions, waits for readiness, and tears everything down when invoked locally.
- **Regression runner script**: Implement `supabase/tests/run-testcase.ts` that consumes recording artifacts and replays them against a supplied backend base URL (local or remote), emitting concise pass/fail output while authenticating with `signInAnonymously`, resolving `{{var:...}}` placeholders, and interactively selecting a test case (or all cases) from `supabase/tests/testcases/`.
- **Shared utilities**: Collect common helpers in `supabase/tests/_shared/utils.ts` (Supabase client creation, auth token retrieval, request execution) to avoid duplication between capture and replay scripts.
- **Session replay**: For each recorded session, send the HTTP request as captured, then compare the response to the stored expectation. Use tolerance rules for inherently variable fields (timestamps, UUIDs) but avoid direct DB manipulation.
- **Cleanup**: Do not modify or delete database rows during tests. Rely on the replayed responses for validation.

## 4. Handling External Dependencies
- **Real integrations**: Since the goal is regression detection against real-world behaviour, do not stub third-party services. Recorded sessions should already include the exact payloads needed to reproduce scenarios; replaying them should exercise the same external calls naturally.
- **Network considerations**: Because actual APIs are invoked, ensure required API keys (OpenFoodFacts, LLM providers) are configured for the test environment.

## 5. Capturing Real Sessions for Regression Replays
- **One-user toggle via Supabase secrets**: Drive recording entirely through environment variables set with the Supabase CLI. Before capturing, run `supabase secrets set RECORDING_USER_ID=<uuid> RECORDING_SESSION_ID=<unique-tag>` (or `supabase functions secrets set ... --func ingredicheck` to scope it). Only one user/session can be active at a time; choose a unique session tag for every capture run.
- **Operational flow**: Provide a capture script (`supabase/tests/capture-testcase.ts`) that: (1) sets the secrets; (2) prompts the operator to run the desired client actions; (3) waits for confirmation to stop; (4) exports the logs filtered by `recording_session_id`; and (5) clears the secrets.
- **Middleware check**: On each request, read `Deno.env.get('RECORDING_USER_ID')` and compare it to the authenticated user. If they match, log the request/response pair and stamp each record with `recording_session_id = Deno.env.get('RECORDING_SESSION_ID')`. If either env var is missing, skip logging. No database lookup is required.
- **Request/response logging**: While recording is active, capture the full inbound request body (form-data decoded, JSON) plus headers the backend relies on, along with the response status/body. Persist them sequentially with timestamps and the associated `recording_session_id` so the timeline can be reconstructed later.
- **Session export**: As part of the capture script, fetch all recorded entries where `recording_session_id` matches the chosen tag, sort them chronologically, and emit an artifact under `supabase/tests/testcases/<test-case>.json`.
- **Artifact contents**: Store method, path, headers, body payload, expected response, and metadata such as the captured timestamp and client version. Because security concerns are minimal, raw values may remain.

## 6. Scenario Coverage

Position recordings around representative user journeys. Because validation is response-based, each scenario simply needs a stable set of requests and expected responses.

| Flow | Description | Key responses to verify |
| --- | --- | --- |
| Inventory lookup | Scan barcode, fetch product | 200 payload, 404 when missing |
| Extract + analyze | Upload images, extract ingredients, run analyzer | Extracted product JSON, analyzer recommendations |
| Preference management | Create/update/delete preferences | Success / validation error responses |
| History & favorites | Retrieve check history, toggle favorites | History list contents, list item add/delete status |
| Feedback submission | Submit rating + notes | Feedback creation (201), subsequent replays should match |
| Account deletion | Trigger delete-me flow | 204 response confirming deletion |

## 7. CI Integration
- Supabase GitHub Actions runners allow Docker usage, so you can run `supabase start` within CI. Use a workflow that sets up Deno, Supabase CLI, Docker, then executes `deno task test:regression`.
- Ensure the job cleans up generated containers in a final step to avoid resource leakage.

## 8. Implementation Checklist
1. Recording automation  
   - [x] (1.1) Create persistent storage (e.g., `recorded_sessions` table) capturing `recording_session_id`, `user_id`, timestamp, request payload, and response payload to enable deterministic replay exports.  
   - [x] (1.2) Add middleware in `supabase/functions/ingredicheck/index.ts` to log requests/responses whenever `RECORDING_USER_ID` matches the caller, stamping each entry with `recording_session_id = RECORDING_SESSION_ID`.  
   - [x] (1.3) Implement the capture scaffold in `supabase/tests/capture-testcase.ts` so it sets secrets, prompts the operator, exports the captured session into `supabase/tests/testcases/<test-case>.json`, and unsets secrets.  

2. Regression testing automation  
   - [x] (2.1) Build the regression runner in `supabase/tests/run-testcase.ts`, allowing the backend base URL to be provided (local or remote).  
  - [ ] (2.2) Share reusable helpers in `supabase/tests/_shared/utils.ts` (Supabase client creation, auth, header assembly).  
   - [ ] (2.3) Add a `deno task test:regression` entry that invokes the runner script.  
   - [ ] (2.4) Configure GitHub Actions workflow to execute regression tests with Docker-enabled Supabase CLI.  
   - [ ] (2.5) Implement `supabase/tests/setup-local-env.ts` to bootstrap and tear down the local Supabase stack when needed.  
