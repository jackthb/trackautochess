import { unitStem, synIconName, relicStem } from "@dac/shared/game-utils";
import { stegaClean } from "next-sanity";
import { slugifyName } from "@/lib/slugs";
import type { DisplayUnit } from "@/lib/units";
import type { DisplaySynergy } from "@/lib/synergies";
import type { DisplayItem } from "@/lib/items";
import type { DisplayRelic } from "@/lib/relics";
import {
  ALL_UNITS_QUERY,
  ALL_SYNERGIES_QUERY,
  ALL_ITEMS_QUERY,
  ALL_RELICS_QUERY,
  PATCH_NOTE_QUERY,
  ALL_PATCH_NOTES_QUERY,
} from "./queries";

/**
 * Loaders that fetch from Sanity (with the `drafts` perspective when draft
 * mode is enabled) and project the response into the same Display* shapes the
 * JSON-backed loaders return, so detail pages can render identically.
 *
 * On the production code path (draftMode === false) these are unused — the
 * existing JSON cache is faster and is what's actually deployed. Sanity reads
 * happen only when an editor opens the page in the Presentation iframe.
 */

async function loadDraftQuery<T>(
  query: string,
  params: Record<string, unknown>,
  draftMode: boolean
) {
  const { loadQuery, loadQueryOptions } = await import("./ssr");
  const options = loadQueryOptions({ draftMode });
  return loadQuery<T>(query, params, options);
}

interface RawUnit {
  name: string;
  cost: number;
  pool?: string;
  synergies?: string[];
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

interface RawSynergy {
  gameId: string;
  name: string;
  description?: string;
  lore?: string;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

interface RawItem {
  gameId: string;
  name: string;
  description?: string;
  lore?: string;
  quality?: string;
  texture?: string;
  tier?: number;
  inCuratedSet?: boolean;
  iconFile?: string;
  notes?: string[];
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

interface RawRelic {
  gameId: string;
  name: string;
  description?: string;
  lore?: string;
  icon_url?: string | null;
  icon_dimensions?: { width: number; height: number } | null;
}

interface RawPatch {
  slug: string;
  date: string;
  title: string;
  source?: string;
  flavor?: string;
  sections?: Array<{
    heading: string;
    entries?: Array<{ kind: string; name: string; detail: string }>;
  }>;
}

const CJK_PUNCT: Record<string, string> = {
  "。": ".",
  "，": ",",
  "、": ",",
  "！": "!",
  "？": "?",
  "：": ":",
  "；": ";",
  "（": "(",
  "）": ")",
};

function normalizePunct(value: string): string {
  return value
    .replace(/[　-〿＀-￯]/g, (ch) => CJK_PUNCT[ch] ?? ch)
    .replace(/\.\s*\./g, ".");
}

function normalizeSynergyDescription(desc: string): string {
  return desc
    .replace(/\bspecies perk\b/gi, "SPECIES TRAIT")
    .replace(/\bspecies trait\b/gi, "SPECIES TRAIT")
    .replace(/\bclass perk\b/gi, "CLASS PERK");
}

function inferSynergyCategory(description: string): "species" | "class" | "other" {
  const lower = description.toLowerCase();
  if (lower.includes("species trait")) return "species";
  if (lower.includes("class perk")) return "class";
  return "other";
}

const RELIC_BOX_LORE = /^\s*from:?\s*relic\s*box\s*$/i;

function cleanRelicLore(value: string): string {
  if (!value) return "";
  return RELIC_BOX_LORE.test(value) ? "" : value;
}

function legacyItemIconUrl(icon: string, texture: string): string {
  if (icon) return `/icons/items/${icon}`;
  const stem = texture
    .replace(/^item_custom\//, "")
    .replace(/^custom\//, "")
    .replace(/^item_/, "");
  return stem ? `/icons/items/${stem}.png` : "";
}

export async function loadDraftUnits(draftMode: boolean): Promise<DisplayUnit[]> {
  const result = await loadDraftQuery<RawUnit[]>(ALL_UNITS_QUERY, {}, draftMode);
  return (result.data ?? [])
    .filter((u) => u.name?.trim())
    .map((u) => {
      const stem = unitStem(u.name);
      return {
        slug: slugifyName(u.name),
        name: u.name,
        cost: u.cost ?? 0,
        synergies: u.synergies ?? [],
        iconStem: stem,
        iconUrl: stegaClean(u.icon_url ?? "") || `/icons/units/${stem}.png`,
        iconDimensions: u.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name);
    });
}

export async function loadDraftSynergies(
  draftMode: boolean
): Promise<DisplaySynergy[]> {
  const result = await loadDraftQuery<RawSynergy[]>(
    ALL_SYNERGIES_QUERY,
    {},
    draftMode
  );
  return (result.data ?? [])
    .filter((s) => s.name?.trim())
    .map((s) => {
      const stem = synIconName(s.name);
      const description = normalizeSynergyDescription(s.description ?? "");
      return {
        slug: slugifyName(s.name),
        name: s.name,
        description,
        lore: s.lore ?? "",
        iconStem: stem,
        iconUrl: stegaClean(s.icon_url ?? "") || `/icons/synergies/${stem}.png`,
        iconDimensions: s.icon_dimensions ?? null,
        category: inferSynergyCategory(description),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadDraftItems(draftMode: boolean): Promise<DisplayItem[]> {
  const result = await loadDraftQuery<RawItem[]>(ALL_ITEMS_QUERY, {}, draftMode);
  return (result.data ?? [])
    .filter((i) => i.inCuratedSet && i.name?.trim() && typeof i.tier === "number")
    .map((i) => {
      const icon = i.iconFile ?? "";
      const texture = i.texture ?? "";
      return {
        slug: slugifyName(i.name),
        name: i.name,
        description: normalizePunct(i.description ?? ""),
        lore: normalizePunct(i.lore ?? ""),
        quality: i.quality ?? "",
        notes: (i.notes ?? []).map(normalizePunct),
        tier: i.tier as number,
        icon,
        texture,
        iconUrl: stegaClean(i.icon_url ?? "") || legacyItemIconUrl(icon, texture),
        iconDimensions: i.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.name.localeCompare(b.name);
    });
}

export async function loadDraftRelics(draftMode: boolean): Promise<DisplayRelic[]> {
  const result = await loadDraftQuery<RawRelic[]>(
    ALL_RELICS_QUERY,
    {},
    draftMode
  );
  return (result.data ?? [])
    .filter((r) => r.name?.trim())
    .map((r) => {
      const stem = relicStem(r.name);
      return {
        slug: slugifyName(r.name),
        name: r.name,
        description: r.description ?? "",
        lore: cleanRelicLore(r.lore ?? ""),
        iconStem: stem,
        iconUrl: stegaClean(r.icon_url ?? "") || `/icons/relics/${stem}.png`,
        iconDimensions: r.icon_dimensions ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface DraftPatch {
  date: string;
  title: string;
  source: string;
  flavor?: string;
  sections: Array<{
    heading: string;
    entries: Array<{
      kind: string;
      name: string;
      detail: string;
      entityType?: string;
      entitySlug?: string;
      commentary?: string;
      evidence?: Array<{ source: string; detail?: string; url?: string }>;
    }>;
  }>;
}

export interface PatchIndexEntry {
  slug: string;
  date: string;
  title: string;
  titles?: Record<string, string> | null;
}

export async function loadDraftPatchNote(
  slug: string,
  draftMode: boolean
): Promise<DraftPatch | null> {
  const result = await loadDraftQuery<RawPatch | null>(
    PATCH_NOTE_QUERY,
    { slug },
    draftMode
  );
  const patch = result.data;
  if (!patch) return null;
  return {
    date: patch.date,
    title: patch.title,
    source: patch.source ?? "",
    flavor: patch.flavor,
    sections: (patch.sections ?? []).map((s) => ({
      heading: s.heading,
      entries: (s.entries ?? []).map((e: any) => ({
        kind: e.kind,
        name: e.name ?? "",
        detail: e.detail ?? "",
        ...(e.entityType ? { entityType: e.entityType, entitySlug: e.entitySlug } : {}),
        ...(e.commentary ? { commentary: e.commentary } : {}),
        ...(Array.isArray(e.evidence) && e.evidence.length
          ? {
              evidence: e.evidence
                .filter((ev: any) => ev && (ev.source || ev.detail || ev.url))
                .map((ev: any) => ({
                  source: ev.source ?? "other",
                  ...(ev.detail ? { detail: ev.detail } : {}),
                  ...(ev.url ? { url: ev.url } : {}),
                })),
            }
          : {}),
      })),
    })),
  };
}

export async function loadPatchIndex(
  draftMode: boolean
): Promise<PatchIndexEntry[]> {
  const result = await loadDraftQuery<PatchIndexEntry[]>(
    ALL_PATCH_NOTES_QUERY,
    {},
    draftMode
  );
  return result.data ?? [];
}
