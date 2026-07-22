import { DEFAULT_LOCALE } from "@/lib/i18n";
import { getAllSynergies, type DisplaySynergy } from "@/lib/synergies";

export interface GuidePreviewIcon {
  href: string;
  iconUrl: string;
  name: string;
}

const MAX_ICONS = 6;

function synergyIcon(synergy: DisplaySynergy): GuidePreviewIcon {
  return {
    href: `/synergies/${synergy.slug}`,
    iconUrl: synergy.iconUrl,
    name: synergy.name,
  };
}

function findSynergyByName(text: string): DisplaySynergy | null {
  const lower = text.toLowerCase();
  const singular = lower.endsWith("s") ? lower.slice(0, -1) : lower;
  for (const synergy of getAllSynergies(DEFAULT_LOCALE)) {
    const name = synergy.name.toLowerCase();
    if (name === lower || name === singular || `${name}s` === lower) {
      return synergy;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function iconsFromTitle(title: string): GuidePreviewIcon[] {
  const names = getAllSynergies(DEFAULT_LOCALE)
    .map((s) => s.name)
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(${names.map(escapeRegExp).join("|")})s?\\b`, "gi");
  const seen = new Set<string>();
  const icons: GuidePreviewIcon[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(title)) !== null) {
    const synergy = findSynergyByName(match[0]);
    if (!synergy || seen.has(synergy.slug)) continue;
    seen.add(synergy.slug);
    icons.push(synergyIcon(synergy));
    if (icons.length >= MAX_ICONS) break;
  }
  return icons;
}

function iconsFromSlug(slug: string): GuidePreviewIcon[] {
  const tokens = slug.split("-").filter((t) => t && !/^\d+$/.test(t));
  const seen = new Set<string>();
  const icons: GuidePreviewIcon[] = [];

  const tokenVariants = (token: string): string[] => {
    const variants = [token];
    if (token.endsWith("s") && token.length > 3) variants.push(token.slice(0, -1));
    return variants;
  };

  for (const synergy of getAllSynergies(DEFAULT_LOCALE)) {
    const slugParts = synergy.slug.split("-");
    const stems = [synergy.slug, ...slugParts, synergy.slug.replace(/s$/, "")];
    const matched = tokens.some((token) =>
      tokenVariants(token).some(
        (variant) =>
          stems.includes(variant) ||
          variant === synergy.slug ||
          synergy.slug.startsWith(variant),
      ),
    );
    if (!matched || seen.has(synergy.slug)) continue;
    seen.add(synergy.slug);
    icons.push(synergyIcon(synergy));
    if (icons.length >= MAX_ICONS) break;
  }

  return icons;
}

/** Synergy icons for a guide card (from title + slug only). */
export function getGuidePreviewIcons(
  slug: string,
  title: string,
  _shareLink?: string | null,
): GuidePreviewIcon[] {
  const seen = new Set<string>();
  const merged: GuidePreviewIcon[] = [];

  const push = (icon: GuidePreviewIcon) => {
    const key = icon.href;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(icon);
  };

  for (const icon of iconsFromTitle(title)) push(icon);
  for (const icon of iconsFromSlug(slug)) push(icon);

  return merged.slice(0, MAX_ICONS);
}
