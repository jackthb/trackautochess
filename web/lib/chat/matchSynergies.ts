import { slugifyName } from "@/lib/slugs";
import { SYNERGY_TIERS, getAllUnits, type DisplayUnit } from "@/lib/units";
import {
  getAllSynergies,
  type DisplaySynergy,
} from "@/lib/synergies";
import type { MatchedContentDoc } from "@/lib/chat/types";

export const CHAT_MAX_SYNERGY_MATCHES = 2;

export interface SynergyQueryTarget {
  name: string;
  slug: string;
}

export interface SynergyMatch<T extends SynergyQueryTarget = DisplaySynergy> {
  synergy: T;
  score: number;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stripPlural(token: string): string {
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length];
}

export function chatQueryTokens(query: string): string[] {
  const slug = slugifyName(query);
  const parts = slug.split("-").filter(Boolean);
  const collapsed = parts.map(stripPlural);
  const bigrams: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    bigrams.push(`${parts[index]}-${parts[index + 1]}`);
    bigrams.push(`${collapsed[index]}-${collapsed[index + 1]}`);
  }
  return unique([slug, ...parts, ...collapsed, ...bigrams]);
}

export function scoreSynergyQuery(
  query: string,
  synergy: SynergyQueryTarget,
): number {
  const tokens = new Set(chatQueryTokens(query));
  const nameSlug = synergy.slug || slugifyName(synergy.name);
  const nameParts = nameSlug.split("-").filter(Boolean);
  if (!nameSlug) return 0;

  if (tokens.has(nameSlug) || tokens.has(stripPlural(nameSlug))) return 90;

  if (
    nameParts.length > 1 &&
    nameParts.every(
      (part) => tokens.has(part) || tokens.has(stripPlural(part)),
    )
  ) {
    return 95;
  }

  if (nameSlug.length >= 4) {
    const maxDistance = nameSlug.length >= 6 ? 2 : 1;
    for (const token of tokens) {
      if (token.length < 4) continue;
      const distance = levenshtein(stripPlural(token), nameSlug);
      if (distance > 0 && distance <= maxDistance) {
        return 50 - distance;
      }
    }
  }

  return 0;
}

export interface NamedMatch<T extends SynergyQueryTarget = SynergyQueryTarget> {
  item: T;
  score: number;
}

export function rankNamedMatches<T extends SynergyQueryTarget>(
  query: string,
  items: readonly T[],
  limit: number,
  scoreFn: (query: string, item: T) => number = scoreSynergyQuery,
): NamedMatch<T>[] {
  const trimmed = query.trim();
  if (!trimmed || limit <= 0) return [];

  const ranked = items
    .map((item) => ({
      item,
      score: scoreFn(trimmed, item),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.item.name.length - left.item.name.length;
    });

  const selected: NamedMatch<T>[] = [];
  for (const match of ranked) {
    const slug = match.item.slug;
    const contained = selected.some((kept) => {
      const keptParts = kept.item.slug.split("-");
      return keptParts.includes(slug) || kept.item.slug.includes(slug);
    });
    if (!contained) selected.push(match);
    if (selected.length >= limit) break;
  }
  return selected;
}

function rankSynergyMatches<T extends SynergyQueryTarget>(
  query: string,
  synergies: readonly T[],
  limit: number,
): SynergyMatch<T>[] {
  return rankNamedMatches(query, synergies, limit).map((match) => ({
    synergy: match.item,
    score: match.score,
  }));
}

export function matchSynergies(
  query: string,
  synergies: readonly SynergyQueryTarget[] = getAllSynergies(),
  limit = CHAT_MAX_SYNERGY_MATCHES,
): SynergyMatch<SynergyQueryTarget>[] {
  return rankSynergyMatches(query, synergies, limit);
}

function unitsForSynergy(
  synergy: DisplaySynergy,
  units: DisplayUnit[],
): DisplayUnit[] {
  return units.filter((unit) => unit.synergies.includes(synergy.name));
}

function synergyDoc(
  match: SynergyMatch<DisplaySynergy>,
  units: DisplayUnit[],
): MatchedContentDoc {
  const { synergy, score } = match;
  const members = unitsForSynergy(synergy, units);
  const tiers = SYNERGY_TIERS[synergy.name];
  const lines = [
    `Category: ${synergy.category}`,
    tiers?.length ? `Tiers: ${tiers.join("/")}` : null,
    synergy.description.trim(),
    synergy.notes.length > 0 ? `Notes: ${synergy.notes.join(" ")}` : null,
    synergy.commentary?.trim()
      ? `Commentary: ${synergy.commentary.trim()}`
      : null,
    "Units:",
    ...members.map((unit) => {
      const synergies = unit.synergies.join(", ");
      return `- ${unit.name} (cost ${unit.cost}; ${synergies})`;
    }),
  ].filter((line): line is string => Boolean(line));

  return {
    id: `synergy:${synergy.slug}`,
    docType: "synergy",
    title: synergy.name,
    content: lines.join("\n"),
    urlPath: `/synergies/${synergy.slug}`,
    similarity: score / 100,
  };
}

export function matchSynergyDocs(query: string): MatchedContentDoc[] {
  const matches = rankSynergyMatches(
    query,
    getAllSynergies(),
    CHAT_MAX_SYNERGY_MATCHES,
  );
  if (matches.length === 0) return [];
  const units = getAllUnits();
  return matches.map((match) => synergyDoc(match, units));
}
