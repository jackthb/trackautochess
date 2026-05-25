import type { NextApiRequest, NextApiResponse } from "next";
import { renderOgImage, imageToDataUrl } from "@/lib/og";
import { resolveIconUrl } from "@/lib/icons";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseLineup, parseRelics, unitStem, relicStem, RANK_BRACKETS } from "@dac/shared/game-utils";
import relicsData from "@data/relics.json";

const RELICS_MAP = (relicsData as { relics: Record<string, { name: string }> }).relics;

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}
import { fetchSteamProfile } from "@/lib/steam";
import unitsData from "@data/units.json";

const UNIT_COSTS: Record<string, number> = {};
for (const [name, info] of Object.entries(unitsData.units)) {
  UNIT_COSTS[name] = (info as { cost: number }).cost;
}
for (const [alias, canonical] of Object.entries(
  (unitsData as { aliases?: Record<string, string> }).aliases ?? {}
)) {
  if (UNIT_COSTS[canonical] !== undefined) {
    UNIT_COSTS[alias] = UNIT_COSTS[canonical];
  }
}

const fontDir = path.join(process.cwd(), "public", "fonts");
const fontData = Promise.all([
  readFile(path.join(fontDir, "Cinzel-Bold.woff")),
  readFile(path.join(fontDir, "JetBrainsMono-Regular.ttf")),
  readFile(path.join(fontDir, "JetBrainsMono-Bold.ttf")),
]);

function costBorderColorHex(cost: number): string {
  if (cost >= 5) return "#c9a84c";
  if (cost === 4) return "#9b59b6";
  if (cost === 3) return "#3498db";
  if (cost === 2) return "#27ae60";
  return "#7f8c8d";
}

function placementColorHex(p: number): string {
  if (p === 1) return "#c9a84c";
  if (p <= 3) return "#8a92a8";
  if (p === 4) return "#9096ac";
  return "#c44e4e";
}

function getSiteHost(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://trackautochess.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await ogHandler(req, res);
  } catch (err) {
    console.error("[OG] handler error:", err);
    return res.status(500).send(String(err));
  }
}

async function ogHandler(req: NextApiRequest, res: NextApiResponse) {
  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!rawId) {
    return res.status(400).send("Missing game id");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).send("Missing Supabase config");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: game } = await supabase
    .from("games")
    .select("*, user_id::text")
    .eq("id", rawId)
    .single();

  if (!game) {
    return res.status(404).send("Game not found");
  }

  const [steamProfile, fonts] = await Promise.all([
    game.user_id
      ? fetchSteamProfile(String(game.user_id), supabase)
      : Promise.resolve({ name: null, customUrl: null, avatarUrl: null }),
    fontData,
  ]);

  // Pull match_players data for rank + full relic history.
  let mpRelicNames: string[] = [];
  if (game.match_id && game.user_id) {
    const { data: mp } = await supabase
      .from("match_players")
      .select("mmr_level, relic_history")
      .eq("match_id", game.match_id)
      .eq("steam_id", game.user_id)
      .maybeSingle();
    if (mp?.mmr_level && !game.rank) {
      game.rank = mmrLevelToRank(mp.mmr_level) || null;
    }
    if (mp?.relic_history && typeof mp.relic_history === "object") {
      const entries = Array.isArray(mp.relic_history)
        ? mp.relic_history
        : Object.values(mp.relic_history as Record<string, unknown>);
      for (const e of entries) {
        if (e && typeof e === "object" && "relic" in (e as any)) {
          const name = (e as { relic: string }).relic;
          if (name) mpRelicNames.push(name);
        }
      }
    }
  }

  const p = parseInt(game.placement) || 0;
  const pColor = placementColorHex(p);
  const displayName =
    steamProfile.name ||
    (game.notes && game.notes.trim() ? game.notes.trim() : null) ||
    (game.user_id ? String(game.user_id) : "Unknown");
  const siteHost = getSiteHost();

  const lineup = parseLineup(game.lineup, UNIT_COSTS);
  const rawRelics = mpRelicNames.length > 0 ? mpRelicNames : parseRelics(game.relic);
  const relics = rawRelics.map((r) => RELICS_MAP[r]?.name || r);
  const siteBase = process.env.NEXT_PUBLIC_SITE_URL || "https://www.trackautochess.com";
  const toAbs = (url: string) => url.startsWith("/") ? `${siteBase}${url}` : url;

  const avatarPromise = imageToDataUrl(steamProfile.avatarUrl);
  const unitIconPromises = lineup.map((u) => imageToDataUrl(toAbs(resolveIconUrl("units", unitStem(u.name)))));
  const relicIconPromises = relics.map((r) => {
    const stem = relicStem(r);
    const url = resolveIconUrl("relics", stem);
    const abs = toAbs(url);
    return imageToDataUrl(abs);
  });
  const [avatarDataUrl, ...iconResults] = await Promise.all([avatarPromise, ...unitIconPromises, ...relicIconPromises]);
  const unitIcons = iconResults.slice(0, lineup.length);
  const relicIcons = iconResults.slice(lineup.length);

  const matchDate = game.played_at
    ? new Date(game.played_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const matchTime = game.played_at
    ? new Date(game.played_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const wl =
    game.wins != null && game.losses != null
      ? `${game.wins}W - ${game.losses}L`
      : null;

  const body = await renderOgImage(
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
              flex: 1,
              display: "flex",
              flexDirection: "column",
              paddingTop: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#c94f3d",
                fontFamily: "JetBrains Mono",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 1.2,
              }}
            >
              {siteHost}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                marginTop: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 110,
                  height: 110,
                  border: `2px solid ${pColor}`,
                  borderRadius: 16,
                  fontFamily: "JetBrains Mono",
                  fontSize: 64,
                  fontWeight: 700,
                  color: pColor,
                  flexShrink: 0,
                }}
              >
                #{p}
              </div>
              {avatarDataUrl && (
                <img
                  src={avatarDataUrl}
                  width={110}
                  height={110}
                  style={{ borderRadius: 16, flexShrink: 0 }}
                />
              )}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontFamily: "JetBrains Mono",
                    fontSize: 44,
                    fontWeight: 700,
                    lineHeight: 1.05,
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  {game.rank && (
                    <div
                      style={{
                        display: "flex",
                        color: "#c9a84c",
                        fontFamily: "JetBrains Mono",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      {game.rank}
                    </div>
                  )}
                  {game.level && (
                    <div
                      style={{
                        display: "flex",
                        color: "#8a92a8",
                        fontFamily: "JetBrains Mono",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      Lv {game.level}
                    </div>
                  )}
                  {wl && (
                    <div
                      style={{
                        display: "flex",
                        color: "#8a92a8",
                        fontFamily: "JetBrains Mono",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      {wl}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {lineup.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 24, gap: 10 }}>
                <div style={{ display: "flex", color: "#8a92a8", fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>
                  LINEUP
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
                  {lineup.map((u, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <div style={{ display: "flex", position: "relative" }}>
                        {unitIcons[i] ? (
                          <img
                            src={unitIcons[i]!}
                            width={68}
                            height={68}
                            style={{ borderRadius: 8, border: `3px solid ${costBorderColorHex(UNIT_COSTS[u.name] || 1)}` }}
                          />
                        ) : (
                          <div style={{ display: "flex", width: 68, height: 68, borderRadius: 8, border: "3px solid #2f3540", background: "#111419", alignItems: "center", justifyContent: "center", fontFamily: "JetBrains Mono", fontSize: 11, color: "#8a92a8" }}>
                            {u.name.slice(0, 4)}
                          </div>
                        )}
                      </div>
                      {u.stars > 1 && (
                        <div style={{ display: "flex", gap: 2 }}>
                          {Array.from({ length: u.stars }).map((_, s) => (
                            <div key={s} style={{ display: "flex", width: 8, height: 8, borderRadius: 4, background: u.stars >= 3 ? "#c9a84c" : "#8a92a8" }} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {relics.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 16, gap: 8 }}>
                <div style={{ display: "flex", color: "#8a92a8", fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>
                  RELICS
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {relics.map((r, i) => (
                    relicIcons[i] ? (
                      <img key={i} src={relicIcons[i]!} width={55} height={40} style={{ borderRadius: 6, objectFit: "contain" }} />
                    ) : (
                      <div key={i} style={{ display: "flex", padding: "4px 10px", border: "1px solid #2f3540", borderRadius: 6, background: "#111419", fontFamily: "JetBrains Mono", fontSize: 12, color: "#8a92a8" }}>
                        {r.slice(0, 8)}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {matchDate && (
              <div
                style={{
                  display: "flex",
                  color: "#8a92a8",
                  fontFamily: "JetBrains Mono",
                  fontSize: 18,
                  marginTop: "auto",
                  paddingTop: 16,
                }}
              >
                {matchDate}{matchTime ? `, ${matchTime}` : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    ,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Cinzel", data: fonts[0], weight: 700 as const, style: "normal" as const },
        { name: "JetBrains Mono", data: fonts[1], weight: 400 as const, style: "normal" as const },
        { name: "JetBrains Mono", data: fonts[2], weight: 700 as const, style: "normal" as const },
      ],
    }
  );

  res.setHeader("Content-Type", "image/png");
  res.setHeader(
    "Cache-Control",
    "public, max-age=3600, s-maxage=43200, stale-while-revalidate=86400"
  );
  res.status(200).send(body);
}
