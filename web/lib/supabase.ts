import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.generated.types";

const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_C7GbRNcYQPPrCyqAbl0dcA_IAW0wnY-";
const LEGACY_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_Tk7hBHGJImbtzxxZzEIgKQ_kwnKuCaK";

const SERVER_AUTH_OPTIONS = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};

type DacSupabaseClient = SupabaseClient<Database>;

let browserAnonClient: DacSupabaseClient | null = null;
let anonClient: DacSupabaseClient | null = null;
let serviceRoleClient: DacSupabaseClient | null = null;
let serverClient: DacSupabaseClient | null = null;

function normalizePublishableKey(key: string | undefined): string | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  return trimmed === LEGACY_SUPABASE_PUBLISHABLE_KEY
    ? DEFAULT_SUPABASE_PUBLISHABLE_KEY
    : trimmed;
}

function getSupabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
}

function getSupabasePublishableKey(): string | null {
  return normalizePublishableKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createSupabaseClient(): DacSupabaseClient {
  if (browserAnonClient) return browserAnonClient;

  const url = getSupabaseUrl();
  const key = getSupabasePublishableKey();

  if (!url || !key) {
    return null as unknown as DacSupabaseClient;
  }

  browserAnonClient = createClient<Database>(url, key, {
    auth: {
      detectSessionInUrl: true,
      flowType: "implicit",
    },
  });
  return browserAnonClient;
}

export function createSupabaseAnonClient(): DacSupabaseClient | null {
  if (anonClient) return anonClient;

  const url = getSupabaseUrl();
  const key = getSupabasePublishableKey();

  if (!url || !key) {
    return null;
  }

  anonClient = createClient<Database>(url, key);
  return anonClient;
}

export function createSupabaseServiceRoleClient(): DacSupabaseClient | null {
  if (serviceRoleClient) return serviceRoleClient;

  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  serviceRoleClient = createClient<Database>(url, key, SERVER_AUTH_OPTIONS);
  return serviceRoleClient;
}

export function createSupabaseServiceRoleClientOrThrow(): DacSupabaseClient {
  const client = createSupabaseServiceRoleClient();
  if (!client) {
    throw new Error("Supabase service role is not configured");
  }
  return client;
}

export function createSupabaseServerClient(): DacSupabaseClient | null {
  if (serverClient) return serverClient;

  const url = getSupabaseUrl();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || getSupabasePublishableKey();

  if (!url || !key) {
    return null;
  }

  serverClient = createClient<Database>(url, key, SERVER_AUTH_OPTIONS);
  return serverClient;
}
