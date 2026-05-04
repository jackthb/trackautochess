/**
 * Locale wiring for the public site. Two locales are exposed: English
 * (default, no URL prefix) and Russian (`/ru/...`). Patch notes and other
 * long-form static content stay English-only and opt out via `localized`.
 *
 * The data layer (units / items / synergies / relics) carries an English
 * canonical record plus optional `names` / `descriptions` / `lore_i18n`
 * locale maps in `data/*.json`. `pickLocalized` resolves a user-facing
 * string for a given locale with fallbacks to en, falling through to a
 * given default if no locale has the string.
 *
 * Slugs intentionally stay English across locales so `/ru/units/abaddon`
 * routes to the same record as `/units/abaddon` — better link sharing
 * and simpler hreflang alternates.
 */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// Maps the runtime URL locale to the JSON `*_i18n` map key. Identity for
// now; left as an indirection so the URL form and JSON form can diverge
// (e.g. `zh` URL → `zh-cn` JSON key) without rewriting callers.
const DATA_LOCALE_KEY: Record<Locale, string> = {
  en: "en",
  ru: "ru",
};

// hreflang code emitted to crawlers. ISO 639-1 short codes.
export const HREFLANG: Record<Locale, string> = {
  en: "en",
  ru: "ru",
};

// `<html lang>` value.
export const HTML_LANG: Record<Locale, string> = {
  en: "en",
  ru: "ru",
};

// Display label for the language switcher, in the language itself.
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Pick the best string for `locale` from a localization map.
 *
 * Lookup order: requested locale → English → first non-empty value → empty
 * string. The data layer often stores English fallbacks for Russian (Drodo
 * does this for item names), so the English step covers that without any
 * special-casing here.
 */
export function pickLocalized(
  values: Record<string, string> | null | undefined,
  locale: Locale,
): string {
  if (!values) return "";
  const key = DATA_LOCALE_KEY[locale];
  if (values[key]) return values[key];
  if (values.en) return values.en;
  for (const v of Object.values(values)) {
    if (v) return v;
  }
  return "";
}

/**
 * Build a path with the locale prefix. Used by hreflang and sitemap
 * builders. `en` returns the path unchanged (default locale, no prefix).
 */
export function localePath(locale: Locale, path: string): string {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return locale === DEFAULT_LOCALE ? trimmed : `/${locale}${trimmed}`;
}
