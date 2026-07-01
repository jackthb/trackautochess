import { patchIndexData, patchesBySlugData } from "@/generated/content-data";
import type { EntryKind } from "@/lib/patchKinds";

export interface PatchHighlight {
  kind: EntryKind;
  name: string;
  detail: string;
}

export interface PatchPromoData {
  slug: string;
  date: string;
  title: string;
  image?: string;
  entitiesSynced?: boolean;
  entitiesSyncedAt?: string;
  highlight: PatchHighlight;
}

interface IndexPatch {
  date: string;
  title: string;
  slug: string;
  entitiesSynced?: boolean;
  entitiesSyncedAt?: string;
}

interface RuntimePatch {
  date: string;
  title: string;
  image?: string;
  entitiesSynced?: boolean;
  entitiesSyncedAt?: string;
  highlight?: PatchHighlight;
  highlights?: PatchHighlight[];
}

const PROMO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveHighlight(patch: RuntimePatch): PatchHighlight | null {
  const entry = patch.highlight ?? patch.highlights?.[0];
  if (!entry) return null;
  if (!cleanText(entry.name) && !cleanText(entry.detail)) return null;
  return entry;
}

export function formatHighlightText(entry: PatchHighlight): string {
  return cleanText(entry.detail) || cleanText(entry.name);
}

export function getLatestPatchSlug(): string | null {
  const patches = [...((patchIndexData as { patches: IndexPatch[] }).patches)].sort(
    (a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug)
  );
  return patches[0]?.slug ?? null;
}

export function getPatchPromo(
  slug: string,
  options?: { requireRecent?: boolean; now?: number }
): PatchPromoData | null {
  const patch =
    (patchesBySlugData as Record<string, RuntimePatch | undefined>)[slug] ?? null;
  const highlight = patch ? resolveHighlight(patch) : null;
  if (!patch || !highlight) return null;

  if (options?.requireRecent) {
    const now = options.now ?? Date.now();
    const patchDate = new Date(`${patch.date}T00:00:00Z`).getTime();
    if (Number.isNaN(patchDate) || now - patchDate > PROMO_WINDOW_MS) return null;
  }

  return {
    slug,
    date: patch.date,
    title: patch.title,
    image: patch.image,
    entitiesSynced: patch.entitiesSynced,
    entitiesSyncedAt: patch.entitiesSyncedAt,
    highlight,
  };
}

export function getLatestPatchPromo(now = Date.now()): PatchPromoData | null {
  const slug = getLatestPatchSlug();
  if (!slug) return null;
  return getPatchPromo(slug, { requireRecent: true, now });
}
