import { dirname, fromFileUrl, join } from "std/path";
import { parse as parseDotenv } from "std/dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type EnvLoadOptions = {
  candidates?: string[];
  onWarning?: (message: string) => void;
};

type EnvLoadResult = {
  loaded: boolean;
  path?: string;
};

export type AuthTokens = {
  accessToken: string;
  anonKey: string;
};

const sharedDir = dirname(fromFileUrl(import.meta.url));
const testsDir = dirname(sharedDir);

const DEFAULT_ENV_CANDIDATES = [
  join(testsDir, "..", "..", ".env"),
  join(testsDir, "..", ".env"),
  join(testsDir, ".env"),
];

async function parseEnvFile(path: string): Promise<Record<string, string>> {
  const contents = await Deno.readTextFile(path);
  return parseDotenv(contents);
}

export async function loadEnv(
  options: EnvLoadOptions = {},
): Promise<EnvLoadResult> {
  const candidates = options.candidates ?? DEFAULT_ENV_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const vars = await parseEnvFile(candidate);
      for (const [key, value] of Object.entries(vars)) {
        Deno.env.set(key, value);
      }
      return { loaded: true, path: candidate };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      options.onWarning?.(
        `Warning: Failed to load environment from ${candidate}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { loaded: false };
}

export function getEnvVar(name: string): string | undefined {
  const value = Deno.env.get(name);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireEnvVar(name: string, message?: string): string {
  const value = getEnvVar(name);
  if (value) {
    return value;
  }
  throw new Error(message ?? `Environment variable ${name} is required`);
}

export function createSupabaseServiceClient(
  options: { baseUrl?: string; serviceRoleKey?: string } = {},
): SupabaseClient {
  const baseUrl = options.baseUrl ?? requireEnvVar("SUPABASE_BASE_URL");
  const serviceRoleKey = options.serviceRoleKey ??
    requireEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(baseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export async function signInAnonymously(
  baseUrl: string,
  anonKey: string,
): Promise<{ tokens: AuthTokens; userId: string }> {
  const client = createClient(baseUrl, anonKey, {
    auth: { persistSession: false },
  });
  const result = await client.auth.signInAnonymously();

  if (result.error || !result.data.session) {
    throw new Error(
      `Failed to sign in anonymously: ${
        result.error?.message ?? "unknown error"
      }`,
    );
  }

  return {
    tokens: {
      accessToken: result.data.session.access_token,
      anonKey,
    },
    userId: result.data.user?.id ?? "",
  };
}

export function buildAuthHeaders(
  tokens: AuthTokens,
  initHeaders?: HeadersInit,
  options: { acceptJson?: boolean } = {},
): Headers {
  const headers = new Headers(initHeaders ?? {});
  headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  headers.set("apikey", tokens.anonKey);

  if (options.acceptJson !== false && !headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  return headers;
}
