import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.generated.types";

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

export function createSupabaseClient(): DacSupabaseClient {
  if (browserAnonClient) return browserAnonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  anonClient = createClient<Database>(url, key);
  return anonClient;
}

export function createSupabaseServiceRoleClient(): DacSupabaseClient | null {
  if (serviceRoleClient) return serviceRoleClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  serverClient = createClient<Database>(url, key, SERVER_AUTH_OPTIONS);
  return serverClient;
}
