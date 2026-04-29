import type { NextApiRequest, NextApiResponse } from "next";
import type { ReactNode } from "react";
import { ImageResponse } from "@vercel/og";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mmrToRank } from "@dac/shared/game-utils";
import {
  fetchSteamProfile,
  resolveSteamInput,
  steamProfileUrl,
} from "@/lib/steam";

interface DrodoOgData {
  steam_id?: string;
  mmr?: number | null;
  max_mmr?: number | null;
  season?: string | null;
  season_games?: number | null;
  candy?: number | null;
  chicken_count?: number | null;
  seasons?: Array<{
    season: string;
    mmr: number | null;
    max_mmr: number | null;
    games_played: number | null;
  }>;
}

interface CachedDrodoOgRow {
  steam_id: string;
  drodo_mmr: number | null;
  drodo_max_mmr: number | null;
  drodo_season: string | null;
  drodo_season_games: number | null;
  drodo_candy: number | null;
  drodo_chicken_count: number | null;
  drodo_profile_missing: boolean | null;
}

const fontDir = path.join(process.cwd(), "public", "fonts");
const fontData = Promise.all([
  readFile(path.join(fontDir, "Cinzel-wght.ttf")),
  readFile(path.join(fontDir, "JetBrainsMono-Regular.ttf")),
  readFile(path.join(fontDir, "JetBrainsMono-Bold.ttf")),
]);
const USER_DRODO_SELECT = [
  "steam_id::text",
  "drodo_mmr",
  "drodo_max_mmr",
  "drodo_season",
  "drodo_season_games",
  "drodo_candy",
  "drodo_chicken_count",
  "drodo_profile_missing",
].join(", ");

function fmt(value: number | null | undefined): string {
  return value == null ? "-" : value.toLocaleString("en-US");
}

async function imageToDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | ReactNode;
}) {
  return (
    <div
      style={{
        width: 152,
        height: 86,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 18px",
        border: "1px solid #2f3540",
        borderRadius: 8,
        background: "#111419",
      }}
    >
      <div
        style={{
          display: "flex",
          color: "#8a92a8",
          fontFamily: "JetBrains Mono",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 1.4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          color: "#f2efe7",
          fontFamily: "JetBrains Mono",
          fontSize: 30,
          fontWeight: 700,
          marginTop: 8,
          whiteSpace: "nowrap",
          alignItems: "center",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PreviousSeasons({ drodo }: { drodo: DrodoOgData | null }) {
  const currentSeason = drodo?.season;
  const seasons = (drodo?.seasons ?? [])
    .filter((season) => season.season !== currentSeason && season.mmr != null)
    .slice(-3)
    .reverse();

  if (seasons.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          color: "#8a92a8",
          fontFamily: "JetBrains Mono",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 1.5,
        }}
      >
        PREVIOUS SEASONS
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        {seasons.map((season) => (
          <div
            key={season.season}
            style={{
              width: 142,
              height: 66,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 14px",
              border: "1px solid #2b3038",
              borderRadius: 8,
              background: "#111419",
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#8a92a8",
                fontFamily: "JetBrains Mono",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {season.season.toUpperCase()}
            </div>
            <div
              style={{
                display: "flex",
                color: "#f2efe7",
                fontFamily: "JetBrains Mono",
                fontSize: 15,
                fontWeight: 700,
                marginTop: 5,
                whiteSpace: "nowrap",
              }}
            >
              {mmrToRank(season.mmr) || "Unranked"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawSteamId = Array.isArray(req.query.steamId)
    ? req.query.steamId[0]
    : req.query.steamId;
  if (!rawSteamId) {
    return res.status(400).send("Missing player");
  }

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

  const steamId = await resolveSteamInput(rawSteamId, supabase, {
    persist: false,
  });
  if (!steamId) {
    return res.status(404).send("Player not found");
  }

  const [steamProfile, drodoResult, seasonsResult, fonts] = await Promise.all([
    fetchSteamProfile(steamId, supabase, { persist: false }),
    supabase
      ? supabase
          .from("users")
          .select(USER_DRODO_SELECT)
          .eq("steam_id", steamId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      ? supabase
          .from("player_seasons")
          .select("season, mmr, max_mmr, games_played")
          .eq("steam_id", steamId)
          .order("season", { ascending: false })
      : Promise.resolve({ data: [] }),
    fontData,
  ]);

  const cachedDrodo = drodoResult.data as CachedDrodoOgRow | null;
  const drodo: DrodoOgData | null =
    cachedDrodo && !cachedDrodo.drodo_profile_missing
      ? {
          steam_id: String(cachedDrodo.steam_id),
          mmr: cachedDrodo.drodo_mmr,
          max_mmr: cachedDrodo.drodo_max_mmr,
          season: cachedDrodo.drodo_season,
          season_games: cachedDrodo.drodo_season_games,
          candy: cachedDrodo.drodo_candy,
          chicken_count: cachedDrodo.drodo_chicken_count,
          seasons: (seasonsResult.data as DrodoOgData["seasons"]) ?? [],
        }
      : null;
  const displayName = steamProfile.name || steamId;
  const avatarDataUrl = await imageToDataUrl(steamProfile.avatarUrl);
  const profileUrl = steamProfileUrl(steamId, steamProfile.customUrl).replace(
    /^https?:\/\//,
    ""
  );
  const rank = mmrToRank(drodo?.mmr) || "Unranked";
  const season = drodo?.season?.toUpperCase() || "CURRENT";
  const lastSeason = (drodo?.seasons ?? []).find((s) => s.season !== drodo?.season);
  const lastSeasonDisplay = lastSeason
    ? `${lastSeason.season.toUpperCase()} ${mmrToRank(lastSeason.mmr) || "Unranked"}`
    : "-";

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(135deg, #07080b 0%, #11151b 55%, #21100d 100%)",
          color: "#f2efe7",
          padding: 48,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background:
              "radial-gradient(circle at 28% 22%, rgba(224,64,42,0.28), transparent 58%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 720,
            height: 180,
            right: -150,
            top: 160,
            display: "flex",
            transform: "rotate(45deg)",
            background: "rgba(224,64,42,0.16)",
          }}
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            position: "relative",
            border: "1px solid #252b34",
            borderRadius: 22,
            background: "rgba(11,13,17,0.36)",
            padding: 24,
          }}
        >
          <div
            style={{
              width: 700,
              display: "flex",
              flexDirection: "column",
              paddingTop: 4,
            }}
          >
            <div
          style={{
            display: "flex",
            color: "#c94f3d",
                fontFamily: "Cinzel",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 5,
              }}
            >
              Track Auto Chess
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: "JetBrains Mono",
                fontSize: 54,
                fontWeight: 700,
                lineHeight: 1.05,
                marginTop: 12,
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                display: "flex",
                color: "#8a92a8",
                fontFamily: "JetBrains Mono",
                fontSize: 21,
                marginTop: 12,
              }}
            >
              {profileUrl}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 46,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "#8a92a8",
                  fontFamily: "JetBrains Mono",
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 2,
                }}
              >
                {season} RANK
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: "JetBrains Mono",
                  fontSize: 58,
                  fontWeight: 700,
                  lineHeight: 1,
                  marginTop: 10,
                }}
              >
                {rank}
              </div>
              <div
                style={{
                  display: "flex",
                  color: "#c9a84c",
                  fontFamily: "JetBrains Mono",
                  fontSize: 44,
                  fontWeight: 700,
                  marginTop: 8,
                }}
              >
                {fmt(drodo?.mmr)} MMR
              </div>
            </div>

            <div style={{ display: "flex", gap: 18, marginTop: 40 }}>
              <Stat label="PEAK MMR" value={fmt(drodo?.max_mmr)} />
              <Stat label="GAMES" value={fmt(drodo?.season_games)} />
              <Stat label="LAST SEASON" value={lastSeasonDisplay} />
              <Stat label="WINS" value={fmt(drodo?.chicken_count)} />
            </div>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              paddingTop: 25,
              paddingLeft: 24,
            }}
          >
            <div
              style={{
                width: 300,
                height: 300,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                border: "1px solid #3b424e",
                borderRadius: 22,
                background: "#111419",
                padding: 10,
              }}
            >
              {avatarDataUrl || steamProfile.avatarUrl ? (
                <img
                  src={avatarDataUrl || steamProfile.avatarUrl || ""}
                  width={280}
                  height={280}
                  style={{
                    width: 280,
                    height: 280,
                    objectFit: "cover",
                    borderRadius: 16,
                  }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    color: "#8a92a8",
                    fontFamily: "JetBrains Mono",
                    fontSize: 132,
                    fontWeight: 700,
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <PreviousSeasons drodo={drodo} />

          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Cinzel",
          data: fonts[0],
          weight: 400,
          style: "normal",
        },
        {
          name: "JetBrains Mono",
          data: fonts[1],
          weight: 400,
          style: "normal",
        },
        {
          name: "JetBrains Mono",
          data: fonts[2],
          weight: 700,
          style: "normal",
        },
      ],
    }
  );

  const body = Buffer.from(await image.arrayBuffer());
  res.setHeader("Content-Type", "image/png");
  res.setHeader(
    "Cache-Control",
    "public, max-age=3600, s-maxage=43200, stale-while-revalidate=86400"
  );
  res.status(200).send(body);
}
