# IngrediCheck Backend Testing Guide

This directory contains end-to-end regression tests for the IngrediCheck backend API. The tests capture real user interactions and replay them to ensure API behavior remains consistent.

## Prerequisites

### Required Software
- **Docker Desktop** – for running the local Supabase stack
- **Supabase CLI** – for managing Supabase projects and functions
- **Deno** – for running the regression-test scripts
- **Python 3.x** – required by a few helper utilities

### Environment Setup
Copy the `.env.template` file in the repository root and add your secrets:

```bash
# Copy the template
cp .env.template .env

# Edit with your actual secrets
nano .env  # or use your preferred editor
```

#### For Capturing New Test Cases
```bash
SUPABASE_BASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### For Local Testing
```bash
OPENAI_API_KEY=your-openai-key
GEMINI_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key
```

#### For Remote Testing
```bash
SUPABASE_BASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## Suite Layout

- `ReplayTests`: recorded regression flows that mirror production traffic and power the default replay suite.

> Looking for the new family End-To-End suite? See `EndToEndTests/README.md`.

## 1. How to Capture a New Test Case

1. **Run the capture script**:
   ```bash
   ./capture-testcase.ts "your-test-case-name"
   ```

2. **Follow the prompts**:
   - When prompted, login as **guest** on your mobile device
   - Perform the actions you want to test
   - Press Enter when done

3. **Test case saved** as `ReplayTests/your-test-case-name.json`
4. Move the generated file into `ReplayTests/` and commit it with a descriptive name.

## 2. How to Run Test Cases Against Local Supabase

1. **Set up local environment**:
   ```bash
   ./local-env.ts setup
   ```

2. **Run test cases**:
   ```bash
   ./run-testcase.ts                        # Replay suite (defaults to all)
   ./run-testcase.ts 1,3,5                  # Specific Replay tests
   ./run-testcase.ts 1-3                    # Range of Replay tests
   ```

3. **Clean up**:
   ```bash
   ./local-env.ts teardown
   ```


## 3. How to Run Test Cases Against Remote Supabase

1. **Stop local environment**:
   ```bash
   ./local-env.ts teardown
   ```

2. **Run tests against remote**:
   ```bash
   ./run-testcase.ts
   ./run-testcase-endtoend.ts
   ```

## 4. GitHub Workflow and Production Deployment

The project includes a GitHub Actions workflow that:
- Runs all regression tests on every commit to `main` branch
- Automatically deploys to production if tests pass
- Prevents API regressions and ensures production stability

## Troubleshooting

- **Docker not running**: Start Docker Desktop, then retry `./local-env.ts setup`
- **Environment variables missing**: Ensure `.env` file exists in repo root
- **Tests failing against remote**: Run `./local-env.ts teardown` first
- **Capture script can't detect user**: Use guest sign-in, reset app state
- **Debug mode**: `RUN_TESTCASE_STOP_ON_FAILURE=true ./run-testcase.ts all`

## File Structure

```
supabase/tests/
├── README.md                    # This file
├── capture-testcase.ts         # Record new test cases
├── run-testcase.ts             # Replay test cases
├── local-env.ts                # Local Supabase management
├── ReplayTests/                # Historical recordings and shared setup
│   └── setup.ts                # Common utilities for test runners
└── EndToEndTests/              # Deterministic family E2E fixtures (see README in this folder)
```

## Best Practices

- Use descriptive test case names (e.g., `barcode-scan-success`)
- Update test cases when API behavior changes
- Always run `teardown` before switching between local/remote testing
