import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CommunityBuildComment,
  CommunityBuildDetail,
  CommunityBuildStatus,
  CommunityBuildSummary,
  SavedBuild,
} from "@/lib/builds/types";
import { isSavedBuildPayload } from "@/lib/builds/types";
import type { Database } from "@/lib/database.generated.types";

export interface CommunityBuildRow {
  id: string;
  author_steam_id: number;
  name: string;
  description: string;
  payload: unknown;
  status: string;
  upvote_count: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: number | null;
}

export interface UserLiteRow {
  steam_id: number;
  name: string | null;
  avatar_url: string | null;
}

export function parseSteamId(steamId: string): number | null {
  if (!/^\d{17}$/.test(steamId)) return null;
  const n = Number(steamId);
  return Number.isSafeInteger(n) ? n : null;
}

export function toSavedBuild(
  row: CommunityBuildRow,
  fallback?: SavedBuild,
): SavedBuild {
  const payload = isSavedBuildPayload(row.payload) ? row.payload : fallback;
  return {
    id: row.id,
    name: row.name || payload?.name || "Untitled build",
    description: row.description || payload?.description || "",
    status: row.status as CommunityBuildStatus,
    updatedAt: row.updated_at,
    snapshots: payload?.snapshots?.length
      ? payload.snapshots
      : [
          {
            id: "snap_default",
            label: "Main board",
            round: 20,
            focusNote: "",
            pieces: [],
          },
        ],
  };
}

export function toSummary(
  row: CommunityBuildRow,
  author: UserLiteRow | null | undefined,
  viewerHasVoted?: boolean,
): CommunityBuildSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as CommunityBuildStatus,
    upvoteCount: row.upvote_count,
    authorSteamId: String(row.author_steam_id),
    authorName: author?.name ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    viewerHasVoted,
  };
}

export function toDetail(
  row: CommunityBuildRow,
  author: UserLiteRow | null | undefined,
  viewerHasVoted?: boolean,
): CommunityBuildDetail {
  return {
    ...toSummary(row, author, viewerHasVoted),
    payload: toSavedBuild(row),
  };
}

export function toComment(
  row: {
    id: string;
    body: string;
    created_at: string;
    author_steam_id: number;
  },
  author: UserLiteRow | null | undefined,
): CommunityBuildComment {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorSteamId: String(row.author_steam_id),
    authorName: author?.name ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
  };
}

export async function fetchUsersBySteamIds(
  supabase: SupabaseClient<Database>,
  steamIds: number[],
): Promise<Map<number, UserLiteRow>> {
  const unique = [...new Set(steamIds.filter((id) => Number.isFinite(id)))];
  const map = new Map<number, UserLiteRow>();
  if (unique.length === 0) return map;

  const { data } = await supabase
    .from("users")
    .select("steam_id, name, avatar_url")
    .in("steam_id", unique);

  for (const row of (data ?? []) as UserLiteRow[]) {
    map.set(row.steam_id, row);
  }
  return map;
}
