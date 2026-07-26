/**
 * Locale wiring for the public site.
 *
 * English is the only locale. The `/ru/...` and `/zh/...` URL spaces are gone
 * and their routes serve 410 so search engines drop the old entries; content
 * JSON may still carry other-language keys, which `pickLocalized` falls back
 * past.
 */
const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const DATA_LOCALE_KEY: Record<Locale, string> = {
  en: "en",
};

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
