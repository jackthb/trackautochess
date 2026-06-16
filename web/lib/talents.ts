import { talentsData } from "@/generated/content-data";
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

export function getTierLabel(tier: number): string {
  const round = TIER_ROUNDS[tier];
  return round != null ? `Round ${round}` : `Tier ${tier}`;
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

const TALENTS_CACHE = new Map<Locale, DisplayTalent[]>();
const TALENT_BY_NAME_CACHE = new Map<Locale, Map<string, DisplayTalent>>();

function ensureLoaded(locale: Locale) {
  if (!TALENTS_CACHE.has(locale)) {
    const list = buildTalentsForLocale(locale);
    TALENTS_CACHE.set(locale, list);
    TALENT_BY_NAME_CACHE.set(
      locale,
      new Map(list.map((talent) => [talent.name.toLowerCase(), talent])),
    );
  }
}

export function getAllTalents(locale: Locale = DEFAULT_LOCALE): DisplayTalent[] {
  ensureLoaded(locale);
  return TALENTS_CACHE.get(locale)!;
}

export function getTalentByName(
  name: string,
  locale: Locale = DEFAULT_LOCALE,
): DisplayTalent | null {
  ensureLoaded(locale);
  return TALENT_BY_NAME_CACHE.get(locale)!.get(name.toLowerCase()) ?? null;
}
