import type { NextApiRequest, NextApiResponse } from "next";
import { renderOgImage, imageToDataUrl } from "@/lib/og";
import { resolveIconUrl } from "@/lib/icons";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseLineup, unitStem, RANK_BRACKETS } from "@dac/shared/game-utils";

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
    return res.status(400).send("Missing match player id");
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

  const { data: mp } = await supabase
    .from("match_players")
    .select("steam_id::text, placement, mmr_level, hero_level, chess_lineup, win_round, lose_round")
    .eq("id", rawId)
    .single();

  if (!mp) {
    return res.status(404).send("Match player not found");
  }

  const [steamProfile, fonts] = await Promise.all([
    mp.steam_id
      ? fetchSteamProfile(String(mp.steam_id), supabase)
      : Promise.resolve({ name: null, customUrl: null, avatarUrl: null }),
    fontData,
  ]);

  const p = mp.placement || 0;
  const pColor = placementColorHex(p);
  const rank = mp.mmr_level ? mmrLevelToRank(mp.mmr_level) : null;
  const displayName =
    steamProfile.name ||
    (mp.steam_id ? String(mp.steam_id) : "Unknown");
  const siteHost = getSiteHost();

  const lineup = parseLineup(mp.chess_lineup, UNIT_COSTS);

  const avatarPromise = imageToDataUrl(steamProfile.avatarUrl);
  const iconPromises = lineup.map((u) => {
    const url = resolveIconUrl("units", unitStem(u.name));
    const abs = url.startsWith("/") ? `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.trackautochess.com"}${url}` : url;
    return imageToDataUrl(abs);
  });
  const [avatarDataUrl, ...unitIcons] = await Promise.all([avatarPromise, ...iconPromises]);

  const wl =
    mp.win_round != null && mp.lose_round != null
      ? `${mp.win_round}W - ${mp.lose_round}L`
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
                  {rank && (
                    <div
                      style={{
                        display: "flex",
                        color: "#c9a84c",
                        fontFamily: "JetBrains Mono",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      {rank}
                    </div>
                  )}
                  {mp.hero_level && (
                    <div
                      style={{
                        display: "flex",
                        color: "#8a92a8",
                        fontFamily: "JetBrains Mono",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      Lv {mp.hero_level}
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
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginTop: 36,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    color: "#8a92a8",
                    fontFamily: "JetBrains Mono",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: 2,
                  }}
                >
                  LINEUP
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                    alignItems: "center",
                  }}
                >
                  {lineup.map((u, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      {unitIcons[i] ? (
                        <img
                          src={unitIcons[i]!}
                          width={48}
                          height={48}
                          style={{
                            borderRadius: 6,
                            border: `2px solid ${costBorderColorHex(UNIT_COSTS[u.name] || 1)}`,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            width: 48,
                            height: 48,
                            borderRadius: 6,
                            border: "2px solid #2f3540",
                            background: "#111419",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: "JetBrains Mono",
                            fontSize: 10,
                            color: "#8a92a8",
                          }}
                        >
                          {u.name.slice(0, 3)}
                        </div>
                      )}
                      {u.stars > 1 && (
                        <div style={{ display: "flex", fontSize: 10, color: "#c9a84c" }}>
                          {"★".repeat(u.stars)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
