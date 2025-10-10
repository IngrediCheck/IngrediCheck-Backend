#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read

import { basename, dirname, fromFileUrl, join } from "std/path";
import { parse } from "std/flags";
import {
  type AuthTokens,
  buildAuthHeaders,
  loadEnv,
  signInAnonymously,
} from "./shared/setup.ts";

type RecordingArtifact = {
  recordingSessionId: string;
  recordedUserId: string;
  exportedAt: string;
  totalEntries: number;
  testCase?: string;
  variables?: Record<string, string>;
  requests: RecordedRequest[];
};

type RecordedRequest = {
  recordedAt: string;
  request: {
    method: string;
    path: string;
    query: Record<string, string>;
    bodyType: "json" | "form-data" | "text" | "bytes" | "empty";
    body: unknown;
  };
  response: {
    status: number;
    body: unknown;
  };
};

type RuntimeConfig = {
  baseUrl: string;
  functionsBaseUrl: string;
  anonKey: string;
  stopOnFailure: boolean;
};

type ReplayStats = {
  total: number;
  passed: number;
  failed: number;
};

type PlaceholderValue = {
  raw: unknown;
  text: string;
};

type PlaceholderStore = Map<string, PlaceholderValue>;

// Fuzzy matching configuration types
type MatchStrategy = "exact" | "fuzzy" | "regex" | "ignore";

type MatchResult = {
  matches: boolean;
  similarity?: number;
  message?: string;
};

type FieldMatcher = {
  pathPattern: string | RegExp;
  strategy: MatchStrategy;
  threshold?: number; // for fuzzy matching
  pattern?: RegExp; // for regex matching
};

type DelayRule = {
  method: string;           // e.g., "GET", "POST", or "*" for any
  pathPattern: string | RegExp;  // e.g., "/ingredicheck/history" or regex
  delaySeconds: number;     // delay before making the request
};

// Configuration for field matching strategies
const FIELD_MATCHERS: FieldMatcher[] = [
  { pathPattern: /\.annotatedText$/, strategy: "fuzzy", threshold: 0.95 },
  { pathPattern: /\.created_at$/, strategy: "ignore" } // Ignore timestamp differences
];

// Configuration for request delays
const DELAY_RULES: DelayRule[] = [
  { 
    method: "GET", 
    pathPattern: "/ingredicheck/history", 
    delaySeconds: 2 
  }
];

const FUZZY_MATCH_THRESHOLD = 0.95;

const scriptDir = dirname(fromFileUrl(import.meta.url));
const envLoad = await loadEnv({
  onWarning: (message) => console.warn(message),
});

if (!envLoad.loaded) {
  console.warn(
    "Warning: No .env file found for run-testcase script. Ensure environment variables are set.",
  );
}

const PLACEHOLDER_REGEXP = /\{\{var:([A-Z0-9_:-]+)\}\}/g;
const TESTCASES_ROOT = join(scriptDir, "testcases");

async function prompt(question: string): Promise<string | null> {
  await Deno.stdout.write(new TextEncoder().encode(question));
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return null;
  const input = new TextDecoder().decode(buf.subarray(0, n)).trim();
  return input;
}

type TestCase = {
  slug: string;
  displayName: string;
  filePath: string;
};

type Tokens = AuthTokens & { userId: string };

function formatTestCaseName(slug: string): string {
  const words = slug.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) {
    return slug;
  }
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function discoverTestCases(): Promise<TestCase[]> {
  const cases: TestCase[] = [];
  try {
    for await (const entry of Deno.readDir(TESTCASES_ROOT)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const slug = entry.name.replace(/\.json$/, "");
      cases.push({
        slug,
        displayName: formatTestCaseName(slug),
        filePath: join(TESTCASES_ROOT, entry.name),
      });
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  cases.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return cases;
}

async function promptTestCaseSelection(cases: TestCase[]): Promise<TestCase[]> {
  if (cases.length === 0) {
    console.error(
      "Error: No recorded regression test cases were found under supabase/tests/testcases.",
    );
    Deno.exit(1);
  }

  if (cases.length === 1) {
    console.log(`Only one test case found. Running: ${cases[0].displayName}`);
    return cases;
  }

  // Display available test cases
  console.log("\nAvailable test cases:");
  cases.forEach((testCase, index) => {
    console.log(`  ${index + 1}. ${testCase.displayName}`);
  });

  while (true) {
    const input = await prompt(
      '\nSelect test cases to run (numbers, ranges like "1-3", "all", or press Enter for all): ',
    );

    if (!input || input.trim() === "") {
      console.log("Running all test cases");
      return cases;
    }

    const trimmedInput = input.trim().toLowerCase();

    if (trimmedInput === "all") {
      console.log("Running all test cases");
      return cases;
    }

    try {
      const selectedIndices = parseSelection(trimmedInput, cases.length);
      if (selectedIndices.length === 0) {
        console.log("No valid selections. Please try again.");
        continue;
      }

      const selectedCases = selectedIndices.map((index) => cases[index - 1]);
      console.log(
        `Running ${selectedCases.length} selected test case(s): ${
          selectedCases.map((c) => c.displayName).join(", ")
        }`,
      );
      return selectedCases;
    } catch (error) {
      console.log(
        `Invalid selection: ${
          error instanceof Error ? error.message : String(error)
        }. Please try again.`,
      );
    }
  }
}

function parseSelection(input: string, maxCount: number): number[] {
  const selections = new Set<number>();

  // Split by comma and process each part
  const parts = input.split(",").map((part) => part.trim()).filter((part) =>
    part.length > 0
  );

  for (const part of parts) {
    if (part.includes("-")) {
      // Handle ranges like "1-3"
      const rangeParts = part.split("-").map((p) => p.trim());
      if (rangeParts.length !== 2) {
        throw new Error(`Invalid range format: ${part}`);
      }

      const start = parseInt(rangeParts[0], 10);
      const end = parseInt(rangeParts[1], 10);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range numbers: ${part}`);
      }

      if (start > end) {
        throw new Error(`Range start must be <= end: ${part}`);
      }

      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= maxCount) {
          selections.add(i);
        }
      }
    } else {
      // Handle single numbers
      const num = parseInt(part, 10);
      if (isNaN(num)) {
        throw new Error(`Invalid number: ${part}`);
      }

      if (num >= 1 && num <= maxCount) {
        selections.add(num);
      }
    }
  }

  return Array.from(selections).sort((a, b) => a - b);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadConfig(): RuntimeConfig {
  const args = parse(Deno.args, {
    string: ["base-url", "functions-url", "anon-key"],
    boolean: ["stop-on-failure"],
    default: { "stop-on-failure": false },
  });

  const baseUrlInput = (args["base-url"] as string | undefined) ??
    Deno.env.get("SUPABASE_BASE_URL") ?? "";
  const anonKey = (args["anon-key"] as string | undefined) ??
    Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const functionsUrlInput = (args["functions-url"] as string | undefined) ??
    Deno.env.get("SUPABASE_FUNCTIONS_URL") ??
    `${trimTrailingSlash(baseUrlInput)}/functions/v1`;

  const missing: string[] = [];
  if (!baseUrlInput) missing.push("--base-url or SUPABASE_BASE_URL");
  if (!anonKey) missing.push("--anon-key or SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    console.error(
      `Error: Missing required configuration: ${missing.join(", ")}`,
    );
    Deno.exit(1);
  }

  return {
    baseUrl: trimTrailingSlash(baseUrlInput),
    functionsBaseUrl: ensureTrailingSlash(trimTrailingSlash(functionsUrlInput)),
    anonKey,
    stopOnFailure: Boolean(args["stop-on-failure"]),
  };
}

async function loadArtifact(path: string): Promise<RecordingArtifact> {
  const contents = await Deno.readTextFile(path);
  const artifact = JSON.parse(contents) as RecordingArtifact;
  if (!artifact.requests || !Array.isArray(artifact.requests)) {
    console.error("Error: recording artifact is missing requests array.");
    Deno.exit(1);
  }
  return artifact;
}

function requireVariable(
  name: string,
  variables: PlaceholderStore,
): PlaceholderValue {
  const record = variables.get(name);
  if (!record) {
    throw new Error(`Missing value for placeholder {{var:${name}}}`);
  }
  return record;
}

function resolvePlaceholdersInString(
  value: string,
  variables: PlaceholderStore,
): string {
  return value.replace(
    PLACEHOLDER_REGEXP,
    (_match, name: string) => requireVariable(name, variables).text,
  );
}

function resolveJsonValue(
  value: unknown,
  variables: PlaceholderStore,
): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\{\{var:([A-Z0-9_:-]+)\}\}$/);
    if (match) {
      return requireVariable(match[1], variables).raw ??
        requireVariable(match[1], variables).text;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveJsonValue(entry, variables));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = resolveJsonValue(child, variables);
    }
    return result;
  }
  return value;
}

function resolvePlaceholdersInPath(
  path: string,
  variables: PlaceholderStore,
): string {
  if (!path.includes("{{")) return path;
  return resolvePlaceholdersInString(path, variables);
}

function resolvePlaceholdersInQuery(
  query: Record<string, string>,
  variables: PlaceholderStore,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.append(key, resolvePlaceholdersInString(value, variables));
  }
  return params;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type BuiltRequestBody = {
  body?: BodyInit;
  headers: HeadersInit;
};

function resolveFormScalar(
  value: unknown,
  variables: PlaceholderStore,
): string {
  if (typeof value === "string") {
    return resolvePlaceholdersInString(value, variables);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveFormScalar(item, variables)).join(",");
  }
  return String(value);
}

function buildRequestBody(
  entry: RecordedRequest,
  variables: PlaceholderStore,
): BuiltRequestBody {
  const headers: Record<string, string> = {};
  const { bodyType, body } = entry.request;

  if (bodyType === "empty" || body === null || body === undefined) {
    return { headers };
  }

  if (bodyType === "json") {
    const resolved = resolveJsonValue(body, variables);
    headers["Content-Type"] = "application/json";
    return { body: JSON.stringify(resolved), headers };
  }

  if (bodyType === "text") {
    const resolved = resolveFormScalar(body, variables);
    headers["Content-Type"] = "text/plain";
    return { body: String(resolved), headers };
  }

  if (bodyType === "bytes") {
    if (typeof body !== "string") {
      throw new Error("Expected base64 string for byte payload");
    }
    const resolved = resolvePlaceholdersInString(body, variables);
    return {
      body: decodeBase64(resolved),
      headers: { ...headers, "Content-Type": "application/octet-stream" },
    };
  }

  if (bodyType === "form-data") {
    if (!body || typeof body !== "object") {
      throw new Error("Expected object payload for form-data request");
    }
    const { fields = {}, files = [] } = body as {
      fields?: Record<string, unknown>;
      files?: Array<Record<string, unknown>>;
    };
    const form = new FormData();

    for (const [key, raw] of Object.entries(fields)) {
      const resolved = resolveJsonValue(raw, variables);
      if (Array.isArray(resolved)) {
        for (const item of resolved) {
          form.append(key, item == null ? "" : String(item));
        }
      } else {
        form.append(key, resolved == null ? "" : String(resolved));
      }
    }

    for (const descriptor of files ?? []) {
      const name = typeof descriptor.name === "string"
        ? descriptor.name
        : "file";
      const filename = typeof descriptor.filename === "string"
        ? descriptor.filename
        : basename(name);
      const contentType = typeof descriptor.contentType === "string"
        ? descriptor.contentType
        : (typeof descriptor.type === "string"
          ? descriptor.type
          : "application/octet-stream");
      const encodedContent = typeof descriptor.content === "string"
        ? resolvePlaceholdersInString(descriptor.content, variables)
        : "";
      const bytes = decodeBase64(encodedContent);
      const blob = new Blob([bytes], { type: contentType });
      form.append(name, blob, filename);
    }

    return { body: form, headers };
  }

  throw new Error(`Unsupported body type: ${bodyType}`);
}

function coerceToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

// String similarity calculation using Levenshtein distance
function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim();
  const s2 = str2.trim();
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;
  
  const matrix: number[][] = [];
  const len1 = s1.length;
  const len2 = s2.length;
  
  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  const maxLen = Math.max(len1, len2);
  const distance = matrix[len1][len2];
  return maxLen === 0 ? 1.0 : (maxLen - distance) / maxLen;
}

// Select appropriate matcher for a given path
function selectMatcherForPath(path: string): FieldMatcher | null {
  for (const matcher of FIELD_MATCHERS) {
    if (typeof matcher.pathPattern === "string") {
      if (path === matcher.pathPattern) return matcher;
    } else {
      if (matcher.pathPattern.test(path)) return matcher;
    }
  }
  return null;
}

// Select appropriate delay rule for a given request
function selectDelayForRequest(method: string, path: string): number {
  for (const rule of DELAY_RULES) {
    // Check if method matches (or wildcard)
    if (rule.method !== "*" && rule.method !== method.toUpperCase()) {
      continue;
    }
    
    // Check if path matches
    if (typeof rule.pathPattern === "string") {
      if (path === rule.pathPattern) return rule.delaySeconds;
    } else {
      if (rule.pathPattern.test(path)) return rule.delaySeconds;
    }
  }
  return 0; // no delay
}

// Fuzzy matching with threshold
function matchFuzzy(expected: string, actual: string, threshold: number): MatchResult {
  const similarity = calculateStringSimilarity(expected, actual);
  const matches = similarity >= threshold;
  
  return {
    matches,
    similarity,
    message: matches 
      ? `Fuzzy matched (${(similarity * 100).toFixed(1)}% similar)`
      : `Fuzzy match failed (${(similarity * 100).toFixed(1)}% similar, threshold: ${(threshold * 100).toFixed(1)}%)`
  };
}

// Exact matching (current behavior)
function matchExact(expected: string, actual: string): MatchResult {
  const matches = expected === actual;
  return {
    matches,
    message: matches ? "Exact match" : "Exact match failed"
  };
}

function formatValueForDisplay(
  value: unknown,
  maxLength: number = 200,
): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "string") {
    if (value.length <= maxLength) {
      return `"${value}"`;
    }
    return `"${
      value.substring(0, maxLength)
    }..." (truncated, ${value.length} chars)`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.slice(0, 3).map((item) =>
      formatValueForDisplay(item, 50)
    );
    const suffix = value.length > 3 ? `, ...] (${value.length} items)` : "]";
    return `[${items.join(", ")}${suffix}`;
  }

  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value, null, 2);
      if (json.length <= maxLength) {
        return json;
      }
      return `${
        json.substring(0, maxLength)
      }... (truncated, ${json.length} chars)`;
    } catch {
      return "[object Object] (circular reference)";
    }
  }

  return String(value);
}

function getTypeDescription(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array (${value.length} items)`;
  if (typeof value === "object") return "object";
  return typeof value;
}

function formatRequestDetails(entry: RecordedRequest): string {
  const lines: string[] = [];
  lines.push(`• Method: ${entry.request.method}`);
  lines.push(`• Path: ${entry.request.path}`);

  if (Object.keys(entry.request.query).length > 0) {
    const queryStr = new URLSearchParams(entry.request.query).toString();
    lines.push(`• Query: ${queryStr}`);
  }

  if (
    entry.request.bodyType !== "empty" && entry.request.body !== null &&
    entry.request.body !== undefined
  ) {
    if (entry.request.bodyType === "json") {
      lines.push(
        `• Body: (json) ${formatValueForDisplay(entry.request.body, 100)}`,
      );
    } else if (entry.request.bodyType === "form-data") {
      const body = entry.request.body as {
        fields?: Record<string, unknown>;
        files?: unknown[];
      };
      const fieldCount = Object.keys(body.fields || {}).length;
      const fileCount = (body.files || []).length;
      lines.push(
        `• Body: (form-data) ${fieldCount} fields, ${fileCount} files`,
      );
      if (fieldCount > 0) {
        const sampleFields = Object.entries(body.fields || {}).slice(0, 2);
        const fieldPreview = sampleFields.map(([k, v]) =>
          `${k}: ${formatValueForDisplay(v, 30)}`
        ).join(", ");
        const more = fieldCount > 2 ? `, ...` : "";
        lines.push(`  Fields: { ${fieldPreview}${more} }`);
      }
    } else {
      lines.push(
        `• Body: (${entry.request.bodyType}) ${
          formatValueForDisplay(entry.request.body, 100)
        }`,
      );
    }
  }

  return lines.join("\n");
}

function formatResponseDetails(status: number, body: unknown): string {
  const lines: string[] = [];
  lines.push(`• Status: ${status}`);
  lines.push(`• Body: ${formatValueForDisplay(body, 200)}`);
  return lines.join("\n");
}

function compareBodies(
  expected: unknown,
  actual: unknown,
  variables: PlaceholderStore,
  path: string,
  errors: string[],
  warnings: string[],
) {
  if (typeof expected === "string") {
    const match = expected.match(/^\{\{var:([A-Z0-9_:-]+)\}\}$/);
    if (match) {
      const [, name] = match;
      if (actual === undefined || actual === null) {
        errors.push(
          `${path}: expected value for placeholder {{var:${name}}} but received ${
            getTypeDescription(actual)
          } ${formatValueForDisplay(actual)}`,
        );
        return;
      }
      const record: PlaceholderValue = {
        raw: actual,
        text: coerceToString(actual),
      };
      const existing = variables.get(name);
      if (existing && existing.text !== record.text) {
        errors.push(
          `${path}: placeholder {{var:${name}}} mismatch.\n  Expected: ${
            formatValueForDisplay(existing.raw)
          }\n  Received: ${formatValueForDisplay(actual)}`,
        );
        return;
      }
      variables.set(name, record);
      return;
    }
  }

  if (expected === null || expected === undefined) {
    if (actual !== expected) {
      errors.push(
        `${path}:\n  Expected: ${getTypeDescription(expected)} ${
          formatValueForDisplay(expected)
        }\n  Received: ${getTypeDescription(actual)} ${
          formatValueForDisplay(actual)
        }`,
      );
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      errors.push(
        `${path}:\n  Expected: ${getTypeDescription(expected)} ${
          formatValueForDisplay(expected)
        }\n  Received: ${getTypeDescription(actual)} ${
          formatValueForDisplay(actual)
        }`,
      );
      return;
    }
    if (expected.length !== actual.length) {
      errors.push(
        `${path}: array length mismatch.\n  Expected: ${expected.length} items ${
          formatValueForDisplay(expected)
        }\n  Received: ${actual.length} items ${formatValueForDisplay(actual)}`,
      );
      return;
    }
    expected.forEach((item, index) => {
      compareBodies(
        item,
        actual[index],
        variables,
        `${path}[${index}]`,
        errors,
        warnings,
      );
    });
    return;
  }

  if (typeof expected === "object") {
    if (!actual || typeof actual !== "object") {
      errors.push(
        `${path}:\n  Expected: ${getTypeDescription(expected)} ${
          formatValueForDisplay(expected)
        }\n  Received: ${getTypeDescription(actual)} ${
          formatValueForDisplay(actual)
        }`,
      );
      return;
    }
    for (
      const [key, value] of Object.entries(expected as Record<string, unknown>)
    ) {
      const childPath = `${path}.${key}`;
      compareBodies(
        value,
        (actual as Record<string, unknown>)[key],
        variables,
        childPath,
        errors,
        warnings,
      );
    }
    return;
  }

  if (expected !== actual) {
    // Check if this field should use special matching
    const matcher = selectMatcherForPath(path);
    
    if (matcher && matcher.strategy === "ignore") {
      // Ignore differences for this field
      warnings.push(
        `⚠️  ${path}: Ignoring field differences\n  Expected: ${formatValueForDisplay(expected)}\n  Received: ${formatValueForDisplay(actual)}`
      );
    } else if (matcher && matcher.strategy === "fuzzy" && typeof expected === "string" && typeof actual === "string") {
      const threshold = matcher.threshold ?? FUZZY_MATCH_THRESHOLD;
      const result = matchFuzzy(expected, actual, threshold);
      
      if (result.matches) {
        // Add warning instead of error for fuzzy matches
        warnings.push(
          `⚠️  ${path}: ${result.message}\n  Expected: ${formatValueForDisplay(expected)}\n  Received: ${formatValueForDisplay(actual)}`
        );
      } else {
        // Add error for fuzzy match failures
        errors.push(
          `${path}: ${result.message}\n  Expected: ${getTypeDescription(expected)} ${
            formatValueForDisplay(expected)
          }\n  Received: ${getTypeDescription(actual)} ${
            formatValueForDisplay(actual)
          }`,
        );
      }
    } else {
      // Use exact matching for non-fuzzy fields
      errors.push(
        `${path}:\n  Expected: ${getTypeDescription(expected)} ${
          formatValueForDisplay(expected)
        }\n  Received: ${getTypeDescription(actual)} ${
          formatValueForDisplay(actual)
        }`,
      );
    }
  }
}

async function replayRequest(
  entry: RecordedRequest,
  config: RuntimeConfig,
  tokens: Tokens,
  variables: PlaceholderStore,
): Promise<
  { ok: boolean; errors: string[]; warnings: string[]; response: Response; body: unknown }
> {
  const resolvedPath = resolvePlaceholdersInPath(entry.request.path, variables);
  const queryParams = resolvePlaceholdersInQuery(
    entry.request.query ?? {},
    variables,
  );

  // Apply delay if configured
  const delaySeconds = selectDelayForRequest(entry.request.method, resolvedPath);
  if (delaySeconds > 0) {
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
  }

  const url = new URL(resolvedPath.replace(/^\//, ""), config.functionsBaseUrl);
  queryParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const { body, headers: bodyHeaders } = buildRequestBody(entry, variables);
  const headers = buildAuthHeaders(tokens, bodyHeaders);

  const response = await fetch(url.toString(), {
    method: entry.request.method,
    headers,
    body,
  });

  const errors: string[] = [];
  const warnings: string[] = [];
  if (response.status !== entry.response.status) {
    errors.push(
      `status: expected ${entry.response.status}, received ${response.status}`,
    );
  }

  let parsedBody: unknown = null;
  if (response.status !== 204) {
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (!text) {
      parsedBody = null;
    } else if (
      contentType.includes("application/json") || contentType.includes("+json")
    ) {
      try {
        parsedBody = JSON.parse(text);
      } catch (_error) {
        errors.push("body: failed to parse JSON response");
        parsedBody = text;
      }
    } else {
      parsedBody = text;
    }
  }

  compareBodies(entry.response.body, parsedBody, variables, "$", errors, warnings);

  return { ok: errors.length === 0, errors, warnings, response, body: parsedBody };
}

async function replayArtifact(
  sessionPath: string,
  testCaseName: string,
  config: RuntimeConfig,
  tokens: Tokens,
): Promise<{ stats: ReplayStats; aborted: boolean }> {
  const artifact = await loadArtifact(sessionPath);

  const runtimeVariables: PlaceholderStore = new Map<
    string,
    PlaceholderValue
  >();
  const stats: ReplayStats = {
    total: artifact.requests.length,
    passed: 0,
    failed: 0,
  };
  const sessionLabel = `${testCaseName} :: ${basename(sessionPath)}`;

  console.log(
    `\nReplaying ${stats.total} request(s) for ${sessionLabel} against ${config.baseUrl}`,
  );

  let aborted = false;

  for (let index = 0; index < artifact.requests.length; index += 1) {
    const step = artifact.requests[index];
    const label = `${
      index + 1
    }/${artifact.requests.length} ${step.request.method.toUpperCase()} ${step.request.path}`;

    try {
      const result = await replayRequest(
        step,
        config,
        tokens,
        runtimeVariables,
      );
      if (result.ok) {
        stats.passed += 1;
        if (result.warnings.length > 0) {
          console.log(`✅ ${label}`);
          for (const warning of result.warnings) {
            console.log(`   ${warning}`);
          }
        } else {
          console.log(`✅ ${label}`);
        }
      } else {
        stats.failed += 1;
        console.error(`❌ ${label}`);
        console.error("");
        console.error("   Request Details:");
        console.error(
          `   ${formatRequestDetails(step).replace(/\n/g, "\n   ")}`,
        );
        console.error("");
        console.error("   Expected Response:");
        console.error(
          `   ${
            formatResponseDetails(step.response.status, step.response.body)
              .replace(/\n/g, "\n   ")
          }`,
        );
        console.error("");
        console.error("   Actual Response:");
        console.error(
          `   ${
            formatResponseDetails(result.response.status, result.body).replace(
              /\n/g,
              "\n   ",
            )
          }`,
        );
        console.error("");
        console.error("   Comparison Errors:");
        for (const message of result.errors) {
          console.error(`   ${message.replace(/\n/g, "\n   ")}`);
        }
        console.error("");
        if (config.stopOnFailure) {
          aborted = true;
          break;
        }
      }
    } catch (error) {
      stats.failed += 1;
      console.error(`❌ ${label}`);
      console.error("");
      console.error("   Request Details:");
      console.error(`   ${formatRequestDetails(step).replace(/\n/g, "\n   ")}`);
      console.error("");
      console.error(
        `   Unexpected error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      console.error("");
      if (config.stopOnFailure) {
        aborted = true;
        break;
      }
    }
  }

  console.log(
    `Result for ${sessionLabel}: Passed ${stats.passed}/${stats.total}, Failed ${stats.failed}/${stats.total}`,
  );

  return { stats, aborted };
}

async function run() {
  const config = loadConfig();
  const testCases = await discoverTestCases();
  const selectedCases = await promptTestCaseSelection(testCases);

  const totals: ReplayStats = { total: 0, passed: 0, failed: 0 };

  for (const testCase of selectedCases) {
    console.log(`\n=== ${testCase.displayName} ===`);

    // Create a new anon account for each test case
    console.log("Creating new anonymous user account for this test case...");
    let tokens: Tokens;
    let userId: string;
    try {
      const authResult = await signInAnonymously(
        config.baseUrl,
        config.anonKey,
      );
      tokens = { ...authResult.tokens, userId: authResult.userId };
      userId = authResult.userId;
    } catch (error) {
      console.error(
        `Error: failed to create anonymous user: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      Deno.exit(1);
    }
    console.log(`Created anonymous user: ${userId}`);

    const { stats, aborted } = await replayArtifact(
      testCase.filePath,
      testCase.displayName,
      config,
      tokens,
    );
    totals.total += stats.total;
    totals.passed += stats.passed;
    totals.failed += stats.failed;

    if (config.stopOnFailure && aborted) {
      console.log(
        "\nStopping early because --stop-on-failure was set and a failure occurred.",
      );
      console.log(
        `Overall: Passed ${totals.passed}/${totals.total}, Failed ${totals.failed}/${totals.total}`,
      );
      if (totals.failed > 0) {
        Deno.exit(1);
      }
      return;
    }
  }

  console.log(
    `\nOverall: Passed ${totals.passed}/${totals.total}, Failed ${totals.failed}/${totals.total}`,
  );

  if (totals.failed > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await run();
}
