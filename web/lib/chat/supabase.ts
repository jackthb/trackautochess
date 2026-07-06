import { createSupabaseServiceRoleClientOrThrow } from "@/lib/supabase";

export function createChatSupabaseClient() {
  return createSupabaseServiceRoleClientOrThrow();
}
