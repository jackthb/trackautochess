import { toApiReq } from "@/lib/abuseLog";
import { isAdminSteamId } from "@/lib/adminServer";
import {
  fetchUsersBySteamIds,
  toDetail,
  toSavedBuild,
  type CommunityBuildRow,
} from "@/lib/builds/server";
import { getSessionUser } from "@/lib/sessionUser";
import {
  createSupabaseAnonClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase";

/** Admin-only pending queue. */
export async function GET(req: Request) {
  const service = createSupabaseServiceRoleClient();
  if (!service) {
    return Response.json({ error: "Database not configured" }, { status: 500 });
  }

  const anon = createSupabaseAnonClient();
  const session = await getSessionUser(toApiReq(req), anon);
  if (!(await isAdminSteamId(session.steamId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
