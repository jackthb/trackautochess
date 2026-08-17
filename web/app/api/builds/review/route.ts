import { requireAdminSession } from "@/lib/adminServer";
import {
  fetchUsersBySteamIds,
  toDetail,
  toSavedBuild,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";

/** Admin-only pending queue. */
export async function GET(req: Request) {
  const gate = await requireAdminSession(req);
  if (!gate.ok) return gate.response;

  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data, error } = await service
    .from("community_builds")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as CommunityBuildRow[];
  const authors = await fetchUsersBySteamIds(
    service,
    rows.map((row) => row.author_steam_id),
  );

  return Response.json({
    builds: rows.map((row) => ({
      ...toDetail(row, authors.get(row.author_steam_id)),
      payload: toSavedBuild(row),
    })),
  });
}
