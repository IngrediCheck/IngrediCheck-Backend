#!/usr/bin/env -S deno run --allow-run=supabase --allow-env --allow-read --allow-write --allow-net

import { dirname, fromFileUrl, join } from "std/path";
import {
  createSupabaseServiceClient,
  getEnvVar,
  loadEnv,
} from "./shared/setup.ts";

type RecordingRow = {
  recording_session_id: string;
  user_id: string;
  recorded_at: string;
  request_method: string;
  request_path: string;
  request_body: {
    type: string;
    payload: unknown;
    search?: Record<string, string>;
  } | null;
  response_status: number;
  response_body: unknown;
};

type CaptureOptions = {
  userId: string;
  sessionTag: string;
  testCase: string;
  functionName?: string;
  scope: "project" | "function";
  outputFile: string;
  skipUnset: boolean;
};

type AuthUser = {
  id: string;
  created_at: string;
  email?: string;
  phone?: string;
};

const scriptDir = dirname(fromFileUrl(import.meta.url));
const envLoad = await loadEnv({
  onWarning: (message) => console.warn(message),
});
const envLoaded = envLoad.loaded;

if (envLoaded && envLoad.path) {
  console.log(`Loaded environment variables from ${envLoad.path}`);
} else if (!envLoaded) {
  console.warn(
    "Warning: No .env file found for capture-testcase script. Falling back to interactive prompts.",
  );
}

function promptValue(message: string, fallback?: string): string {
  const input = prompt(message, fallback ?? "")?.trim();
  if (!input) {
    console.error(`Aborted: ${message} is required.`);
    Deno.exit(1);
  }
  return input;
}

function ensureEnvVar(name: string, promptMessage: string): string {
  const current = getEnvVar(name);
  if (current) {
    return current;
  }
  // Only prompt if .env wasn't loaded successfully
  if (!envLoaded) {
    const value = promptValue(promptMessage);
    Deno.env.set(name, value);
    return value;
  }
  console.error(
    `Error: Environment variable ${name} not found despite .env being loaded.`,
  );
  Deno.exit(1);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveOptions(testCaseInput: string): Omit<CaptureOptions, 'userId'> {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  const timePart = now.toISOString().slice(11, 16).replace(":", "");
  const sessionTag = slugify(`${datePart}-${timePart}-${testCaseInput}`);
  const testCaseSlug = slugify(testCaseInput) || "adhoc";
  const recordingsDir = join(scriptDir, "testcases");
  const outputFile = join(recordingsDir, `${testCaseSlug}.json`);

  return {
    sessionTag,
    testCase: testCaseSlug,
    functionName: undefined,
    scope: "project",
    outputFile,
    skipUnset: false,
  };
}

async function runCommand(
  description: string,
  command: string[],
  opts: { cwd?: string } = {},
) {
  console.log(`$ ${command.join(" ")}`);
  const proc = new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: opts.cwd ?? Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await proc.output();
  if (code !== 0) {
    console.error(`${description} failed`);
    console.error(new TextDecoder().decode(stderr));
    Deno.exit(code);
  }
  if (stdout.length) {
    console.log(new TextDecoder().decode(stdout));
  }
}

async function setSecrets(options: CaptureOptions) {
  const { userId, sessionTag, scope, functionName } = options;
  const baseArgs = scope === "function"
    ? [
      "supabase",
      "functions",
      "secrets",
      "set",
      `RECORDING_USER_ID=${userId}`,
      `RECORDING_SESSION_ID=${sessionTag}`,
      "--function",
      functionName ?? "ingredicheck",
    ]
    : [
      "supabase",
      "secrets",
      "set",
      `RECORDING_USER_ID=${userId}`,
      `RECORDING_SESSION_ID=${sessionTag}`,
    ];
  await runCommand("Setting recording secrets", baseArgs);
}

async function unsetSecrets(options: CaptureOptions) {
  const baseArgs = options.scope === "function"
    ? [
      "supabase",
      "functions",
      "secrets",
      "unset",
      "RECORDING_USER_ID",
      "RECORDING_SESSION_ID",
      "--function",
      options.functionName ?? "ingredicheck",
    ]
    : [
      "supabase",
      "secrets",
      "unset",
      "RECORDING_USER_ID",
      "RECORDING_SESSION_ID",
    ];
  await runCommand("Clearing recording secrets", baseArgs);
}

function getSupabaseClient() {
  const url = ensureEnvVar(
    "SUPABASE_BASE_URL",
    "Enter SUPABASE_BASE_URL (starts with https://...)",
  );
  const serviceKey = ensureEnvVar(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Enter SUPABASE_SERVICE_ROLE_KEY",
  );
  return createSupabaseServiceClient({
    baseUrl: url,
    serviceRoleKey: serviceKey,
  });
}

async function queryNewUsers(
  client: ReturnType<typeof createSupabaseServiceClient>,
  sinceTimestamp: string,
): Promise<AuthUser[]> {
  const { data, error } = await client.auth.admin.listUsers();
  
  if (error) {
    console.error("Failed to query auth.users:", error);
    Deno.exit(1);
  }
  
  const sinceDate = new Date(sinceTimestamp);
  return data.users.filter(user => {
    const userCreatedAt = new Date(user.created_at);
    return userCreatedAt > sinceDate;
  });
}

async function detectUserFromGuestSignIn(): Promise<string> {
  const client = getSupabaseClient();
  
  while (true) {
    const timestamp = new Date().toISOString();
    console.log("\n=== Guest Sign-In Detection ===");
    console.log("Please perform a GUEST SIGN-IN on your device now, then press Enter...");
    await prompt("Press Enter after completing guest sign-in...");
    
    const newUsers = await queryNewUsers(client, timestamp);
    
    if (newUsers.length === 0) {
      console.error("Error: No new users found after sign-in attempt.");
      console.error("Please ensure you performed a guest sign-in and try again.");
      Deno.exit(1);
    } else if (newUsers.length === 1) {
      const userId = newUsers[0].id;
      console.log(`✓ Successfully detected user ID: ${userId}`);
      return userId;
    } else {
      console.warn(`Warning: Multiple sign-ins detected (${newUsers.length} users).`);
      console.log("Please RESET APP STATE on your device and press Enter...");
      await prompt("Press Enter after resetting app state...");
      // Continue the loop with a fresh timestamp
    }
  }
}

async function fetchRecordingRows(sessionTag: string): Promise<RecordingRow[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("recorded_sessions")
    .select()
    .eq("recording_session_id", sessionTag)
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch recorded session entries:", error);
    Deno.exit(1);
  }
  return data ?? [];
}

type RecordingArtifact = {
  recordingSessionId: string;
  recordedUserId: string;
  exportedAt: string;
  totalEntries: number;
  testCase?: string;
  variables?: Record<string, string>;
  requests: Array<{
    recordedAt: string;
    request: {
      method: string;
      path: string;
      query: Record<string, string>;
      bodyType: string;
      body: unknown;
    };
    response: {
      status: number;
      bodyType: "json" | "text" | "bytes" | "empty" | "sse";
      body: unknown;
    };
  }>;
};

type NormalizedResponseBody = {
  bodyType: "json" | "text" | "bytes" | "empty" | "sse";
  body: unknown;
};

function looksLikeSsePayload(value: unknown): boolean {
  return Array.isArray(value) &&
    value.every((item) =>
      isPlainObject(item) && typeof item.event === "string"
    );
}

function normalizeResponseBody(raw: unknown): NormalizedResponseBody {
  if (raw === null || raw === undefined) {
    return { bodyType: "empty", body: null };
  }

  if (typeof raw === "string") {
    return { bodyType: "text", body: raw };
  }

  if (isPlainObject(raw)) {
    const record = raw as Record<string, unknown>;
    const typeValue = record["type"];
    const type = typeof typeValue === "string" ? typeValue : undefined;
    const payload = record["payload"];
    const value = record["value"];

    if (type === "sse" && looksLikeSsePayload(payload)) {
      return {
        bodyType: "sse",
        body: payload as Array<{ event: string; data: unknown }>,
      };
    }

    if (type === "bytes" && typeof value === "string") {
      return { bodyType: "bytes", body: value };
    }

    if (type === "empty") {
      return { bodyType: "empty", body: null };
    }
  }

  return { bodyType: "json", body: raw };
}

function buildArtifact(
  options: CaptureOptions,
  rows: RecordingRow[],
): RecordingArtifact {
  const artifact: RecordingArtifact = {
    recordingSessionId: options.sessionTag,
    recordedUserId: options.userId,
    exportedAt: new Date().toISOString(),
    totalEntries: rows.length,
    testCase: options.testCase,
    requests: rows.map((row) => ({
      recordedAt: row.recorded_at,
      request: {
        method: row.request_method,
        path: row.request_path,
        query: row.request_body?.search ?? {},
        bodyType: row.request_body?.type ?? "empty",
        body: row.request_body?.payload ?? null,
      },
      response: {
        status: row.response_status,
        ...normalizeResponseBody(row.response_body),
      },
    })),
  };

  injectVariablePlaceholders(artifact);

  return artifact;
}

function injectVariablePlaceholders(artifact: RecordingArtifact) {
  const idMap = new Map<string, string>();
  const counter = { value: 1 };

  for (const entry of artifact.requests) {
    collectIds(entry.request.body, idMap, counter);
    collectIdsFromResponse(entry.response.bodyType, entry.response.body, idMap, counter);
  }

  if (idMap.size === 0) {
    return;
  }

  for (const entry of artifact.requests) {
    entry.request.path = replacePathSegments(entry.request.path, idMap);
    entry.request.query = applyPlaceholders(
      entry.request.query,
      idMap,
    ) as Record<string, string>;
    entry.request.body = applyPlaceholders(entry.request.body, idMap);
    entry.response.body = applyPlaceholdersToResponse(
      entry.response.bodyType,
      entry.response.body,
      idMap,
    );
  }

  artifact.variables = Object.fromEntries(
    Array.from(idMap.entries()).map(([value, token]) => [token, value]),
  );
}

function collectIdsFromResponse(
  bodyType: NormalizedResponseBody["bodyType"],
  body: unknown,
  map: Map<string, string>,
  counter: { value: number },
) {
  if (bodyType === "sse" && Array.isArray(body)) {
    for (const event of body) {
      if (isPlainObject(event) && "data" in event) {
        collectIds((event as Record<string, unknown>).data, map, counter);
      }
    }
    return;
  }

  collectIds(body, map, counter);
}

function collectIds(
  node: unknown,
  map: Map<string, string>,
  counter: { value: number },
) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectIds(item, map, counter);
    }
    return;
  }

  if (!isPlainObject(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      key.toLowerCase() === "id" &&
      (typeof value === "string" || typeof value === "number")
    ) {
      const idValue = String(value);
      if (!map.has(idValue)) {
        const token = `ID_${String(counter.value).padStart(3, "0")}`;
        map.set(idValue, token);
        counter.value += 1;
      }
    }
    collectIds(value, map, counter);
  }
}

function applyPlaceholders(node: unknown, map: Map<string, string>): unknown {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      node[index] = applyPlaceholders(node[index], map);
    }
    return node;
  }

  if (isPlainObject(node)) {
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === "path" && typeof value === "string") {
        record[key] = replacePathSegments(value, map);
        continue;
      }
      record[key] = applyPlaceholders(value, map);
    }
    return record;
  }

  if (typeof node === "string" || typeof node === "number") {
    const token = map.get(String(node));
    if (token) {
      return `{{var:${token}}}`;
    }
  }

  return node;
}

function replacePathSegments(path: string, map: Map<string, string>): string {
  return path
    .split("/")
    .map((segment) => {
      const token = map.get(segment);
      return token ? `{{var:${token}}}` : segment;
    })
    .join("/");
}

function applyPlaceholdersToResponse(
  bodyType: NormalizedResponseBody["bodyType"],
  body: unknown,
  map: Map<string, string>,
): unknown {
  if (bodyType === "sse" && Array.isArray(body)) {
    return body.map((event) => {
      if (!isPlainObject(event)) {
        return event;
      }
      const result: Record<string, unknown> = { ...event };
      if ("data" in result) {
        result.data = applyPlaceholders(result.data, map);
      }
      return result;
    });
  }

  return applyPlaceholders(body, map);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function writeArtifact(
  options: CaptureOptions,
  artifact: RecordingArtifact,
) {
  await Deno.mkdir(dirname(options.outputFile), { recursive: true });
  const filePath = options.outputFile;
  try {
    await Deno.remove(filePath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  await Deno.writeTextFile(filePath, JSON.stringify(artifact, null, 2));
  console.log(`Saved recording to ${filePath}`);
}

async function main() {
  // Get test case name from command line arguments
  const testCaseInput = Deno.args.join(" ").trim() || 
    promptValue("Name the test case being recorded");
  
  // Detect user ID automatically
  const userId = await detectUserFromGuestSignIn();
  
  // Resolve other options
  const baseOptions = resolveOptions(testCaseInput);
  const options: CaptureOptions = {
    ...baseOptions,
    userId,
  };
  
  await setSecrets(options);

  console.log("\nRecording started.");
  console.log("Perform the desired user actions now.");
  prompt("Press enter once the session should stop capturing...");

  const rows = await fetchRecordingRows(options.sessionTag);
  if (rows.length === 0) {
    console.warn("Warning: No entries captured for this session.");
  }

  const artifact = buildArtifact(options, rows);
  await writeArtifact(options, artifact);

  await unsetSecrets(options);
  console.log("Capture complete.");
}

if (import.meta.main) {
  await main();
}
