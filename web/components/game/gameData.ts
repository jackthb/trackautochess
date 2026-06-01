import type { Game, RelicInfo } from "@dac/shared/types";
import type { GamePageProps, RelicTimelineEntry } from "./GameView";
import { absoluteUrl } from "@/lib/site";
import { playerProfilePath } from "@/lib/steam";

// Server-safe pure helpers for the game/match pages. They live OUTSIDE the
// "use client" GameView module because the App Router pages call them during
// data fetching / generateMetadata (server) — a function exported from a client
// module can't be invoked on the server. Types are imported type-only (erased).

function originFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Compute SEO (title/description/canonical/og/structuredData) for a game or
 *  match page from its props. Used by each page's generateMetadata + JSON-LD. */
export function buildGameSeo(props: Omit<GamePageProps, "route">): {
  title: string;
  description: string;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  imageAlt: string;
  structuredData: Array<Record<string, unknown>>;
} {
  const { game, steamProfile, canonicalUrl, ogImageUrl } = props;

  const displayName = steamProfile.name || game.user_id;
  const playerPath = playerProfilePath(
    String(game.user_id),
    steamProfile.customUrl
  );
  const playerCanonicalUrl =
    absoluteUrl(playerPath, originFromUrl(canonicalUrl)) ?? playerPath;
  const title = game.placement
    ? `#${game.placement} ${displayName} — DAC Match | Track Auto Chess`
    : `${displayName} — DAC Match | Track Auto Chess`;
  const description = game.placement
    ? `${displayName} finished #${game.placement} in a Dota Auto Chess match${game.rank ? ` at ${game.rank}` : ""}.`
    : `Dota Auto Chess match details for ${displayName}.`;
  const imageAlt = `${displayName} placed #${game.placement} in a Dota Auto Chess match`;

  const structuredData: Array<Record<string, unknown>> = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      about: { "@type": "Thing", name: "Dota Auto Chess match" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: displayName,
          item: playerCanonicalUrl,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Match",
          ...(canonicalUrl ? { item: canonicalUrl } : {}),
        },
      ],
    },
  ];

  return { title, description, canonicalUrl, ogImageUrl, imageAlt, structuredData };
}

/** Parse a player's raw relic_history JSON into a sorted display timeline. */
export function parseRelicHistory(
  raw: unknown,
  relicsData: Record<string, RelicInfo>
): RelicTimelineEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const entries: { relic?: unknown; round?: unknown }[] = Array.isArray(raw)
    ? (raw as { relic?: unknown; round?: unknown }[])
    : Object.values(raw as Record<string, { relic?: unknown; round?: unknown }>);
  const out: RelicTimelineEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const rawId = typeof e.relic === "string" ? e.relic : "";
    if (!rawId) continue;
    const round = typeof e.round === "number" ? e.round : parseInt(String(e.round)) || 0;
    const display = relicsData[rawId]?.name || rawId;
    out.push({ round, name: display });
  }
  out.sort((a, b) => a.round - b.round);
  return out;
}
