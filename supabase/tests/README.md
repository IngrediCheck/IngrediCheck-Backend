# IngrediCheck Backend Testing Guide

This directory contains end-to-end regression tests for the IngrediCheck backend API. The tests capture real user interactions and replay them to ensure API behavior remains consistent.

## Prerequisites

### Required Software
- **Docker Desktop** - For running local Supabase stack
- **Supabase CLI** - For managing Supabase projects and functions
- **Deno** - For running the test scripts
- **Python 3.x** - For some dependencies and utilities
- **IngrediCheck mobile app** - Install on your Android or iPhone device

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

## 1. How to Capture a New Test Case

1. **Run the capture script**:
   ```bash
   ./capture-testcase.ts "your-test-case-name"
   ```

2. **Follow the prompts**:
   - When prompted, login as **guest** on your mobile device
   - Perform the actions you want to test
   - Press Enter when done

3. **Test case saved** as `testcases/your-test-case-name.json`

## 2. How to Run Test Cases Against Local Supabase

1. **Set up local environment**:
   ```bash
   ./local-env.ts setup
   ```

2. **Run test cases**:
   ```bash
   ./run-testcase.ts all                    # All tests
   ./run-testcase.ts 1,3,5                  # Specific tests
   ./run-testcase.ts 1-3                    # Range of tests
   ./run-testcase.ts barcode-scan-success   # Named test
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
   ./run-testcase.ts all
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
├── shared/
│   └── setup.ts                # Common utilities
└── testcases/                  # Captured test cases
    ├── barcode-scan-success.json
    ├── photo-scan-success.json
    ├── favorites-valid.json
    ├── history-valid.json
    └── preferences-add-edit-delete.json
```

## Best Practices

- Use descriptive test case names (e.g., `barcode-scan-success`)
- Update test cases when API behavior changes
- Always run `teardown` before switching between local/remote testing
