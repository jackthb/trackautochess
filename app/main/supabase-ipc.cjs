const MMR_LEVEL_RANKS = [
  "Pawn-1",
  "Pawn-2",
  "Pawn-3",
  "Pawn-4",
  "Pawn-5",
  "Pawn-6",
  "Pawn-7",
  "Pawn-8",
  "Pawn-9",
  "Knight-1",
  "Knight-2",
  "Knight-3",
  "Knight-4",
  "Knight-5",
  "Knight-6",
  "Knight-7",
  "Knight-8",
  "Knight-9",
  "Bishop-1",
  "Bishop-2",
  "Bishop-3",
  "Bishop-4",
  "Bishop-5",
  "Bishop-6",
  "Bishop-7",
  "Bishop-8",
  "Bishop-9",
  "Rook-1",
  "Rook-2",
  "Rook-3",
  "Rook-4",
  "Rook-5",
  "Rook-6",
  "Rook-7",
  "Rook-8",
  "Rook-9",
  "King",
  "Queen",
];

const DRODO_BASE = "http://autochess.ppbizon.com";

function createSupabaseIpc({ ipcMain, net, fs, path, dacDir, fetchImpl = fetch }) {
  function loadTrackerConfig() {
    const configPath = path.join(dacDir, "config.json");
    if (!fs.existsSync(configPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      return {};
    }
  }

  function mmrLevelToAppRank(level) {
    const n = Number(level);
    if (!Number.isInteger(n) || n < 1 || n > MMR_LEVEL_RANKS.length) return null;
    return MMR_LEVEL_RANKS[n - 1];
  }

  function drodoUserRowToProfile(row, seasons = []) {
    if (!row) return null;
    return {
      mmr: row.drodo_mmr ?? null,
      max_mmr: row.drodo_max_mmr ?? null,
      mmr_level: row.drodo_mmr_level ?? null,
      season: row.drodo_season ?? null,
      season_games: row.drodo_season_games ?? null,
      chicken_count: row.drodo_chicken_count ?? 0,
      fetched_at: row.drodo_last_fetched_at ?? null,
      seasons,
    };
  }

  function drodoProfileToUserPayload(profile) {
    return {
      steam_id: profile.steam_id,
      drodo_mmr: profile.mmr,
      drodo_max_mmr: profile.max_mmr,
      drodo_mmr_level: profile.mmr_level,
      drodo_season: profile.season,
      drodo_season_games: profile.season_games,
      drodo_candy: profile.candy,
      drodo_chicken_count: profile.chicken_count,
      drodo_raw_data: profile.raw_data,
      drodo_last_fetched_at: profile.fetched_at,
      drodo_profile_missing: false,
    };
  }

  function register() {
    ipcMain.handle("timelines:fetch", async (_event, matchId) => {
      if (!matchId) return null;
      const config = loadTrackerConfig();
      const url = config.supabase_url;
      const key = config.supabase_key;
      if (!url || !key) return null;
      try {
        const resp = await fetchImpl(
          `${url.replace(/\/$/, "")}/rest/v1/match_timelines?match_id=eq.${encodeURIComponent(matchId)}&select=timeline`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Accept: "application/json",
            },
          },
        );
        if (!resp.ok) {
          console.error(`timelines:fetch HTTP ${resp.status} for ${matchId}`);
          return null;
        }
        const rows = await resp.json();
        return Array.isArray(rows) && rows[0]?.timeline ? rows[0].timeline : null;
      } catch (e) {
        console.error(`timelines:fetch failed for ${matchId}:`, e);
        return null;
      }
    });

    ipcMain.handle("games:fetch", async () => {
      const config = loadTrackerConfig();
      const url = config.supabase_url;
      const key = config.supabase_key;
      const steamId = config.steam_id;
      if (!url || !key || !steamId) return [];

      try {
        const resp = await net.fetch(
          `${url}/rest/v1/match_players?select=*&steam_id=eq.${steamId}&order=played_at.desc&limit=50`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Accept: "application/json",
            },
          },
        );
        if (!resp.ok) {
          console.error(`games:fetch HTTP ${resp.status}`);
          return [];
        }
        const rows = await resp.json();
        return rows.map((r) => ({
          id: r.id,
          user_id: String(r.steam_id),
          placement: String(r.placement),
          lineup: r.chess_lineup,
          synergies: r.synergies,
          talents: r.talents,
          relic: r.relic,
          relic_history: r.relic_history ?? null,
          level: r.hero_level ? String(r.hero_level) : null,
          wins: r.win_round,
          losses: r.lose_round,
          match_id: r.match_id,
          played_at: r.played_at || "",
          created_at: r.created_at || "",
          rank: mmrLevelToAppRank(r.mmr_level),
          rank_change: null,
          wl: null,
          screenshot: null,
          replay: null,
          notes: null,
        }));
      } catch (e) {
        console.error("games:fetch error:", e);
        return [];
      }
    });

    ipcMain.handle("games:update", async (_event, gameId, fields) => {
      const config = loadTrackerConfig();
      const url = config.supabase_url;
      const key = config.supabase_key;
      if (!url || !key) return false;

      try {
        const resp = await net.fetch(`${url}/rest/v1/match_players?id=eq.${gameId}`, {
          method: "PATCH",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(fields),
        });
        return resp.ok;
      } catch (e) {
        console.error("games:update error:", e);
        return false;
      }
    });

    ipcMain.handle("drodo:fetch", async () => {
      const config = loadTrackerConfig();
      const url = config.supabase_url;
      const key = config.supabase_key;
      const steamId = config.steam_id;
      if (!url || !key || !steamId) return { error: "Tracker profile is not configured." };

      try {
        const [profileResp, seasonsResp] = await Promise.all([
          net.fetch(
            `${url}/rest/v1/users?select=steam_id,drodo_mmr,drodo_max_mmr,drodo_mmr_level,drodo_season,drodo_season_games,drodo_chicken_count,drodo_last_fetched_at&steam_id=eq.${steamId}`,
            {
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                Accept: "application/json",
              },
            },
          ),
          net.fetch(
            `${url}/rest/v1/player_seasons?select=season,mmr,max_mmr,games_played&steam_id=eq.${steamId}&order=season.asc`,
            {
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                Accept: "application/json",
              },
            },
          ),
        ]);

        if (!profileResp.ok) return { error: `Could not load Auto Chess profile (${profileResp.status}).` };
        if (!seasonsResp.ok) return { error: `Could not load Auto Chess seasons (${seasonsResp.status}).` };

        const profiles = await profileResp.json();
        const seasons = await seasonsResp.json();
        const profile = profiles[0] || null;
        if (!profile) return null;
        return drodoUserRowToProfile(profile, seasons);
      } catch (e) {
        console.error("drodo:fetch error:", e);
        return { error: e?.message || "Could not load Auto Chess profile." };
      }
    });

    ipcMain.handle("drodo:refresh", async () => {
      const config = loadTrackerConfig();
      const url = config.supabase_url;
      const key = config.supabase_key;
      const steamId = config.steam_id;
      if (!url || !key || !steamId) return { error: "Tracker profile is not configured." };

      let drodoData;
      try {
        const resp = await net.fetch(`${DRODO_BASE}/courier/get/@${steamId}`);
        if (!resp.ok) return { error: `Drodo profile API returned ${resp.status}.` };
        const json = await resp.json();
        if (json.err !== 0 || !json.user_info?.[steamId]) {
          return { error: "Drodo profile was not found for this Steam account." };
        }
        drodoData = json.user_info[steamId];
      } catch (e) {
        console.error("drodo:refresh API error:", e);
        return { error: e?.message || "Could not refresh Auto Chess profile." };
      }

      let maxSeason = 0;
      let season = "";
      for (const k of Object.keys(drodoData)) {
        const m = k.match(/^mmr_s(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxSeason) {
            maxSeason = n;
            season = `s${n}`;
          }
        }
      }

      const mmrKey = season ? `mmr_${season}` : null;
      const maxMmrKey = season ? `max_mmr_${season}` : null;
      const matchKey = season ? `match_${season}` : null;
      const now = new Date().toISOString();
      const profile = {
        steam_id: steamId,
        mmr: mmrKey ? Number(drodoData[mmrKey]) || null : null,
        max_mmr: maxMmrKey ? Number(drodoData[maxMmrKey]) || null : null,
        mmr_level: Number(drodoData.mmr_level) || null,
        queen_rank: Number(drodoData.queen_rank) || null,
        season: season || null,
        season_games: matchKey ? Number(drodoData[matchKey]) || null : null,
        candy: Number(drodoData.candy) || null,
        chicken_count: Number(drodoData.chicken_count) || 0,
        raw_data: drodoData,
        fetched_at: now,
      };

      try {
        const userPayload = drodoProfileToUserPayload(profile);
        await net.fetch(`${url}/rest/v1/users`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(userPayload),
        });
      } catch (e) {
        console.error("drodo:refresh upsert profile error:", e);
        return { error: e?.message || "Could not save Auto Chess profile." };
      }

      const seasonRows = [];
      for (const k of Object.keys(drodoData)) {
        const m = k.match(/^mmr_s(\d+)$/);
        if (m) {
          const n = m[1];
          seasonRows.push({
            steam_id: steamId,
            season: `s${n}`,
            mmr: Number(drodoData[`mmr_s${n}`]) || null,
            max_mmr: Number(drodoData[`max_mmr_s${n}`]) || null,
            games_played: Number(drodoData[`match_s${n}`]) || null,
            fetched_at: now,
          });
        }
      }

      if (seasonRows.length > 0) {
        try {
          await net.fetch(`${url}/rest/v1/player_seasons`, {
            method: "POST",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify(seasonRows),
          });
        } catch (e) {
          console.error("drodo:refresh upsert seasons error:", e);
        }
      }

      return { ...profile, seasons: seasonRows };
    });
  }

  return { register, loadTrackerConfig };
}

module.exports = { createSupabaseIpc };
