import type { NextApiRequest, NextApiResponse } from "next";
import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mmrToRank } from "@dac/shared/game-utils";
import { fetchSteamProfile, resolveSteamInput } from "@/lib/steam";

const DEFAULT_STEAM_VANITY = "jackth";

const fontDir = path.join(process.cwd(), "public", "fonts");
const fontData = Promise.all([
  readFile(path.join(fontDir, "Cinzel-Bold.woff")),
  readFile(path.join(fontDir, "JetBrainsMono-Regular.ttf")),
  readFile(path.join(fontDir, "JetBrainsMono-Bold.ttf")),
]);

async function imageToDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function fmt(value: number | null | undefined): string {
  return value == null ? "-" : value.toLocaleString("en-US");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const raw = Array.isArray(req.query.steamId)
      ? req.query.steamId[0]
      : req.query.steamId ?? DEFAULT_STEAM_VANITY;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabase =
      supabaseUrl && supabaseKey
        ? createClient(supabaseUrl, supabaseKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : undefined;

    const steamId = await resolveSteamInput(raw, supabase, { persist: false });
    if (!steamId) return res.status(404).send("Player not found");

    const [steamProfile, drodoResult, seasonsResult, fonts] = await Promise.all([
      fetchSteamProfile(steamId, supabase, { persist: false }),
      supabase
        ? supabase
            .from("users")
            .select(
              "drodo_mmr, drodo_max_mmr, drodo_season, drodo_season_games, drodo_chicken_count, drodo_profile_missing"
            )
            .eq("steam_id", steamId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        ? supabase
            .from("player_seasons")
            .select("season, mmr, max_mmr, games_played")
            .eq("steam_id", steamId)
            .order("season", { ascending: false })
            .limit(4)
        : Promise.resolve({ data: [] }),
      fontData,
    ]);

    const row = drodoResult.data as {
      drodo_mmr: number | null;
      drodo_max_mmr: number | null;
      drodo_season: string | null;
      drodo_season_games: number | null;
      drodo_chicken_count: number | null;
      drodo_profile_missing: boolean | null;
    } | null;

    const hasStats = row && !row.drodo_profile_missing;
    const mmr = hasStats ? row!.drodo_mmr : null;
    const maxMmr = hasStats ? row!.drodo_max_mmr : null;
    const season = hasStats ? row!.drodo_season : null;
    const games = hasStats ? row!.drodo_season_games : null;
    const wins = hasStats ? row!.drodo_chicken_count : null;

    const pastSeasons = ((seasonsResult.data ?? []) as Array<{
      season: string;
      mmr: number | null;
      max_mmr: number | null;
      games_played: number | null;
    }>)
      .filter((s) => s.season !== season && s.mmr != null)
      .slice(0, 3);
    const rank = mmrToRank(mmr) || "Unranked";
    const displayName = steamProfile.name || raw;
    const avatarDataUrl = await imageToDataUrl(steamProfile.avatarUrl);

    const siteHost = "trackautochess.com";

    // Panel image: 320×400 displayed on Twitch, rendered at 2× (640×800)
    const W = 640;
    const H = 800;

    let image: ImageResponse;
    try {
      image = new ImageResponse(
      (
        <div
          style={{
            width: W,
            height: H,
            display: "flex",
            flexDirection: "column",
            background: "linear-gradient(160deg, #07080b 0%, #111520 60%, #1a0e0c 100%)",
            color: "#f2efe7",
            fontFamily: "JetBrains Mono",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* background glow */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              background:
                "radial-gradient(circle at 50% 0%, rgba(201,79,61,0.22) 0%, transparent 65%)",
            }}
          />

          {/* avatar */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: 36,
            }}
          >
            <div
              style={{
                width: 148,
                height: 148,
                borderRadius: 16,
                overflow: "hidden",
                border: "2px solid #2f3540",
                background: "#111419",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {avatarDataUrl ? (
                <img
                  src={avatarDataUrl}
                  width={148}
                  height={148}
                  style={{ width: 148, height: 148, objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    color: "#8a92a8",
                    fontSize: 64,
                    fontWeight: 700,
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* player name */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: 20,
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {displayName}
          </div>

          {/* rank + MMR */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 28,
            }}
          >
            {season && (
              <div
                style={{
                  display: "flex",
                  color: "#8a92a8",
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: 2,
                }}
              >
                {season.toUpperCase()} RANK
              </div>
            )}
            <div
              style={{
                display: "flex",
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.1,
                marginTop: 6,
              }}
            >
              {rank}
            </div>
            <div
              style={{
                display: "flex",
                color: "#c9a84c",
                fontSize: 34,
                fontWeight: 700,
                marginTop: 4,
              }}
            >
              {fmt(mmr)} MMR
            </div>
          </div>

          {/* stat row */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 16,
              marginTop: 32,
              paddingLeft: 32,
              paddingRight: 32,
            }}
          >
            {[
              { label: "PEAK", value: fmt(maxMmr) },
              { label: "GAMES", value: fmt(games) },
              { label: "WINS", value: fmt(wins) },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  flexGrow: 1,
                  flexShrink: 1,
                  flexBasis: "0%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 14,
                  paddingBottom: 14,
                  paddingLeft: 8,
                  paddingRight: 8,
                  border: "1px solid #2f3540",
                  borderRadius: 10,
                  background: "#0e1015",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    color: "#8a92a8",
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 28,
                    fontWeight: 700,
                    marginTop: 6,
                    color: "#f2efe7",
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* past season pills */}
          {pastSeasons.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 10,
                marginTop: 20,
                paddingLeft: 32,
                paddingRight: 32,
              }}
            >
              {pastSeasons.map((s) => (
                <div
                  key={s.season}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 8,
                    paddingBottom: 8,
                    paddingLeft: 14,
                    paddingRight: 14,
                    border: "1px solid #252b34",
                    borderRadius: 20,
                    background: "#0d0f13",
                    gap: 2,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      color: "#8a92a8",
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: 1.2,
                    }}
                  >
                    {s.season.toUpperCase()}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      color: "#c9c4b8",
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    {mmrToRank(s.mmr) || "Unranked"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* divider */}
          <div
            style={{
              display: "flex",
              height: 1,
              background: "#1e232c",
              marginTop: 28,
              marginLeft: 32,
              marginRight: 32,
            }}
          />

          {/* CTA */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 28,
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#8a92a8",
                fontSize: 17,
                letterSpacing: 1,
              }}
            >
              View full profile & match history
            </div>
            <div
              style={{
                display: "flex",
                color: "#c94f3d",
                fontSize: 19,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {siteHost}
            </div>
          </div>
        </div>
      ),
      {
        width: W,
        height: H,
        fonts: [
          { name: "Cinzel", data: fonts[0], weight: 700, style: "normal" },
          { name: "JetBrains Mono", data: fonts[1], weight: 400, style: "normal" },
          { name: "JetBrains Mono", data: fonts[2], weight: 700, style: "normal" },
        ],
      }
      );
    } catch (renderErr) {
      const msg = renderErr instanceof Error
        ? `ImageResponse render failed: ${renderErr.message}\n${renderErr.stack}`
        : `ImageResponse render failed: ${renderErr}`;
      console.error("[OG/twitch] render error:", renderErr);
      return res.status(500).send(msg);
    }

    const body = Buffer.from(await image.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=14400, stale-while-revalidate=86400"
    );
    return res.status(200).send(body);
  } catch (err) {
    console.error("[OG/twitch] error:", err);
    const msg = err instanceof Error
      ? `${err.constructor.name}: ${err.message}\n${err.stack}`
      : String(err);
    return res.status(500).send(msg);
  }
}
