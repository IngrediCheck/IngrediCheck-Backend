#!/usr/bin/env -S deno run --allow-run --allow-env --allow-read --allow-write --allow-net

/**
 * LOCAL ENVIRONMENT SETUP SCRIPT
 * 
 * CRITICAL DISCOVERY: Actual Supabase CLI Behavior
 * =================================================
 * 
 * Your project IS LINKED to remote project: wqidjkpfdrvomfkmefqc
 * (stored in: ./supabase/.temp/project-ref)
 * 
 * ⚠️ IMPORTANT: When a project is linked, secrets commands behave unexpectedly!
 * 
 * Actual Command Behaviors (VERIFIED):
 * ------------------------------------
 * 
 * 1. SECRETS COMMANDS (BOTH access REMOTE when linked!):
 *    - `supabase secrets list` → Shows REMOTE secrets (NOT local!)
 *    - `supabase secrets set` → Sets REMOTE secrets (NOT local!)
 *    - `supabase secrets list --project-ref wqidjkpfdrvomfkmefqc` → Also REMOTE
 *    - Both commands show identical output because they access the same source
 * 
 * 2. HOW TO SET LOCAL-ONLY SECRETS (SOLUTION FOUND!):
 *    Method A: Use supabase/functions/.env file
 *    - Create `supabase/functions/.env` with your local secrets
 *    - These are automatically loaded on `supabase start`
 *    - Example:
 *      ```
 *      LOCAL_API_KEY=local_test_key
 *      LOCAL_DB_URL=local_database_url
 *      ```
 *    
 *    Method B: Use custom env file with --env-file
 *    - Create `.env.local` or any custom file
 *    - Load with: `supabase functions serve --env-file .env.local`
 *    
 *    Method C: Unlink temporarily
 *    - `rm ./supabase/.temp/project-ref`
 *    - Then `supabase secrets set` will affect local Docker
 *    - Restore link after: `mv project-ref.backup ./supabase/.temp/project-ref`
 * 
 * 3. FUNCTIONS COMMANDS:
 *    - `supabase functions serve` → Runs LOCAL in Docker containers
 *    - `supabase functions deploy` → Deploys to REMOTE (wqidjkpfdrvomfkmefqc)
 * 
 * 4. DATABASE COMMANDS:
 *    - `supabase db reset` → Resets LOCAL database
 *    - Most db commands default to LOCAL
 * 
 * KEY INSIGHT: 
 * When linked, `supabase secrets` CLI commands operate on REMOTE,
 * BUT you can still set local-only secrets via .env files!
 * 
 * Current Setup (SAFE FOR LOCAL ONLY):
 * -------------------------------------
 * - This script NO LONGER uses `supabase secrets set` to avoid remote changes
 * - Instead, it creates supabase/functions/.env from your root .env
 * - Local functions read from this .env file (auto-loaded on supabase start)
 * - The .env file is automatically added to .gitignore
 * - GUARANTEED: This script will NEVER modify your remote Supabase instance!
 */

import { dirname, fromFileUrl, join } from "std/path";

type EnvState = {
  running: boolean;
  startedAt: string;
  baseUrl: string;
  functionsUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

const scriptDir = dirname(fromFileUrl(import.meta.url));
const STATE_FILE = join(scriptDir, ".env-state.json");

// State management functions
async function saveState(state: EnvState): Promise<void> {
  await Deno.writeTextFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function loadState(): Promise<EnvState | null> {
  try {
    const content = await Deno.readTextFile(STATE_FILE);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function clearState(): Promise<void> {
  try {
    await Deno.remove(STATE_FILE);
  } catch {
    // File may not exist
  }
}

// Export for use by run-testcase.ts
export { loadState, teardownCommand, type EnvState };

// Helper functions
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCommand(command: string[], options: { cwd?: string } = {}): Promise<void> {
  console.log(`$ ${command.join(" ")}`);
  const proc = new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: options.cwd ?? Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  });
  
  const { code, stdout, stderr } = await proc.output();
  
  if (code !== 0) {
    const errorOutput = new TextDecoder().decode(stderr);
    throw new Error(`Command failed: ${errorOutput}`);
  }
  
  const output = new TextDecoder().decode(stdout);
  if (output.trim()) {
    console.log(output);
  }
}

async function runCommandWithRetry(command: string[], maxRetries: number, options: { cwd?: string } = {}): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await runCommand(command, options);
      return; // Success
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        console.log(`   ⚠️  Attempt ${attempt} failed, retrying in 5 seconds...`);
        await delay(5000);
      }
    }
  }
  
  throw new Error(`Command failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// Load .env from repo root
async function loadEnvFromRoot(): Promise<void> {
  const repoRoot = join(scriptDir, "..", "..");
  const envPath = join(repoRoot, ".env");
  
  try {
    const content = await Deno.readTextFile(envPath);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (key) {
        Deno.env.set(key.trim(), valueParts.join("=").trim());
      }
    }
    console.log(`   Loaded from ${envPath}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(`   ⚠️  No .env file found at ${envPath}`);
      console.warn(`   Assuming Secrets are already set`);
    } else {
      throw error;
    }
  }
}

// Check Docker is running and start if needed
async function checkDockerRunning(): Promise<void> {
  try {
    const command = new Deno.Command("docker", {
      args: ["info"],
      stdout: "null",
      stderr: "null",
    });
    const { code } = await command.output();
    if (code !== 0) {
      throw new Error("Docker is not running");
    }
    console.log("   ✓ Docker is running");
  } catch (error) {
    console.log("   ⚠️  Docker is not running, attempting to start...");
    
    try {
      // Try to start Docker Desktop
      const startCommand = new Deno.Command("open", {
        args: ["-a", "Docker"],
        stdout: "null",
        stderr: "null",
      });
      await startCommand.output();
      
      console.log("   🚀 Starting Docker Desktop...");
      console.log("   ⏳ Waiting for Docker to be ready...");
      
      // Wait for Docker to start (up to 60 seconds)
      const timeout = 60000;
      const start = Date.now();
      
      while (Date.now() - start < timeout) {
        try {
          const checkCommand = new Deno.Command("docker", {
            args: ["info"],
            stdout: "null",
            stderr: "null",
          });
          const { code } = await checkCommand.output();
          if (code === 0) {
            console.log("   ✓ Docker is now running");
            return;
          }
        } catch {
          // Still starting
        }
        
        await delay(2000);
      }
      
      throw new Error("Docker failed to start within 60 seconds");
    } catch (startError) {
      console.error("   ❌ Failed to start Docker automatically");
      console.error("   Please start Docker Desktop manually and try again");
      Deno.exit(1);
    }
  }
}

// Create local Edge Functions .env file instead of using supabase secrets command
async function createLocalFunctionsEnv(): Promise<void> {
  const functionsEnvPath = join(scriptDir, "..", "functions", ".env");
  
  // Read secrets from root .env
  const secrets = [
    "OPENAI_API_KEY",
    "GEMINI_API_KEY", 
    "GROQ_API_KEY",
  ];
  
  const envContent: string[] = [
    "# Local Edge Functions Environment Variables",
    "# Auto-generated by local-env.ts from root .env",
    "# This file is for LOCAL development only",
    "",
  ];
  
  for (const secret of secrets) {
    const value = Deno.env.get(secret);
    if (value) {
      envContent.push(`${secret}=${value}`);
      console.log(`   ✓ ${secret} added to local .env`);
    } else if (secret.includes("MODEL")) {
      // Model overrides are optional
      console.log(`   ⊘ ${secret} (using default)`);
    } else {
      console.warn(`   ⚠️  ${secret} not set (may cause API failures)`);
    }
  }
  
  // Add local-only test values if needed
  envContent.push("");
  envContent.push("# Local-only test values");
  envContent.push("SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long");
  console.log("   ✓ SUPABASE_JWT_SECRET added to local .env (generated)");
  envContent.push("LOCAL_ENV=true");
  envContent.push(`LOCAL_SUPABASE_URL=http://127.0.0.1:54321`);
  
  // Write the file
  await Deno.writeTextFile(functionsEnvPath, envContent.join("\n"));
  console.log(`   ✓ Created ${functionsEnvPath}`);
  
  // Ensure it's in .gitignore
  const gitignorePath = join(scriptDir, "..", "..", ".gitignore");
  try {
    const gitignore = await Deno.readTextFile(gitignorePath);
    if (!gitignore.includes("supabase/functions/.env")) {
      await Deno.writeTextFile(
        gitignorePath,
        gitignore + "\nsupabase/functions/.env\n",
      );
      console.log("   ✓ Added to .gitignore");
    }
  } catch {
    // .gitignore might not exist
  }
}

async function startFunctionsServer(): Promise<Deno.ChildProcess> {
  // Serve all functions at once
  const command = new Deno.Command("supabase", {
    args: ["functions", "serve"],
    stdout: "piped",
    stderr: "piped",
  });
  
  const process = command.spawn();
  
  // Give functions more time to initialize
  console.log("   ⏳ Waiting for functions to initialize...");
  await delay(5000);
  
  // Check if process is still running
  try {
    const status = process.status;
    if (status !== undefined) {
      throw new Error("Functions process exited unexpectedly");
    }
  } catch {
    // Process is still running, which is good
  }
  
  return process;
}

async function getStatusJson(): Promise<any> {
  const command = new Deno.Command("supabase", {
    args: ["status", "--output", "json"],
    stdout: "piped",
  });
  
  const { code, stdout } = await command.output();
  if (code !== 0) {
    throw new Error("Failed to get Supabase status");
  }
  
  return JSON.parse(new TextDecoder().decode(stdout));
}

async function waitForReadiness(baseUrl: string, functionsUrl: string, anonKey: string): Promise<void> {
  const timeout = 120000; // 120 seconds for initial startup
  const start = Date.now();
  let apiReady = false;
  let functionsReady = false;
  
  console.log("   Checking API and functions endpoints...");
  
  while (Date.now() - start < timeout) {
    try {
      // Check API is responding
      if (!apiReady) {
        const apiResp = await fetch(`${baseUrl}/rest/v1/`, {
          headers: { 
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });
        
        // API might return various status codes, consider it ready if it responds at all
        if (apiResp.status >= 200 && apiResp.status < 600) {
          console.log(`   ✓ API ready (status: ${apiResp.status})`);
          apiReady = true;
        }
      }
      
      // Check functions endpoint - test a known function instead of root
      if (!functionsReady) {
        const functionsResp = await fetch(`${functionsUrl}/ingredicheck`, {
          method: "OPTIONS", // Use OPTIONS to avoid actually invoking the function
          headers: { 
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });
        
        // Functions might return various status codes, consider it ready if it responds
        if (functionsResp.status >= 200 && functionsResp.status < 600) {
          console.log(`   ✓ Functions ready (status: ${functionsResp.status})`);
          functionsReady = true;
        }
      }
      
      if (apiReady && functionsReady) {
        console.log("   ✓ All services ready");
        return;
      }
    } catch (error) {
      // Network errors mean service not ready yet
      const elapsed = Math.floor((Date.now() - start) / 1000);
      if (elapsed % 10 === 0) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`   ⏳ Still waiting... (${elapsed}s elapsed) - ${errorMessage}`);
        
        // Show more detail on first error for debugging
        if (elapsed === 0) {
          console.log(`   Debug: API URL: ${baseUrl}/rest/v1/`);
          console.log(`   Debug: Functions URL: ${functionsUrl}/ingredicheck`);
        }
      }
    }
    
    await delay(2000);
  }
  
  throw new Error(`Timeout waiting for services after ${Math.floor(timeout/1000)}s. API: ${apiReady ? '✓' : '✗'}, Functions: ${functionsReady ? '✓' : '✗'}`);
}

async function ensureAnonymousAuthEnabled(baseUrl: string, serviceRoleKey: string): Promise<void> {
  const authBaseUrl = `${baseUrl.replace(/\/$/, "")}/auth/v1`;
  const settingsUrl = `${authBaseUrl}/settings`;
  const authHeaders = {
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
  };

  const currentResp = await fetch(settingsUrl, { headers: authHeaders });
  if (!currentResp.ok) {
    const text = await currentResp.text();
    throw new Error(`Failed to read auth settings (${currentResp.status}): ${text}`);
  }

  const currentSettings = await currentResp.json();
  if (currentSettings?.external?.anonymous_users === true) {
    console.log("   ✓ Anonymous auth already enabled");
    return;
  }

  const patchResp = await fetch(`${authBaseUrl}/admin/settings`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ external: { anonymous_users: true } }),
  });

  if (!patchResp.ok) {
    const text = await patchResp.text();
    throw new Error(`Failed to enable anonymous auth (${patchResp.status}): ${text}`);
  }

  console.log("   ✓ Enabled anonymous auth for local instance");
}

async function prompt(question: string, defaultValue?: string): Promise<string | null> {
  await Deno.stdout.write(new TextEncoder().encode(question));
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return null;
  const input = new TextDecoder().decode(buf.subarray(0, n)).trim();
  return input || null;
}

// Signal handlers
let signalHandlersRegistered = false;

function registerSignalHandlers() {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;
  
  const cleanup = async () => {
    console.log("\n\nInterrupted! Cleaning up...");
    await teardownCommand({ force: true });
    Deno.exit(130);
  };
  
  Deno.addSignalListener("SIGINT", cleanup);
  Deno.addSignalListener("SIGTERM", cleanup);
}

// Command implementations
async function setupCommand(): Promise<void> {
  console.log("🚀 Setting up LOCAL Supabase environment...\n");
  
  // Safety check: Warn if project is linked
  const projectRefPath = join(scriptDir, "..", ".temp", "project-ref");
  try {
    const projectRef = await Deno.readTextFile(projectRefPath);
    console.log("⚠️  WARNING: Project is linked to remote instance!");
    console.log(`   Remote project: ${projectRef.trim()}`);
    console.log("   This script will ONLY configure LOCAL Docker containers.");
    console.log("   Secrets will be set via local .env files, NOT remote.\n");
  } catch {
    console.log("✅ No remote link detected. Safe to proceed.\n");
  }
  
  // 1. Load .env from repo root
  console.log("1️⃣ Loading environment variables...");
  await loadEnvFromRoot();

  console.log("1️⃣.5 Preparing edge function secrets...");
  await createLocalFunctionsEnv();
  
  // 2. Check if Supabase is already running
  console.log("2️⃣ Checking existing Supabase instance...");
  const existingState = await loadState();
  if (existingState?.running) {
    console.error("❌ Environment already running. Run 'teardown' first.");
    Deno.exit(1);
  }
  
  // 2.5. Clean up any existing Supabase instance
  console.log("2️⃣.5 Cleaning up any existing Supabase instance...");
  try {
    await runCommand(["supabase", "stop"]);
    console.log("   ✓ Stopped existing instance");
  } catch {
    // No existing instance to stop
  }
  
  // 3. Ensure Docker is running
  console.log("3️⃣ Verifying Docker is running...");
  await checkDockerRunning();
  
  // 4. Start Supabase (pulls images, starts containers)
  console.log("4️⃣ Starting Supabase stack (this may take a few minutes)...");
  await runCommand(["supabase", "start"]);
  
  // 4.5. Wait for Supabase to be fully ready
  console.log("4️⃣.5 Waiting for Supabase to be fully ready...");
  await delay(10000); // Wait 10 seconds for all services to start
  
  // 6. Get connection details
  console.log("6️⃣ Retrieving connection details...");
  const statusJson = await getStatusJson();
  // Note: supabase status --output json returns UPPERCASE keys
  const baseUrl = statusJson.API_URL || statusJson.api_url;
  const anonKey = statusJson.ANON_KEY || statusJson.anon_key;
  const serviceRoleKey = statusJson.SERVICE_ROLE_KEY || statusJson.service_role_key;
  
  if (!baseUrl || !anonKey || !serviceRoleKey) {
    console.error("❌ Failed to retrieve connection details from status");
    console.error("   Status JSON:", JSON.stringify(statusJson, null, 2));
    throw new Error("Missing required connection details");
  }
  
  // Safety check: Ensure we're using local instance
  if (!baseUrl.includes("127.0.0.1") && !baseUrl.includes("localhost")) {
    console.error("❌ SAFETY CHECK FAILED: Not using local instance!");
    console.error(`   API URL: ${baseUrl}`);
    console.error("   This script should only be used with local Supabase");
    throw new Error("Refusing to run against non-local instance");
  }
  console.log(`   ✓ Using local instance at ${baseUrl}`);
  
  // 7. Verify anonymous auth is enabled
  console.log("7️⃣ Verifying anonymous auth...");
  await ensureAnonymousAuthEnabled(baseUrl, serviceRoleKey);
  
  // 9. Health checks (functions are already served by main stack)
  console.log("9️⃣ Waiting for services to be ready...");
  const functionsUrl = `${baseUrl}/functions/v1`;
  
  // Debug: Check what functions are available
  try {
    const functionsList = await runCommand(["supabase", "functions", "list"]);
    console.log("   Available functions listed above");
  } catch {
    console.log("   Could not list functions (this is normal)");
  }
  
  await waitForReadiness(baseUrl, functionsUrl, anonKey);
  
  // 10. Save state
  await saveState({
    running: true,
    startedAt: new Date().toISOString(),
    baseUrl,
    functionsUrl,
    anonKey,
    serviceRoleKey,
  });
  
  console.log("\n✅ Environment ready!");
  console.log(`📍 Base URL: ${baseUrl}`);
  console.log(`🎛️  Studio: http://127.0.0.1:54323`);
  console.log(`\n▶️  Run tests: ./run-testcase.ts`);
}

async function teardownCommand(options: { force?: boolean, keepOnFailure?: boolean }): Promise<void> {
  const state = await loadState();
  
  if (!state?.running) {
    console.log("No running environment found.");
    return;
  }
  
  if (options.keepOnFailure) {
    console.log("\n⚠️  Tests failed. Environment still running.");
    console.log(`🎛️  Studio: http://127.0.0.1:54323`);
    const shouldStop = await prompt("\nStop environment? (y/n) ", "n");
    if (shouldStop?.toLowerCase() !== "y") {
      console.log("Keeping environment. Teardown with: ./local-env.ts teardown");
      return;
    }
  }
  
  console.log("🛑 Stopping environment...");
  
  // Stop Supabase (stops all containers including functions)
  await runCommand(["supabase", "stop"]);
  console.log("   ✓ Stopped Supabase");
  
  await clearState();
  console.log("✅ Cleanup complete");
}

async function deployCommand(): Promise<void> {
  const state = await loadState();
  
  if (!state?.running) {
    console.error("No running environment. Run 'setup' first.");
    Deno.exit(1);
  }
  
  console.log("🔄 Edge functions are already served by the main Supabase stack.");
  console.log("✅ No redeployment needed");
}

async function statusCommand(): Promise<void> {
  const state = await loadState();
  
  if (!state?.running) {
    console.log("No local environment running.");
    return;
  }
  
  console.log("Local environment status:");
  console.log(`  Running: ${state.running}`);
  console.log(`  Started: ${state.startedAt}`);
  console.log(`  Base URL: ${state.baseUrl}`);
  console.log(`  Functions URL: ${state.functionsUrl}`);
  console.log(`  Studio: http://127.0.0.1:54323`);
}

// Main CLI entry point
async function main(): Promise<void> {
  const command = Deno.args[0];
  
  switch (command) {
    case "setup":
      // registerSignalHandlers(); // Temporarily disable for debugging
      await setupCommand();
      break;
    case "teardown":
      await teardownCommand({ force: false, keepOnFailure: false });
      break;
    case "deploy":
      await deployCommand();
      break;
    case "status":
      await statusCommand();
      break;
    default:
      console.error("Usage: local-env.ts <setup|teardown|deploy|status>");
      Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    Deno.exit(1);
  });
}
