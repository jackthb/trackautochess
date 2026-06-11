import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase";
import { playerProfilePath } from "@/lib/steam";

interface LadderPlayerRow {
  steam_id: string;
  custom_url: string | null;
}

// Pinged by the desktop backend after a Queen ladder upload (and its new-player
// profile backfill) has been committed, so /queens and the ladder players'
// profile pages rebuild with the fresh data instead of waiting out their ISR
// windows. Unauthenticated by design: desktop clients cannot hold a secret, and
// the worst case is an extra render of pages that revalidate on a timer anyway.
async function handle() {
  revalidatePath("/queens");

  let players = 0;
  const supabase = createSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("steam_id::text, custom_url")
      .not("queen_ladder_last_seen_at", "is", null)
      .limit(300);
    if (error) {
      console.error("Failed to load Queen players for revalidation:", error.message);
    }
    for (const row of (data ?? []) as unknown as LadderPlayerRow[]) {
      const steamId = String(row.steam_id);
      revalidatePath(playerProfilePath(steamId));
      if (row.custom_url) {
        revalidatePath(playerProfilePath(steamId, row.custom_url));
      }
      players += 1;
    }
  }

  return Response.json({
    revalidated: true,
    players,
    at: new Date().toISOString(),
  });
}

export async function POST() {
  return handle();
}

export async function GET() {
  return handle();
}
