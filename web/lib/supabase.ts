import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const SERVER_AUTH_OPTIONS = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};

let browserAnonClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;
let serviceRoleClient: SupabaseClient | null = null;
let serverClient: SupabaseClient | null = null;

export function createSupabaseClient(): SupabaseClient {
  if (browserAnonClient) return browserAnonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null as unknown as SupabaseClient;
  }

  browserAnonClient = createClient(url, key, {
    auth: {
      detectSessionInUrl: true,
      flowType: "implicit",
    },
  });
  return browserAnonClient;
}

export function createSupabaseAnonClient(): SupabaseClient | null {
  if (anonClient) return anonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  anonClient = createClient(url, key);
  return anonClient;
}

export function createSupabaseServiceRoleClient(): SupabaseClient | null {
  if (serviceRoleClient) return serviceRoleClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  serviceRoleClient = createClient(url, key, SERVER_AUTH_OPTIONS);
  return serviceRoleClient;
}

export function createSupabaseServiceRoleClientOrThrow(): SupabaseClient {
  const client = createSupabaseServiceRoleClient();
  if (!client) {
    throw new Error("Supabase service role is not configured");
  }
  return client;
}

export function createSupabaseServerClient(): SupabaseClient | null {
  if (serverClient) return serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  serverClient = createClient(url, key, SERVER_AUTH_OPTIONS);
  return serverClient;
}
