#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read

import { basename, dirname, fromFileUrl, join } from "std/path";
import {
  type AuthTokens,
  buildAuthHeaders,
  loadEnv,
  signInAnonymously,
} from "./setup.ts";
import { loadState } from "./local-env.ts";

type RecordingArtifact = {
  recordingSessionId: string;
  recordedUserId: string;
  exportedAt: string;
  totalEntries: number;
  testCase?: string;
  variables?: Record<string, string>;
  requests: RecordedRequest[];
};

type ResponseBodyType = "json" | "text" | "bytes" | "empty" | "sse";

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
    bodyType?: ResponseBodyType;
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
type ReplacementStore = Map<string, string>;

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

type ReplacementRule = {
  fieldName: string;           // e.g., "clientActivityId"
  strategy: "uuid";            // extensible for future replacement types
};

// Configuration for field matching strategies
const FIELD_MATCHERS: FieldMatcher[] = [
  { pathPattern: /\.annotatedText$/, strategy: "fuzzy", threshold: 0.90 },
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

// Configuration for field value replacements
const REPLACEMENT_RULES: ReplacementRule[] = [
  { 
    fieldName: "clientActivityId", 
    strategy: "uuid"
  }
  // To add more fields, simply add more rules:
  // { fieldName: "sessionId", strategy: "uuid" },
  // { fieldName: "requestId", strategy: "uuid" }
];

const FUZZY_MATCH_THRESHOLD = 0.95;

// Generate a RFC 4122 v4 UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16).toLowerCase();
  });
}

// Scan artifact for field values that need replacement and build mapping
// This finds all unique values for fields specified in REPLACEMENT_RULES and generates new UUIDs for them
function scanForReplacementValues(artifact: RecordingArtifact): ReplacementStore {
  const replacementStore: ReplacementStore = new Map();
  const fieldValues = new Set<string>();

  // First pass: Find all field values that need replacement in requests
  for (const request of artifact.requests) {
    // Check query parameters
    for (const [key, value] of Object.entries(request.request.query)) {
      if (shouldReplaceField(key) && typeof value === 'string') {
        fieldValues.add(value);
      }
    }

    // Check request body fields
    if (request.request.body && typeof request.request.body === 'object') {
      const body = request.request.body as Record<string, unknown>;
      if (body.fields && typeof body.fields === 'object') {
        for (const [key, value] of Object.entries(body.fields)) {
          if (shouldReplaceField(key) && typeof value === 'string') {
            fieldValues.add(value);
          }
        }
      }
    }
  }

  // Generate new UUIDs for each unique field value
  for (const originalValue of fieldValues) {
    replacementStore.set(originalValue, generateUUID());
  }

  return replacementStore;
}

// Check if a field should be replaced based on replacement rules
function shouldReplaceField(fieldName: string): boolean {
  return REPLACEMENT_RULES.some(rule => rule.fieldName === fieldName);
}

// Replace UUID values anywhere they appear in the document
// This recursively traverses objects/arrays and replaces any string that matches an original UUID
function replaceUUIDsInValue(value: unknown, replacements: ReplacementStore): unknown {
  if (typeof value === 'string') {
    // Check if this string matches any of our original UUIDs (case-insensitive)
    for (const [original, replacement] of replacements) {
      if (value.toLowerCase() === original.toLowerCase()) {
        return replacement;
      }
    }
    return value;
  }
  
  if (Array.isArray(value)) {
    return value.map(item => replaceUUIDsInValue(item, replacements));
  }
  
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = replaceUUIDsInValue(child, replacements);
    }
    return result;
  }
  
  return value;
}

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
const TESTCASES_ROOT = scriptDir;

type SuiteName = string;

function resolveSuitePath(suite: SuiteName): string {
  return join(TESTCASES_ROOT, suite);
}

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

async function discoverTestCases(suite: SuiteName): Promise<TestCase[]> {
  const cases: TestCase[] = [];
  const suitePath = resolveSuitePath(suite);

  try {
    for await (const entry of Deno.readDir(suitePath)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const slug = entry.name.replace(/\.json$/, "");
      cases.push({
        slug,
        displayName: formatTestCaseName(slug),
        filePath: join(suitePath, entry.name),
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`Error: Suite "${suite}" not found under ${TESTCASES_ROOT}.`);
      Deno.exit(1);
    }
    throw error;
  }

  cases.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return cases;
}

async function promptTestCaseSelection(
  cases: TestCase[],
  suite: SuiteName,
): Promise<TestCase[]> {
  if (cases.length === 0) {
    console.error(
      `Error: No recorded regression test cases were found under suite "${suite}".`,
    );
    Deno.exit(1);
  }

  if (cases.length === 1) {
    console.log(`Only one test case found. Running: ${cases[0].displayName}`);
    return cases;
  }

  // Display available test cases
  console.log(`\nAvailable test cases in suite "${suite}":`);
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

function selectCasesFromArgument(
  cases: TestCase[],
  argument: string,
): TestCase[] {
  const trimmed = argument.trim();
  if (trimmed.length === 0) {
    console.log("Running all test cases");
    return cases;
  }

  if (trimmed.toLowerCase() === "all") {
    console.log("Running all test cases");
    return cases;
  }

  const indices = parseSelection(trimmed, cases.length);
  if (indices.length === 0) {
    throw new Error("No valid selections were provided.");
  }

  const selectedCases = indices.map((index) => {
    const selected = cases[index - 1];
    if (!selected) {
      throw new Error(
        `Selection ${index} is out of range (1-${cases.length}).`,
      );
    }
    return selected;
  });

  console.log(
    `Running ${selectedCases.length} selected test case(s): ${
      selectedCases.map((c) => c.displayName).join(", ")
    }`,
  );

  return selectedCases;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

async function loadConfig(): Promise<RuntimeConfig> {
  // Try to load local environment state first
  const localState = await loadState();

  const baseUrlInput = localState?.baseUrl ??
    Deno.env.get("SUPABASE_BASE_URL") ?? "";
  const anonKey = localState?.anonKey ??
    Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const functionsUrlInput = localState?.functionsUrl ??
    Deno.env.get("SUPABASE_FUNCTIONS_URL") ??
    `${trimTrailingSlash(baseUrlInput)}/functions/v1`;

  const missing: string[] = [];
  if (!baseUrlInput) missing.push("SUPABASE_BASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    console.error(
      `Error: Missing required configuration: ${missing.join(", ")}`,
    );
    Deno.exit(1);
  }

  if (localState?.running) {
    console.log("🔗 Using local Supabase environment");
  }

  const stopOnFailureEnv = parseBoolean(Deno.env.get("RUN_TESTCASE_STOP_ON_FAILURE"));

  return {
    baseUrl: trimTrailingSlash(baseUrlInput),
    functionsBaseUrl: ensureTrailingSlash(trimTrailingSlash(functionsUrlInput)),
    anonKey,
    stopOnFailure: stopOnFailureEnv ?? false,
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

function extractPlaceholdersFromString(value: string): string[] {
  const names: string[] = [];
  const regex = /\{\{var:([A-Z0-9_:-]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function resolveJsonValue(
  value: unknown,
  variables: PlaceholderStore,
  replacements?: ReplacementStore,
): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\{\{var:([A-Z0-9_:-]+)\}\}$/);
    if (match) {
      return requireVariable(match[1], variables).raw ??
        requireVariable(match[1], variables).text;
    }
    // Apply UUID replacements if provided
    if (replacements) {
      return replaceUUIDsInValue(value, replacements);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveJsonValue(entry, variables, replacements));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = resolveJsonValue(child, variables, replacements);
    }
    return result;
  }
  return value;
}

function collectPlaceholdersFromJson(
  value: unknown,
  callback: (name: string) => void,
): void {
  if (typeof value === "string") {
    for (const name of extractPlaceholdersFromString(value)) {
      callback(name);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlaceholdersFromJson(item, callback);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectPlaceholdersFromJson(child, callback);
    }
  }
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
  replacements?: ReplacementStore,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    let resolved = resolvePlaceholdersInString(value, variables);
    // Apply UUID replacements if provided
    if (replacements) {
      resolved = replaceUUIDsInValue(resolved, replacements) as string;
    }
    params.append(key, resolved);
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

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type BuiltRequestBody = {
  body?: BodyInit;
  headers: HeadersInit;
};

function resolveFormScalar(
  value: unknown,
  variables: PlaceholderStore,
  replacements?: ReplacementStore,
): string {
  if (typeof value === "string") {
    let resolved = resolvePlaceholdersInString(value, variables);
    // Apply UUID replacements if provided
    if (replacements) {
      resolved = replaceUUIDsInValue(resolved, replacements) as string;
    }
    return resolved;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveFormScalar(item, variables, replacements)).join(",");
  }
  return String(value);
}

function buildRequestBody(
  entry: RecordedRequest,
  variables: PlaceholderStore,
  replacements?: ReplacementStore,
): BuiltRequestBody {
  const headers: Record<string, string> = {};
  const { bodyType, body } = entry.request;

  if (bodyType === "empty" || body === null || body === undefined) {
    return { headers };
  }

  if (bodyType === "json") {
    const resolved = resolveJsonValue(body, variables, replacements);
    headers["Content-Type"] = "application/json";
    return { body: JSON.stringify(resolved), headers };
  }

  if (bodyType === "text") {
    const resolved = resolveFormScalar(body, variables, replacements);
    headers["Content-Type"] = "text/plain";
    return { body: String(resolved), headers };
  }

  if (bodyType === "bytes") {
    if (typeof body !== "string") {
      throw new Error("Expected base64 string for byte payload");
    }
    const resolved = resolvePlaceholdersInString(body, variables);
    return {
      body: new Uint8Array(decodeBase64(resolved)),
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
      const resolved = resolveJsonValue(raw, variables, replacements);
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
      const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
      form.append(name, blob, filename);
    }

    return { body: form, headers };
  }

  throw new Error(`Unsupported body type: ${bodyType}`);
}

function looksLikeRecordedSseEvents(value: unknown): value is Array<{ event: string; data: unknown }> {
  return Array.isArray(value) &&
    value.every((item) =>
      isPlainObject(item) && typeof item.event === "string"
    );
}

function determineResponseBodyType(response: RecordedRequest["response"]): ResponseBodyType {
  if (response.bodyType) {
    return response.bodyType;
  }

  const { body } = response;

  if (body === null || body === undefined) {
    return "empty";
  }

  if (typeof body === "string") {
    return "text";
  }

  if (isPlainObject(body)) {
    const record = body as Record<string, unknown>;
    const typeValue = record["type"];
    const type = typeof typeValue === "string" ? typeValue : undefined;
    const payload = record["payload"];
    const value = record["value"];

    if (type === "sse" && looksLikeRecordedSseEvents(payload)) {
      return "sse";
    }

    if (type === "bytes" && typeof value === "string") {
      return "bytes";
    }

    if (type === "empty") {
      return "empty";
    }
  }

  return "json";
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function calculateTokenSetSimilarity(str1: string, str2: string): number {
  const tokens1 = tokenize(str1);
  const tokens2 = tokenize(str2);

  if (tokens1.length === 0 || tokens2.length === 0) {
    return 0.0;
  }

  const counts1 = new Map<string, number>();
  const counts2 = new Map<string, number>();

  for (const token of tokens1) {
    counts1.set(token, (counts1.get(token) ?? 0) + 1);
  }
  for (const token of tokens2) {
    counts2.set(token, (counts2.get(token) ?? 0) + 1);
  }

  let intersection = 0;
  for (const [token, count1] of counts1) {
    const count2 = counts2.get(token);
    if (count2 !== undefined) {
      intersection += Math.min(count1, count2);
    }
  }

  const minLength = Math.min(tokens1.length, tokens2.length);
  return minLength === 0 ? 0.0 : intersection / minLength;
}

function calculateLcsSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim();
  const s2 = str2.trim();

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 * len2 > 250000) {
    return 0.0;
  }

  let prev = new Uint32Array(len2 + 1);
  let curr = new Uint32Array(len2 + 1);

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  const lcsLength = prev[len2];
  return Math.min(len1, len2) === 0 ? 0.0 : lcsLength / Math.min(len1, len2);
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
  const levenshtein = calculateStringSimilarity(expected, actual);
  const lcs = calculateLcsSimilarity(expected, actual);
  const tokenSet = calculateTokenSetSimilarity(expected, actual);
  const similarity = Math.max(levenshtein, lcs, tokenSet);
  const matches = similarity >= threshold;
  const details = `scores — levenshtein ${(levenshtein * 100).toFixed(1)}%, lcs ${(lcs * 100).toFixed(1)}%, tokens ${(tokenSet * 100).toFixed(1)}%`;

  return {
    matches,
    similarity,
    message: matches
      ? `Fuzzy matched (${(similarity * 100).toFixed(1)}% similar; ${details})`
      : `Fuzzy match failed (${(similarity * 100).toFixed(1)}% similar, threshold: ${(threshold * 100).toFixed(1)}%; ${details})`
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

function formatResponseDetails(
  status: number,
  body: unknown,
  bodyType?: ResponseBodyType,
): string {
  const lines: string[] = [];
  lines.push(`• Status: ${status}`);
  const bodyLabel = bodyType ? `• Body: (${bodyType})` : "• Body:";
  lines.push(`${bodyLabel} ${formatValueForDisplay(body, 200)}`);
  return lines.join("\n");
}

function compareBodies(
  expected: unknown,
  actual: unknown,
  variables: PlaceholderStore,
  path: string,
  errors: string[],
  warnings: string[],
  replacements?: ReplacementStore,
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
        replacements,
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
        replacements,
      );
    }
    return;
  }

  // Replace UUIDs in expected value if replacements are provided
  const expectedValue = replacements ? replaceUUIDsInValue(expected, replacements) : expected;

  if (expectedValue !== actual) {
    // Check if this field should use special matching
    const matcher = selectMatcherForPath(path);
    
    if (matcher && matcher.strategy === "ignore") {
      // Silently ignore differences for this field
      return;
    } else if (matcher && matcher.strategy === "fuzzy" && typeof expectedValue === "string" && typeof actual === "string") {
      const threshold = matcher.threshold ?? FUZZY_MATCH_THRESHOLD;
      const result = matchFuzzy(expectedValue, actual, threshold);
      
      if (result.matches) {
        // Add warning instead of error for fuzzy matches
        warnings.push(
          `⚠️  ${path}: ${result.message}\n  Expected: ${formatValueForDisplay(expectedValue)}\n  Received: ${formatValueForDisplay(actual)}`
        );
      } else {
        // Add error for fuzzy match failures
        errors.push(
          `${path}: ${result.message}\n  Expected: ${getTypeDescription(expectedValue)} ${
            formatValueForDisplay(expectedValue)
          }\n  Received: ${getTypeDescription(actual)} ${
            formatValueForDisplay(actual)
          }`,
        );
      }
    } else {
      // Use exact matching for non-fuzzy fields
      errors.push(
        `${path}:\n  Expected: ${getTypeDescription(expectedValue)} ${
          formatValueForDisplay(expectedValue)
        }\n  Received: ${getTypeDescription(actual)} ${
          formatValueForDisplay(actual)
        }`,
      );
    }
  }
}

type RecordedSseEvent = { event: string; data: unknown };

function extractEventsFromBuffer(
  buffer: string,
  events: RecordedSseEvent[],
): string {
  let working = buffer;

  while (true) {
    const separatorIndex = working.indexOf("\n\n");
    if (separatorIndex === -1) {
      break;
    }

    const rawBlock = working.slice(0, separatorIndex);
    working = working.slice(separatorIndex + 2);

    const normalized = rawBlock.replace(/\r/g, "");
    if (!normalized.trim()) {
      continue;
    }

    const lines = normalized.split("\n");
    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line) continue;
      const colonIndex = line.indexOf(":");
      const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
      const value = colonIndex === -1 ? "" : line.slice(colonIndex + 1).replace(/^\s*/, "");

      switch (field.trim()) {
        case "event":
          if (value.length > 0) {
            eventName = value;
          }
          break;
        case "data":
          dataLines.push(value);
          break;
        default:
          break;
      }
    }

    const rawData = dataLines.join("\n");
    let parsed: unknown = rawData;
    if (rawData.length === 0) {
      parsed = null;
    } else {
      try {
        parsed = JSON.parse(rawData);
      } catch (_error) {
        parsed = rawData;
      }
    }

    events.push({ event: eventName, data: parsed });
  }

  return working;
}

async function parseSSEStream(stream: ReadableStream<Uint8Array>): Promise<RecordedSseEvent[]> {
  const events: RecordedSseEvent[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = extractEventsFromBuffer(buffer, events);
  }

  buffer += decoder.decode();
  extractEventsFromBuffer(buffer, events);

  return events;
}

function compareSSEEvents(
  expected: unknown,
  actual: RecordedSseEvent[],
  variables: PlaceholderStore,
  errors: string[],
  warnings: string[],
  replacements?: ReplacementStore,
) {
  if (!Array.isArray(expected)) {
    errors.push("Expected SSE response body to be an array of events");
    return;
  }

  if (expected.length !== actual.length) {
    errors.push(
      `SSE events length mismatch. Expected ${expected.length}, received ${actual.length}`,
    );
    return;
  }

  expected.forEach((expectedEvent, index) => {
    const actualEvent = actual[index];
    if (!isPlainObject(expectedEvent)) {
      errors.push(`SSE event[${index}] is not an object in expected recording`);
      return;
    }

    const expectedRecord = expectedEvent as Record<string, unknown>;
    const expectedName = expectedRecord.event;
    const expectedData = expectedRecord.data;

    if (typeof expectedName !== "string") {
      errors.push(`SSE event[${index}] is missing its event name in recording`);
      return;
    }

    if (expectedName !== actualEvent.event) {
      errors.push(
        `SSE event[${index}]: expected "${expectedName}" but received "${actualEvent.event}"`,
      );
      return;
    }

    compareBodies(
      expectedData,
      actualEvent.data,
      variables,
      `$.response.body[${index}].data`,
      errors,
      warnings,
      replacements,
    );
  });
}

async function replayRequest(
  entry: RecordedRequest,
  config: RuntimeConfig,
  tokens: Tokens,
  variables: PlaceholderStore,
  replacements?: ReplacementStore,
): Promise<
  { ok: boolean; errors: string[]; warnings: string[]; response: Response; body: unknown; bodyType: ResponseBodyType }
> {
  const resolvedPath = resolvePlaceholdersInPath(entry.request.path, variables);
  const queryParams = resolvePlaceholdersInQuery(
    entry.request.query ?? {},
    variables,
    replacements,
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

  const { body, headers: bodyHeaders } = buildRequestBody(entry, variables, replacements);
  const headers = buildAuthHeaders(tokens, bodyHeaders);

  const response = await fetch(url.toString(), {
    method: entry.request.method,
    headers,
    body,
  });

  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedResponseType = determineResponseBodyType(entry.response);
  let actualBodyType: ResponseBodyType = expectedResponseType;
  const contentTypeHeader = response.headers.get("content-type") ?? "";
  const normalizedContentType = contentTypeHeader.toLowerCase();
  if (response.status !== entry.response.status) {
    errors.push(
      `status: expected ${entry.response.status}, received ${response.status}`,
    );
  }

  let parsedBody: unknown = null;
  if (expectedResponseType === "sse") {
    const bodyStream = response.body;
    if (!normalizedContentType.includes("text/event-stream")) {
      warnings.push(
        `⚠️  Response content-type "${contentTypeHeader}" does not match expected SSE stream`,
      );
    }
    if (!bodyStream) {
      errors.push("body: expected SSE stream but response had no readable body");
    } else {
      const events = await parseSSEStream(bodyStream);
      parsedBody = events;
      actualBodyType = "sse";
      compareSSEEvents(
        entry.response.body,
        events,
        variables,
        errors,
        warnings,
        replacements,
      );
    }
  } else if (expectedResponseType === "bytes") {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    parsedBody = encodeBase64(bytes);
    actualBodyType = "bytes";
    compareBodies(
      entry.response.body,
      parsedBody,
      variables,
      "$",
      errors,
      warnings,
      replacements,
    );
  } else if (expectedResponseType === "empty") {
    if (response.status === 204) {
      parsedBody = null;
      actualBodyType = "empty";
      compareBodies(
        entry.response.body,
        parsedBody,
        variables,
        "$",
        errors,
        warnings,
        replacements,
      );
    } else {
      const text = await response.text();
      parsedBody = text || null;
      actualBodyType = text ? "text" : "empty";
      compareBodies(
        entry.response.body,
        parsedBody,
        variables,
        "$",
        errors,
        warnings,
        replacements,
      );
    }
  } else {
    const text = response.status === 204 ? "" : await response.text();
    if (!text) {
      parsedBody = null;
      actualBodyType = "empty";
    } else if (
      normalizedContentType.includes("application/json") ||
      normalizedContentType.includes("+json") ||
      expectedResponseType === "json"
    ) {
      try {
        parsedBody = JSON.parse(text);
        actualBodyType = "json";
      } catch (_error) {
        errors.push("body: failed to parse JSON response");
        parsedBody = text;
        actualBodyType = "text";
      }
    } else {
      parsedBody = text;
      actualBodyType = "text";
    }

    compareBodies(
      entry.response.body,
      parsedBody,
      variables,
      "$",
      errors,
      warnings,
      replacements,
    );
  }

  return { ok: errors.length === 0, errors, warnings, response, body: parsedBody, bodyType: actualBodyType };
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
  const predefinedVariables = artifact.variables ?? {};

  for (const [name, value] of Object.entries(predefinedVariables)) {
    const textValue = String(value);
    runtimeVariables.set(name, { raw: textValue, text: textValue });
  }
  
  // Create UUID replacement mapping
  const replacements = scanForReplacementValues(artifact);
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
      ensureRequestPlaceholders(step, runtimeVariables, predefinedVariables);
      const result = await replayRequest(
        step,
        config,
        tokens,
        runtimeVariables,
        replacements,
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
            formatResponseDetails(
              step.response.status,
              step.response.body,
              determineResponseBodyType(step.response),
            )
              .replace(/\n/g, "\n   ")
          }`,
        );
        console.error("");
        console.error("   Actual Response:");
        console.error(
          `   ${
            formatResponseDetails(
              result.response.status,
              result.body,
              result.bodyType,
            ).replace(
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

async function deleteTestUser(
  config: RuntimeConfig,
  tokens: Tokens,
  userId: string,
): Promise<void> {
  const url = new URL("ingredicheck/deleteme", config.functionsBaseUrl);
  const headers = buildAuthHeaders(tokens);
  
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
    });
    
    if (!response.ok) {
      console.warn(`⚠️  Failed to delete test user ${userId}: HTTP ${response.status}`);
      return;
    }
    
    console.log(`🗑️  Deleted test user: ${userId}`);
  } catch (error) {
    console.warn(
      `⚠️  Failed to delete test user ${userId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function ensureRequestPlaceholders(
  entry: RecordedRequest,
  variables: PlaceholderStore,
  predefined: Record<string, string>,
): void {
  const ensureVariable = (name: string) => {
    if (variables.has(name)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(predefined, name)) {
      const value = String(predefined[name]);
      variables.set(name, { raw: value, text: value });
      return;
    }
    const generated = crypto.randomUUID();
    variables.set(name, { raw: generated, text: generated });
  };

  const searchString = (value?: string) => {
    if (!value) return;
    for (const name of extractPlaceholdersFromString(value)) {
      ensureVariable(name);
    }
  };

  searchString(entry.request.path);

  if (entry.request.query) {
    for (const value of Object.values(entry.request.query)) {
      searchString(value);
    }
  }

  switch (entry.request.bodyType) {
    case "json":
      collectPlaceholdersFromJson(entry.request.body, ensureVariable);
      break;
    case "text":
      if (typeof entry.request.body === "string") {
        searchString(entry.request.body);
      }
      break;
    case "form-data":
      if (entry.request.body && typeof entry.request.body === "object") {
        const body = entry.request.body as {
          fields?: Record<string, unknown>;
          files?: Array<Record<string, unknown>>;
        };
        if (body.fields) {
          for (const value of Object.values(body.fields)) {
            collectPlaceholdersFromJson(value, ensureVariable);
          }
        }
        if (body.files) {
          for (const file of body.files) {
            collectPlaceholdersFromJson(file, ensureVariable);
          }
        }
      }
      break;
    default:
      break;
  }
}

async function runSuite(suite: SuiteName, cliArgs: string[]): Promise<void> {
  const selectionArg = cliArgs.length === 0 ? undefined : cliArgs.join(",");
  const config = await loadConfig();
  const testCases = await discoverTestCases(suite);
  let selectedCases: TestCase[] = [];

  if (selectionArg !== undefined) {
    try {
      selectedCases = selectCasesFromArgument(testCases, selectionArg);
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      Deno.exit(1);
    }
  } else {
    selectedCases = await promptTestCaseSelection(testCases, suite);
  }

  const totals: ReplayStats = { total: 0, passed: 0, failed: 0 };

  for (const testCase of selectedCases) {
    console.log(`\n=== [${suite}] ${testCase.displayName} ===`);

    // Create a new anon account for each test case
    console.log("Creating new anonymous user account for this test case...");
    let tokens: Tokens = { accessToken: "", anonKey: "", userId: "" };
    let userId: string = "";
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

    // Delete the test user
    await deleteTestUser(config, tokens, userId);

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
  await runSuite(".", Deno.args);
}

export { runSuite };
