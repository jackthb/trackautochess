// Build-time index of editorial commentary by linked entity.
//
// Commentary lives on individual patch entries (see cms patchEntry schema),
// each of which can link to an entity. This module scans the generated patch
// JSON cache once and groups every entry that *has* commentary by its linked
// entity, so an entity page can show "here's what I think this change meant".
//
// Backed by the generated runtime module built from committed content/.
import { patchesBySlugData } from "@/generated/content-data";
import type { EntryKind } from "./patchKinds";
import type {
  EntityCommentary,
  EntityCommentaryType,
  PatchEvidence,
} from "./patchCommentaryTypes";

interface RawEntry {
  kind: EntryKind;
  name?: string;
  detail?: string;
  entity_type?: string;
  entity_slug?: string;
  commentary?: string;
  evidence?: PatchEvidence[];
}

let cache: Map<string, EntityCommentary[]> | null = null;

function key(type: string, slug: string): string {
  return `${type}:${slug}`;
}

function buildIndex(): Map<string, EntityCommentary[]> {
  const map = new Map<string, EntityCommentary[]>();

  for (const [patchSlug, patch] of Object.entries(
    patchesBySlugData as Record<
      string,
      {
        title?: string;
        date?: string;
        sections?: { entries?: RawEntry[] }[];
      }
    >,
  )) {
    const typedPatch: {
      title?: string;
      date?: string;
      sections?: { entries?: RawEntry[] }[];
    } = patch;
    for (const section of typedPatch.sections ?? []) {
      for (const entry of section.entries ?? []) {
        if (!entry.commentary || !entry.entity_type || !entry.entity_slug) {
          continue;
        }
        const rec: EntityCommentary = {
          patchSlug,
          patchTitle: typedPatch.title ?? patchSlug,
          date: typedPatch.date ?? "",
          kind: entry.kind,
          name: entry.name ?? "",
          detail: entry.detail ?? "",
          commentary: entry.commentary,
          evidence: Array.isArray(entry.evidence) ? entry.evidence : [],
        };
        const k = key(entry.entity_type, entry.entity_slug);
        const existing = map.get(k);
        if (existing) existing.push(rec);
        else map.set(k, [rec]);
      }
    }
  }

  // Newest patch first within each entity.
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  return map;
}

/**
 * Commentary attached to a given entity across all patches, newest first.
 * Returns an empty array when none exists.
 */
export function getCommentaryForEntity(
  type: EntityCommentaryType,
  slug: string
): EntityCommentary[] {
  if (!cache) cache = buildIndex();
  return cache.get(key(type, slug)) ?? [];
}
