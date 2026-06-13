import { createSupabaseAnonClient, createSupabaseServiceRoleClient } from "@/lib/supabase";
import { isAdminSteamId } from "@/lib/admin";
import { loadQueenCandidates, selectDisplayedQueens } from "@/lib/queens";

export const dynamic = "force-dynamic";

type CountQuery = any;

interface TableVolume {
  table: string;
  rows: number;
  last_24h: number | null;
}

const ACTIVE_SYNC_FILTER =
  "steam_signed_in_at.gte.__RECENT__,queen_ladder_last_seen_at.not.is.null,drodo_queen_rank.not.is.null";

const RECENT_SIGN_IN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const TABLE_WINDOWS: Array<{ table: string; timestamp: string | null }> = [
  { table: "users", timestamp: "created_at" },
  { table: "matches", timestamp: "played_at" },
  { table: "match_players", timestamp: "played_at" },
  { table: "match_timelines", timestamp: "captured_at" },
  { table: "lineup_snapshots", timestamp: "captured_at" },
  { table: "mmr_snapshots", timestamp: "snapshotted_at" },
  { table: "player_seasons", timestamp: "fetched_at" },
];

function numberEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function requireAdmin(req: Request): Promise<Response | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createSupabaseAnonClient();
  if (!supabase) {
    return Response.json({ error: "Auth is not configured" }, { status: 503 });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const steamId = data.user.user_metadata?.steam_id;
  if (!isAdminSteamId(typeof steamId === "string" ? steamId : null)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

async function countRows(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  table: string,
  apply?: (query: CountQuery) => CountQuery
): Promise<number> {
  if (!supabase) return 0;
  let query = (supabase as any)
    .from(table)
    .select("*", { count: "exact", head: true }) as CountQuery;
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function tableVolume(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  table: string,
  timestamp: string | null,
  since24h: string
): Promise<TableVolume> {
  const rows = await countRows(supabase, table);
  const last24h = timestamp
    ? await countRows(supabase, table, (query) => query.gte(timestamp, since24h))
    : null;
  return { table, rows, last_24h: last24h };
}

export async function GET(req: Request) {
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;

  const supabase = createSupabaseServiceRoleClient();
  if (!supabase) {
    return Response.json({ error: "Database is not configured" }, { status: 503 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentSignIn = new Date(now.getTime() - RECENT_SIGN_IN_WINDOW_MS).toISOString();
  const activeFilter = ACTIVE_SYNC_FILTER.replace("__RECENT__", recentSignIn);

  try {
    const [
      volumes,
      usersTotal,
      drodoFetched,
      drodoNeverFetched,
      drodoMissing,
      queenCandidates,
      dueActive,
      unseededActive,
      dueAll,
      nextHour,
      overdueHour,
      fetched1h,
      fetched24h,
      fetched7d,
      snapshots24h,
    ] = await Promise.all([
      Promise.all(
        TABLE_WINDOWS.map((entry) =>
          tableVolume(supabase, entry.table, entry.timestamp, since24h)
        )
      ),
      countRows(supabase, "users"),
      countRows(supabase, "users", (query) => query.not("drodo_last_fetched_at", "is", null)),
      countRows(supabase, "users", (query) => query.is("drodo_last_fetched_at", null)),
      countRows(supabase, "users", (query) => query.eq("drodo_profile_missing", true)),
      loadQueenCandidates(supabase),
      countRows(supabase, "users", (query) =>
        query
          .or(activeFilter)
          .lte("next_poll_at", nowIso)
          .not("drodo_last_fetched_at", "is", null)
      ),
      countRows(supabase, "users", (query) =>
        query.or(activeFilter).is("drodo_last_fetched_at", null)
      ),
      countRows(supabase, "users", (query) =>
        query
          .eq("drodo_profile_missing", false)
          .not("drodo_last_fetched_at", "is", null)
          .lte("next_poll_at", nowIso)
      ),
      countRows(supabase, "users", (query) =>
        query
          .eq("drodo_profile_missing", false)
          .not("drodo_last_fetched_at", "is", null)
          .gte("next_poll_at", nowIso)
          .lte("next_poll_at", new Date(now.getTime() + 60 * 60 * 1000).toISOString())
      ),
      countRows(supabase, "users", (query) =>
        query
          .eq("drodo_profile_missing", false)
          .not("drodo_last_fetched_at", "is", null)
          .lte("next_poll_at", since1h)
      ),
      countRows(supabase, "users", (query) => query.gte("drodo_last_fetched_at", since1h)),
      countRows(supabase, "users", (query) => query.gte("drodo_last_fetched_at", since24h)),
      countRows(supabase, "users", (query) => query.gte("drodo_last_fetched_at", since7d)),
      countRows(supabase, "mmr_snapshots", (query) => query.gte("snapshotted_at", since24h)),
    ]);

    const displayedQueens = selectDisplayedQueens(queenCandidates);
    const newestQueenSeenAt =
      queenCandidates
        .map((row) => row.queen_ladder_last_seen_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
    const oldestDisplayedProfileAt =
      displayedQueens
        .map((row) => row.drodo_last_fetched_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(0) ?? null;

    return Response.json({
      generated_at: nowIso,
      volume: {
        total_rows: volumes.reduce((sum, entry) => sum + entry.rows, 0),
        tables: volumes,
      },
      supabase: {
        configured: true,
        users: {
          total: usersTotal,
          drodo_fetched: drodoFetched,
          drodo_never_fetched: drodoNeverFetched,
          drodo_missing: drodoMissing,
        },
        queens: {
          candidates: queenCandidates.length,
          displayed: displayedQueens.length,
          newest_ladder_seen_at: newestQueenSeenAt,
          oldest_displayed_profile_fetched_at: oldestDisplayedProfileAt,
        },
        drodo_refresh: {
          profiles_last_fetched_1h: fetched1h,
          profiles_last_fetched_24h: fetched24h,
          profiles_last_fetched_7d: fetched7d,
          snapshots_written_24h: snapshots24h,
          active_due_now: dueActive,
          active_never_fetched: unseededActive,
          all_due_now: dueAll,
          due_next_hour: nextHour,
          overdue_more_than_1h: overdueHour,
        },
      },
      vercel: {
        billing_usage_available: false,
        note:
          "Vercel billing and quota consumption are not exposed to this runtime. Set guardrail env vars below to compare local volume against your plan.",
        guardrails: {
          function_invocations_monthly: numberEnv("VERCEL_FUNCTION_INVOCATIONS_MONTHLY_LIMIT"),
          bandwidth_gb_monthly: numberEnv("VERCEL_BANDWIDTH_GB_MONTHLY_LIMIT"),
          edge_requests_monthly: numberEnv("VERCEL_EDGE_REQUESTS_MONTHLY_LIMIT"),
        },
      },
      polling: {
        batch_size_active:
          numberEnv("DRODO_POLL_BATCH_SIZE") ?? numberEnv("DRODO_POLL_ACTIVE_BATCH_SIZE") ?? 200,
        batch_size_all: numberEnv("DRODO_POLL_ALL_BATCH_SIZE") ?? 10000,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load usage";
    console.error("Admin usage failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
