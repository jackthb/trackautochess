import { talentsData } from "@/generated/content-data";
import { createLocaleRegistry } from "@/lib/localeRegistry";
import { DEFAULT_LOCALE, type Locale, pickLocalized } from "@/lib/i18n";

export interface DisplayTalent {
  key: string;
  name: string;
  description: string;
  tier: number;
  branch: "A" | "B";
}

interface RawTalent {
  title: string;
  description: string;
  titles?: Record<string, string>;
}

const TIER_ROUNDS: Record<number, number> = {
  1: 5,
  2: 15,
  3: 25,
  4: 35,
};

export function getTierRound(tier: number): number | null {
  return TIER_ROUNDS[tier] ?? null;
}

function buildTalentsForLocale(locale: Locale): DisplayTalent[] {
  return Object.entries(talentsData as Record<string, RawTalent>)
    .map(([key, value]) => {
      const tier = Number(key[0] || "0");
      const branch: "A" | "B" = key.slice(1).toUpperCase() === "B" ? "B" : "A";
      return {
        key: key.toUpperCase(),
        name: pickLocalized(value.titles, locale) || value.title,
        description: value.description,
        tier,
        branch,
      };
    })
    .sort((a, b) => a.tier - b.tier || a.branch.localeCompare(b.branch));
}

// Talents are looked up by display name rather than slug, so the registry key
// is the lowercased name.
const TALENTS = createLocaleRegistry(buildTalentsForLocale, (talent) =>
  talent.name.toLowerCase(),
);

export function getAllTalents(locale: Locale = DEFAULT_LOCALE): DisplayTalent[] {
  return TALENTS.getAll(locale);
}

export function getTalentByName(
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayTalent | null {
  return TALENTS.getByKey(name.toLowerCase(), locale);
}
