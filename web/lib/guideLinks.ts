import { getAllItems } from "@/lib/items";
import { getAllRelics } from "@/lib/relics";
import { getAllSynergies } from "@/lib/synergies";
import { getAllUnits } from "@/lib/units";
import { DEFAULT_LOCALE } from "@/lib/i18n";

interface NameEntry {
  name: string;
  href: string;
}

let cachedEntries: NameEntry[] | null = null;

function buildEntries(): NameEntry[] {
  const entries: NameEntry[] = [];
  for (const unit of getAllUnits(DEFAULT_LOCALE)) {
    entries.push({ name: unit.name, href: `/units/${unit.slug}` });
  }
  for (const item of getAllItems(DEFAULT_LOCALE)) {
    entries.push({ name: item.name, href: `/items/${item.slug}` });
  }
  for (const relic of getAllRelics(DEFAULT_LOCALE)) {
    entries.push({ name: relic.name, href: `/relics/${relic.slug}` });
  }
  for (const synergy of getAllSynergies(DEFAULT_LOCALE)) {
    entries.push({ name: synergy.name, href: `/synergies/${synergy.slug}` });
  }
  // Longest name first, so "Aegis of Immortal" matches before the shorter
  // "Aegis" would otherwise steal part of it.
  entries.sort((a, b) => b.name.length - a.name.length);
  return entries;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns exact, word-boundary mentions of known unit/item/relic/synergy names
 * in guide prose into markdown links to their site pages — e.g. "Stolen
 * Vault" -> "[Stolen Vault](/relics/stolen-vault)". Single left-to-right
 * pass: once a span of text is consumed by a match it can't be re-matched,
 * so a name is never linked twice and one match can't nest inside another.
 */
export function linkifyGuideBody(body: string): string {
  cachedEntries ??= buildEntries();

  // Skip matches that start with `[` immediately preceded by `](`  (i.e.
  // already inside a markdown link) — cheap guard against double-linking
  // names that happen to appear in an href/label we already control (none
  // currently do, but keeps this safe if that changes).
  let result = "";
  let cursor = 0;
  const pattern = new RegExp(
    `\\b(${cachedEntries.map((e) => escapeRegExp(e.name)).join("|")})\\b`,
    "g",
  );
  const byName = new Map(cachedEntries.map((e) => [e.name, e.href]));

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    const href = byName.get(name);
    if (!href) continue;
    const start = match.index;
    // Don't relink text already inside a markdown link's label, e.g.
    // "[Stolen Vault](...)" — check for an unclosed `[` before `start`.
    const precedingOpen = body.lastIndexOf("[", start);
    const precedingClose = body.lastIndexOf("]", start);
    if (precedingOpen > precedingClose) continue;

    result += body.slice(cursor, start) + `[${name}](${href})`;
    cursor = start + name.length;
  }
  result += body.slice(cursor);
  return result;
}
