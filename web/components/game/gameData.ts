import type { GamePageProps } from "./GameView";
import { absoluteUrl, originFromUrl } from "@/lib/site";
import { playerProfilePath } from "@/lib/steam";
import {
  breadcrumbList,
  entityWebPage,
  type JsonLdNode,
} from "@/lib/structuredData";

// Server-safe pure helpers for the game/match pages. They live OUTSIDE the
// "use client" GameView module because the App Router pages call them during
// data fetching / generateMetadata (server) — a function exported from a client
// module can't be invoked on the server. Types are imported type-only (erased).

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
    ? `#${game.placement} ${displayName} — Dota Auto Chess Match | Track Auto Chess`
    : `${displayName} — Dota Auto Chess Match | Track Auto Chess`;
  const description = game.placement
    ? `${displayName} finished #${game.placement} in a Dota Auto Chess match${game.rank ? ` at ${game.rank}` : ""}.`
    : `Dota Auto Chess match details for ${displayName}.`;
  const imageAlt = `${displayName} placed #${game.placement} in a Dota Auto Chess match`;

  const structuredData: JsonLdNode[] = [
    entityWebPage({
      name: title,
      description,
      url: canonicalUrl,
      about: "Dota Auto Chess match",
    }),
    breadcrumbList([
      { name: displayName, url: playerCanonicalUrl },
      { name: "Match", url: canonicalUrl },
    ]),
  ];

  return { title, description, canonicalUrl, ogImageUrl, imageAlt, structuredData };
}
