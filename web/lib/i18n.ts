/**
 * Locale wiring for the public site.
 *
 * Only English is currently exposed. Russian and Chinese content data can be
 * re-enabled later, but the public `/ru/...` and `/zh/...` URL spaces are
 * intentionally gone for now.
 */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const DATA_LOCALE_KEY: Record<Locale, string> = {
  en: "en",
};

export const HREFLANG: Record<Locale, string> = {
  en: "en",
};

export const HTML_LANG: Record<Locale, string> = {
  en: "en",
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
 * Lookup order: requested locale -> English -> first non-empty value -> empty
 * string.
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
 * Build a path with the locale prefix. `en` returns the path unchanged.
 */
export function localePath(locale: Locale, path: string): string {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return locale === DEFAULT_LOCALE ? trimmed : `/${locale}${trimmed}`;
}
