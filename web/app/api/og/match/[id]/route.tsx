import { renderOgImage, imageToDataUrl } from "@/lib/og";
import { resolveIconUrl } from "@/lib/icons";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseLineup,
  parseRelics,
  parseSynergies,
  relicStem,
  synIconName,
  unitStem,
  RANK_BRACKETS,
} from "@dac/shared/game-utils";
import relicsData from "@data/relics.json";
import type { RelicInfo } from "@dac/shared/types";
import { fetchSteamProfile } from "@/lib/steam";
import { UNIT_COSTS, computeSynergies } from "@/lib/units";

function mmrLevelToRank(level: number | null | undefined): string {
  if (level == null || level < 1 || level > RANK_BRACKETS.length) return "";
  return RANK_BRACKETS[level - 1].rank.replace("-", " ");
}

const RELICS_MAP = (relicsData as { relics: Record<string, RelicInfo> }).relics;
const REPEAT_RELIC_ID = "item_repeat_relic";
const STAR_ICON_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23c9a84c' d='M12 1.8l2.95 6.1 6.72.96-4.86 4.73 1.15 6.68L12 17.12l-5.96 3.15 1.15-6.68-4.86-4.73 6.72-.96L12 1.8z'/%3E%3C/svg%3E";

type LineupUnit = ReturnType<typeof parseLineup>[number];
type SynergyBadge = ReturnType<typeof parseSynergies>[number];

interface DisplayRelic {
  name: string;
  repeated: boolean;
}

interface MatchPlayerRow {
  id: number;
  match_id: string;
  steam_id: string | number | null;
  placement: number | null;
  mmr_level: number | null;
  hero_level: number | null;
  chess_lineup: string | null;
  synergies: string | null;
  relic: string | null;
  relic_history: unknown;
  win_round: number | null;
  lose_round: number | null;
}

interface SidebarBuild {
  id: number;
  placement: number;
  name: string;
  lineup: LineupUnit[];
  synergies: SynergyBadge[];
  unitIcons: (string | null)[];
  synergyIcons: (string | null)[];
}

function relicDisplayName(raw: string): string {
  return RELICS_MAP[raw]?.name || raw;
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

function displayRelicsFromRow(row: Pick<MatchPlayerRow, "relic" | "relic_history">): DisplayRelic[] {
  const fallbackRelics = parseRelics(row.relic).map((raw) => ({
    name: relicDisplayName(raw),
    repeated: false,
  }));

  if (row.relic_history && typeof row.relic_history === "object") {
    const entries = (Array.isArray(row.relic_history)
      ? row.relic_history
      : Object.values(row.relic_history as Record<string, unknown>)) as {
      relic?: unknown;
      round?: unknown;
    }[];

    const sorted = entries
      .filter((entry) => entry && typeof entry === "object" && typeof entry.relic === "string")
      .sort((a, b) => {
        const aRound = typeof a.round === "number" ? a.round : parseInt(String(a.round)) || 0;
        const bRound = typeof b.round === "number" ? b.round : parseInt(String(b.round)) || 0;
        return aRound - bRound;
      });

    const relics: DisplayRelic[] = [];
    for (const entry of sorted) {
      const rawId = String(entry.relic);
      if (rawId === REPEAT_RELIC_ID && relics.length > 0) {
        relics.push({ name: relics[relics.length - 1].name, repeated: true });
      } else {
        relics.push({ name: relicDisplayName(rawId), repeated: false });
      }
    }
    for (const fallback of fallbackRelics) {
      if (!relics.some((relic) => relic.name === fallback.name)) {
        relics.push(fallback);
      }
    }
    if (relics.length > 0) return relics;
  }

  return fallbackRelics;
}

function rowLineup(row: Pick<MatchPlayerRow, "chess_lineup">): LineupUnit[] {
  return parseLineup(row.chess_lineup, UNIT_COSTS);
}

function rowSynergies(row: Pick<MatchPlayerRow, "chess_lineup" | "synergies">): SynergyBadge[] {
  const lineup = rowLineup(row);
  const parsed = parseSynergies(row.synergies);
  return parsed.length > 0 ? parsed : computeSynergies(lineup);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await ogHandler(req, ctx);
  } catch (err) {
    console.error("[OG] handler error:", err);
    return new Response(String(err), { status: 500 });
  }
}

async function ogHandler(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  if (!rawId) {
    return new Response("Missing match player id", { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return new Response("Missing Supabase config", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: mp } = await supabase
    .from("match_players")
    .select(
      "id, match_id, steam_id::text, placement, mmr_level, hero_level, chess_lineup, synergies, relic, relic_history, win_round, lose_round"
    )
    .eq("id", rawId)
    .single<MatchPlayerRow>();

  if (!mp) {
    return new Response("Match player not found", { status: 404 });
  }

  const [steamProfile, fonts, matchPlayersResult] = await Promise.all([
    mp.steam_id
      ? fetchSteamProfile(String(mp.steam_id), supabase)
      : Promise.resolve({ name: null, customUrl: null, avatarUrl: null }),
    fontData,
    supabase
      .from("match_players")
      .select(
        "id, match_id, steam_id::text, placement, mmr_level, hero_level, chess_lineup, synergies, relic, relic_history, win_round, lose_round"
      )
      .eq("match_id", mp.match_id)
      .order("placement", { ascending: true }),
  ]);

  const p = mp.placement || 0;
  const pColor = placementColorHex(p);
  const rank = mp.mmr_level ? mmrLevelToRank(mp.mmr_level) : null;
  const displayName =
    steamProfile.name ||
    (mp.steam_id ? String(mp.steam_id) : "Unknown");
  const siteHost = getSiteHost();

  const lineup = rowLineup(mp);
  const synergies = rowSynergies(mp);
  const relics = displayRelicsFromRow(mp);
  const siteBase = process.env.NEXT_PUBLIC_SITE_URL || "https://www.trackautochess.com";
  const toAbs = (url: string) => (url.startsWith("/") ? `${siteBase}${url}` : url);

  const matchPlayers = (matchPlayersResult.data as MatchPlayerRow[] | null) ?? [];
  const sidebarRows = matchPlayers
    .filter((row) => row.id !== mp.id && row.placement != null)
    .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
    .slice(0, 3);
  const sidebarBuildsBase = sidebarRows.map((row) => ({
    id: row.id,
    placement: row.placement ?? 0,
    name: row.steam_id ? String(row.steam_id) : "Player",
    lineup: rowLineup(row).slice(0, 5),
    synergies: rowSynergies(row).slice(0, 7),
  }));

  const avatarPromise = imageToDataUrl(steamProfile.avatarUrl);
  const unitIconPromises = lineup.map((u) =>
    imageToDataUrl(toAbs(resolveIconUrl("units", unitStem(u.name))))
  );
  const synergyIconPromises = synergies.map((s) =>
    imageToDataUrl(toAbs(resolveIconUrl("synergies", synIconName(s.name))))
  );
  const repeatRelicIconPromise = readFile(
    path.join(process.cwd(), "public", "icons", "items", "repeat_relic.png")
  )
    .then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`)
    .catch(() => imageToDataUrl(toAbs("/icons/items/repeat_relic.png")));
  const relicIconPromises = relics.map((r) =>
    imageToDataUrl(toAbs(resolveIconUrl("relics", relicStem(r.name))))
  );
  const sidebarUnitIconPromises = sidebarBuildsBase.flatMap((build) =>
    build.lineup.map((u) => imageToDataUrl(toAbs(resolveIconUrl("units", unitStem(u.name)))))
  );
  const sidebarSynergyIconPromises = sidebarBuildsBase.flatMap((build) =>
    build.synergies.map((s) => imageToDataUrl(toAbs(resolveIconUrl("synergies", synIconName(s.name)))))
  );
  const [avatarDataUrl, ...iconResults] = await Promise.all([
    avatarPromise,
    repeatRelicIconPromise,
    ...unitIconPromises,
    ...synergyIconPromises,
    ...relicIconPromises,
    ...sidebarUnitIconPromises,
    ...sidebarSynergyIconPromises,
  ]);
  const repeatRelicIcon = iconResults[0];
  const unitIcons = iconResults.slice(1, 1 + lineup.length);
  const synergyIcons = iconResults.slice(1 + lineup.length, 1 + lineup.length + synergies.length);
  const relicIcons = iconResults.slice(1 + lineup.length + synergies.length, 1 + lineup.length + synergies.length + relics.length);
  const sidebarUnitStart = 1 + lineup.length + synergies.length + relics.length;
  const sidebarSynergyStart = sidebarUnitStart + sidebarUnitIconPromises.length;
  let sidebarUnitOffset = 0;
  let sidebarSynergyOffset = 0;
  const sidebarBuilds: SidebarBuild[] = sidebarBuildsBase.map((build) => {
    const unitIcons = iconResults.slice(
      sidebarUnitStart + sidebarUnitOffset,
      sidebarUnitStart + sidebarUnitOffset + build.lineup.length
    );
    const synergyIcons = iconResults.slice(
      sidebarSynergyStart + sidebarSynergyOffset,
      sidebarSynergyStart + sidebarSynergyOffset + build.synergies.length
    );
    sidebarUnitOffset += build.lineup.length;
    sidebarSynergyOffset += build.synergies.length;
    return { ...build, unitIcons, synergyIcons };
  });

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
            gap: 24,
          }}
        >
          <div
            style={{
              width: sidebarBuilds.length > 0 ? 720 : "100%",
              flexShrink: 0,
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
                  marginTop: 24,
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
                    gap: 10,
                    marginTop: 12,
                    alignItems: "flex-start",
                  }}
                >
                  {lineup.map((u, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        width: 58,
                        height: 68,
                        gap: 4,
                      }}
                    >
                      {unitIcons[i] ? (
                        <img
                          src={unitIcons[i]!}
                          width={52}
                          height={52}
                          style={{
                            borderRadius: 6,
                            border: `2px solid ${costBorderColorHex(UNIT_COSTS[u.name] || 1)}`,
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            width: 52,
                            height: 52,
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          gap: 1,
                          height: 12,
                        }}
                      >
                        {Array.from({ length: Math.max(0, u.stars - 1) }).map((_, s) => (
                          <img
                            key={s}
                            src={STAR_ICON_DATA_URL}
                            width={12}
                            height={12}
                            style={{ opacity: u.stars >= 3 ? 1 : 0.72 }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {synergies.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 14, gap: 6 }}>
                <div style={{ display: "flex", color: "#8a92a8", fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>
                  SYNERGIES
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {synergies.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.06)", border: "1px solid #2f3540", borderRadius: 7, padding: "4px 10px 4px 5px" }}>
                      {synergyIcons[i] ? (
                        <img src={synergyIcons[i]!} width={22} height={22} style={{ borderRadius: 4 }} />
                      ) : (
                        <div style={{ display: "flex", width: 22, height: 22, borderRadius: 4, background: "#111419" }} />
                      )}
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 15, fontWeight: 700, color: "#c4c0b6" }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {relics.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 14, gap: 8 }}>
                <div style={{ display: "flex", color: "#8a92a8", fontFamily: "JetBrains Mono", fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>
                  RELICS
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {relics.map((r, i) => (
                    relicIcons[i] ? (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative",
                          width: 61,
                          height: 46,
                          borderRadius: 8,
                          border: `1px solid ${r.repeated ? "rgba(201,168,76,0.85)" : "#2f3540"}`,
                          background: "rgba(0,0,0,0.18)",
                        }}
                      >
                        <img src={relicIcons[i]!} width={55} height={40} style={{ borderRadius: 6, objectFit: "contain" }} />
                        {r.repeated && (
                          repeatRelicIcon ? (
                            <img
                              src={repeatRelicIcon}
                              width={22}
                              height={22}
                              style={{
                                position: "absolute",
                                left: -4,
                                top: -5,
                                borderRadius: 5,
                                background: "rgba(7,8,11,0.88)",
                                border: "1px solid rgba(201,168,76,0.95)",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                position: "absolute",
                                left: -4,
                                top: -5,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 22,
                                height: 22,
                                borderRadius: 5,
                                background: "rgba(7,8,11,0.88)",
                                border: "1px solid rgba(201,168,76,0.95)",
                                color: "#c9a84c",
                                fontFamily: "JetBrains Mono",
                                fontSize: 13,
                                fontWeight: 700,
                              }}
                            >
                              R
                            </div>
                          )
                        )}
                      </div>
                    ) : (
                      <div key={i} style={{ display: "flex", padding: "4px 10px", border: "1px solid #2f3540", borderRadius: 6, background: "#111419", fontFamily: "JetBrains Mono", fontSize: 12, color: "#8a92a8" }}>
                        {r.name.slice(0, 8)}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
          {sidebarBuilds.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: 282,
                gap: 12,
                paddingTop: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "#8a92a8",
                  fontFamily: "JetBrains Mono",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: 2,
                }}
              >
                TOP BUILDS
              </div>
              {sidebarBuilds.map((build) => (
                <div
                  key={build.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: 12,
                    border: "1px solid #252b34",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.045)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        color: placementColorHex(build.placement),
                        fontFamily: "JetBrains Mono",
                        fontSize: 22,
                        fontWeight: 700,
                      }}
                    >
                      #{build.placement}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        minWidth: 0,
                        color: "#8a92a8",
                        fontFamily: "JetBrains Mono",
                        fontSize: 10,
                        fontWeight: 700,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {build.name}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                    {build.synergies.map((s, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,0,0,0.24)", border: "1px solid #2f3540", borderRadius: 6, padding: "3px 7px 3px 4px" }}>
                        {build.synergyIcons[i] ? (
                          <img src={build.synergyIcons[i]!} width={19} height={19} style={{ borderRadius: 3 }} />
                        ) : (
                          <div style={{ display: "flex", width: 19, height: 19, borderRadius: 3, background: "#111419" }} />
                        )}
                        <span style={{ fontFamily: "JetBrains Mono", fontSize: 13, fontWeight: 700, color: "#c4c0b6" }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                  {build.lineup.length > 0 && (
                    <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
                      {build.lineup.map((u, i) => (
                        build.unitIcons[i] ? (
                          <img
                            key={i}
                            src={build.unitIcons[i]!}
                            width={30}
                            height={30}
                            style={{ borderRadius: 4, border: `1px solid ${costBorderColorHex(UNIT_COSTS[u.name] || 1)}` }}
                          />
                        ) : (
                          <div key={i} style={{ display: "flex", width: 30, height: 30, borderRadius: 4, background: "#111419" }} />
                        )
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control":
        "public, max-age=3600, s-maxage=43200, stale-while-revalidate=86400",
    },
  });
}
