/**
 * Lazily-built, per-locale lookup for the committed content modules.
 *
 * units / items / relics / synergies / talents each built the same thing by
 * hand — a `Map<Locale, T[]>`, a parallel `Map<Locale, Map<string, T>>`, an
 * `ensureLoaded(locale)` that filled both, and `getAllX` / `getXBySlug`
 * accessors that defaulted the locale. Five copies of one cache is five places
 * to fix when the caching rule changes, and they had already diverged on which
 * key the by-key map used. This holds the one copy.
 *
 * `build` runs at most once per locale, on first access.
 */
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

export interface LocaleRegistry<T> {
  /** Every entry for `locale`, in the order `build` returned them. */
  getAll(locale?: Locale): T[];
  /** The entry whose key matches, or null. */
  getByKey(key: string, locale?: Locale): T | null;
  /** Whether an entry with that key exists — avoids building a throwaway lookup. */
  hasKey(key: string, locale?: Locale): boolean;
}

export function createLocaleRegistry<T>(
  build: (locale: Locale) => T[],
  keyOf: (entry: T) => string,
): LocaleRegistry<T> {
  const listByLocale = new Map<Locale, T[]>();
  const byKeyByLocale = new Map<Locale, Map<string, T>>();

  function ensureLoaded(locale: Locale) {
    if (listByLocale.has(locale)) return;
    const list = build(locale);
    listByLocale.set(locale, list);
    byKeyByLocale.set(locale, new Map(list.map((entry) => [keyOf(entry), entry])));
  }

  return {
    getAll(locale: Locale = DEFAULT_LOCALE) {
      ensureLoaded(locale);
      return listByLocale.get(locale)!;
    },
    getByKey(key: string, locale: Locale = DEFAULT_LOCALE) {
      ensureLoaded(locale);
      return byKeyByLocale.get(locale)!.get(key) ?? null;
    },
    hasKey(key: string, locale: Locale = DEFAULT_LOCALE) {
      ensureLoaded(locale);
      return byKeyByLocale.get(locale)!.has(key);
    },
  };
}
