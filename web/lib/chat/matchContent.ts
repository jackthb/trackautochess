import {
  CHAT_GUIDE_MAX_CHARS,
  CHAT_MAX_ENTITY_MATCHES,
  CHAT_MAX_GUIDE_MATCHES,
} from "@/lib/chat/config";
import {
  chatQueryTokens,
  matchSynergyDocs,
  rankNamedMatches,
  scoreSynergyQuery,
  type SynergyQueryTarget,
} from "@/lib/chat/matchSynergies";
import type { ContentDocType, MatchedContentDoc } from "@/lib/chat/types";
import { getAllGuides, type DisplayGuide } from "@/lib/guides";
import { getAllItems, type DisplayItem } from "@/lib/items";
import { getAllRelics, type DisplayRelic } from "@/lib/relics";
import { slugifyName } from "@/lib/slugs";
import { getAllTalents, type DisplayTalent } from "@/lib/talents";
import { getAllUnits, type DisplayUnit } from "@/lib/units";

const GUIDE_STOPWORDS = new Set([
  "a",
  "and",
  "auto",
  "beginner",
  "beginners",
  "build",
  "chess",
  "combo",
  "core",
  "dota",
  "endgame",
  "for",
  "from",
  "guide",
  "how",
  "hunt",
  "in",
  "infinite",
  "legendary",
  "new",
  "patch",
  "play",
  "plus",
  "summons",
  "the",
  "to",
  "with",
]);

interface NamedEntity extends SynergyQueryTarget {
  docType: Exclude<ContentDocType, "guide" | "synergy" | "patch">;
  content: string;
  urlPath: string;
}

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n\n[Guide truncated.]`;
}

function stripPluralPart(token: string): string {
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

export function scoreGuideQuery(
  query: string,
  guide: SynergyQueryTarget,
): number {
  const named = scoreSynergyQuery(query, guide);
  if (named > 0) return named;

  const tokens = new Set(chatQueryTokens(query));
  const parts = (guide.slug || slugifyName(guide.name))
    .split("-")
    .filter(Boolean)
    .filter((part) => part.length >= 4 && !GUIDE_STOPWORDS.has(part));

  if (
    parts.some(
      (part) => tokens.has(part) || tokens.has(stripPluralPart(part)),
    )
  ) {
    return 70;
  }
  return 0;
}

function guideDoc(
  guide: DisplayGuide,
  score: number,
): MatchedContentDoc {
  const lines = [
    "Type: guide",
    `Title: ${guide.title}`,
    guide.shareLink ? `Share link: ${guide.shareLink}` : null,
    "",
    truncate(guide.body, CHAT_GUIDE_MAX_CHARS),
  ].filter((line): line is string => line !== null);

  return {
    id: `guide:${guide.slug}`,
    docType: "guide",
    title: guide.title,
    content: lines.join("\n"),
    urlPath: `/guides/${guide.slug}`,
    similarity: score / 100,
  };
}

function matchGuideDocs(query: string): MatchedContentDoc[] {
  const guides = getAllGuides().map((guide) => ({
    name: guide.title,
    slug: guide.slug,
    guide,
  }));
  return rankNamedMatches(query, guides, CHAT_MAX_GUIDE_MATCHES, scoreGuideQuery).map(
    (match) => guideDoc(match.item.guide, match.score),
  );
}

function unitContent(unit: DisplayUnit): string {
  const lines = [
    "Type: unit",
    `Name: ${unit.name}`,
    `Cost: $${unit.cost}`,
    unit.synergies.length > 0 ? `Synergies: ${unit.synergies.join(", ")}` : null,
    unit.commentary.trim() ? `Commentary: ${unit.commentary.trim()}` : null,
  ].filter((line): line is string => Boolean(line));

  if (unit.abilities.length > 0) {
    lines.push("", "Abilities:");
    for (const ability of unit.abilities.slice(0, 3)) {
      const description = ability.description.trim();
      lines.push(
        description
          ? `- ${ability.name}: ${description}`
          : `- ${ability.name}`,
      );
    }
  }
  return lines.join("\n");
}

function itemContent(item: DisplayItem): string {
  const lines = [
    "Type: item",
    `Name: ${item.name}`,
    `Tier: ${item.tier}`,
    item.description.trim(),
    item.notes.length > 0 ? `Notes: ${item.notes.join(" ")}` : null,
    item.commentary.trim() ? `Commentary: ${item.commentary.trim()}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

function relicContent(relic: DisplayRelic): string {
  const lines = [
    "Type: relic",
    `Name: ${relic.name}`,
    relic.source ? `Source: ${relic.source}` : null,
    relic.description.trim(),
    relic.commentary.trim() ? `Commentary: ${relic.commentary.trim()}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

function talentContent(talent: DisplayTalent): string {
  return [
    "Type: talent",
    `Name: ${talent.name}`,
    `Tier: ${talent.tier} (branch ${talent.branch})`,
    talent.description.trim(),
  ].join("\n");
}

function entityCatalog(): NamedEntity[] {
  return [
    ...getAllUnits().map((unit) => ({
      docType: "unit" as const,
      name: unit.name,
      slug: unit.slug,
      content: unitContent(unit),
      urlPath: `/units/${unit.slug}`,
    })),
    ...getAllItems().map((item) => ({
      docType: "item" as const,
      name: item.name,
      slug: item.slug,
      content: itemContent(item),
      urlPath: `/items/${item.slug}`,
    })),
    ...getAllRelics().map((relic) => ({
      docType: "relic" as const,
      name: relic.name,
      slug: relic.slug,
      content: relicContent(relic),
      urlPath: `/relics/${relic.slug}`,
    })),
    ...getAllTalents().map((talent) => ({
      docType: "talent" as const,
      name: talent.name,
      slug: slugifyName(talent.name),
      content: talentContent(talent),
      urlPath: "/talents",
    })),
  ];
}

function coveredUnitNames(docs: MatchedContentDoc[]): Set<string> {
  const names = new Set<string>();
  for (const doc of docs) {
    if (doc.docType !== "synergy") continue;
    for (const line of doc.content.split("\n")) {
      const match = line.match(/^- (.+) \(cost /);
      if (match?.[1]) names.add(match[1].toLowerCase());
    }
  }
  return names;
}

function matchEntityDocs(
  query: string,
  already: MatchedContentDoc[],
): MatchedContentDoc[] {
  const covered = coveredUnitNames(already);
  const matches = rankNamedMatches(
    query,
    entityCatalog(),
    CHAT_MAX_ENTITY_MATCHES + covered.size,
  );

  const selected: MatchedContentDoc[] = [];
  for (const match of matches) {
    const entity = match.item;
    if (
      entity.docType === "unit" &&
      covered.has(entity.name.toLowerCase()) &&
      match.score < 90
    ) {
      continue;
    }
    selected.push({
      id: `${entity.docType}:${entity.slug}`,
      docType: entity.docType,
      title: entity.name,
      content: entity.content,
      urlPath: entity.urlPath,
      similarity: match.score / 100,
    });
    if (selected.length >= CHAT_MAX_ENTITY_MATCHES) break;
  }
  return selected;
}

export function matchContentDocs(query: string): MatchedContentDoc[] {
  const guides = matchGuideDocs(query);
  const synergies = matchSynergyDocs(query);
  const entities = matchEntityDocs(query, synergies);
  return [...guides, ...synergies, ...entities];
}
