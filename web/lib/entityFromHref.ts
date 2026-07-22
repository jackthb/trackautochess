import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllItems } from "@/lib/items";
import { getAllRelics } from "@/lib/relics";
import { getAllSynergies } from "@/lib/synergies";
import { getAllUnits } from "@/lib/units";

export interface EntityRef {
  name: string;
  iconUrl: string;
  href: string;
}

const entityByHref = (() => {
  const map = new Map<string, EntityRef>();
  for (const unit of getAllUnits(DEFAULT_LOCALE)) {
    map.set(`/units/${unit.slug}`, {
      name: unit.name,
      iconUrl: unit.iconUrl,
      href: `/units/${unit.slug}`,
    });
  }
  for (const item of getAllItems(DEFAULT_LOCALE)) {
    map.set(`/items/${item.slug}`, {
      name: item.name,
      iconUrl: item.iconUrl,
      href: `/items/${item.slug}`,
    });
  }
  for (const relic of getAllRelics(DEFAULT_LOCALE)) {
    map.set(`/relics/${relic.slug}`, {
      name: relic.name,
      iconUrl: relic.iconUrl,
      href: `/relics/${relic.slug}`,
    });
  }
  for (const synergy of getAllSynergies(DEFAULT_LOCALE)) {
    map.set(`/synergies/${synergy.slug}`, {
      name: synergy.name,
      iconUrl: synergy.iconUrl,
      href: `/synergies/${synergy.slug}`,
    });
  }
  return map;
})();

export function resolveEntityFromHref(href: string | undefined): EntityRef | null {
  if (!href) return null;
  const path = href.split(/[?#]/, 1)[0];
  return entityByHref.get(path) ?? null;
}
