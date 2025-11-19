# IngrediCheck Replay Tests Guide

This directory contains end-to-end regression tests for the IngrediCheck backend API. The flows capture real user interactions and replay them to ensure API behavior remains consistent.

## Prerequisites

### Required Software
- **Docker Desktop** – runs the local Supabase stack
- **Supabase CLI** – manages Supabase projects and edge functions
- **Deno** – executes the capture and replay scripts
- **Python 3.x** – required by a few helper utilities
- **IngrediCheck mobile app** – install on an Android or iOS device for capturing flows

### Environment Setup
Copy the repository `.env.template` and add your secrets:

```bash
cp ../../.env.template ../../.env
# edit ../../.env and populate required values
```

Set the following environment variables depending on where you run the tests.

For capturing new test cases:

```bash
SUPABASE_BASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

For local testing:

```bash
OPENAI_API_KEY=your-openai-key
GEMINI_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key
```

For remote testing:

```bash
SUPABASE_BASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## 1. Capture a New Test Case

1. Run the capture script from this directory:
   ```bash
   ./capture-testcase.ts "your-test-case-name"
   ```
2. Follow the prompts:
   - Sign in as **guest** on the mobile app when requested
   - Perform the actions you wish to record
   - Press Enter in the terminal when the flow is complete
3. The JSON fixture is saved under `./testcases/your-test-case-name.json`.

## 2. Run Test Cases Against Local Supabase

1. Start the local stack:
   ```bash
   ../_shared/local-env.ts setup
   ```
2. Replay tests:
   ```bash
   ./run-testcase.ts all                    # All tests
   ./run-testcase.ts 1,3,5                  # Specific tests
   ./run-testcase.ts 1-3                    # Range of tests
   ./run-testcase.ts barcode-scan-success   # Named test
   ```
3. Shut down services when finished:
   ```bash
   ../_shared/local-env.ts teardown
   ```

## 3. Run Test Cases Against Remote Supabase

1. Stop any local stack:
   ```bash
   ../_shared/local-env.ts teardown
   ```
2. Replay against remote using the appropriate `SUPABASE_BASE_URL`/keys in `.env`:
   ```bash
   ./run-testcase.ts all
   ```

## 4. GitHub Workflow & Deployment

CI runs the replay suite on every push to `main`. Deployments only proceed if all tests pass, preventing regressions from reaching production.

## Troubleshooting

- **Docker not running** – Launch Docker Desktop, then retry `../_shared/local-env.ts setup`.
- **Missing env vars** – Ensure `../../.env` is populated or export required variables in the shell.
- **Remote failures after local runs** – Always run `../_shared/local-env.ts teardown` before switching targets.
- **Capture script cannot detect user** – Use the guest login path in the mobile app and reset app state between runs.
- **Debug mode** – `RUN_TESTCASE_STOP_ON_FAILURE=true ./run-testcase.ts all`.

## Directory Layout

```
supabase/tests/
├── _shared/
│   ├── local-env.ts       # Start/stop local Supabase stack (shared)
│   └── utils.ts           # Shared Supabase helpers (auth, env, clients)
├── ReplayTests/
│   ├── README.md            # This file
│   ├── capture-testcase.ts  # Record new flows
│   ├── run-testcase.ts      # Replay captured flows
│   └── testcases/
│       ├── barcode-scan-success.json
│       ├── photo-scan-success.json
│       ├── favorites-valid.json
│       └── …                 # Additional fixtures
└── EndToEndTests/
    └── …                   # End-to-end test files
```

## Best Practices

- Use descriptive fixture names (e.g., `barcode-scan-success`).
- Update fixtures whenever API responses change to keep expectations accurate.
- Always run `teardown` before switching between local and remote targets.
- Avoid placing sensitive data in fixtures; they are committed to version control.
