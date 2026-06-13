import { createSupabaseAnonClient } from "@/lib/supabase";

// Read at request time and never cache: flipping the site_status row in Supabase
// must surface to every visitor within a poll cycle, with no redeploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "cache-control": "no-store, max-age=0" } as const;

export async function GET() {
  const supabase = createSupabaseAnonClient();
  if (!supabase) {
    return Response.json({ active: false }, { headers: NO_STORE });
  }

  const { data, error } = await supabase
    .from("site_status")
    .select("active, message, level, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data || !data.active || !data.message) {
    return Response.json({ active: false }, { headers: NO_STORE });
  }

  return Response.json(
    {
      active: true,
      message: data.message,
      level: data.level,
      updatedAt: data.updated_at,
    },
    { headers: NO_STORE }
  );
}
