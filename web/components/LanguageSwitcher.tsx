import Link from "next/link";
import { useRouter } from "next/router";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/lib/i18n";

/**
 * Minimal language switcher: tiny inline list, one Link per locale,
 * highlighting the active one. Preserves the current path when switching
 * via Next's i18n routing — so `/units/abaddon` → `/ru/units/abaddon`.
 *
 * Use Link's `locale` prop rather than rewriting the URL by hand so Next
 * handles the alternate routing table and prefetches the locale variant.
 */
export function LanguageSwitcher() {
  const router = useRouter();
  const current = (router.locale ?? router.defaultLocale ?? "en") as Locale;
  // `asPath` keeps query and hash intact across locales.
  const path = router.asPath;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {LOCALES.map((loc, idx) => {
        const isActive = loc === current;
        return (
          <span key={loc} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {idx > 0 && (
              <span style={{ color: "var(--text-muted)", opacity: 0.5 }}>·</span>
            )}
            <Link
              href={path}
              locale={loc}
              prefetch={false}
              style={{
                fontSize: "12px",
                letterSpacing: "0.02em",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                fontWeight: isActive ? 600 : 400,
                textDecoration: "none",
              }}
              aria-current={isActive ? "true" : undefined}
            >
              {LOCALE_LABEL[loc]}
            </Link>
          </span>
        );
      })}
    </span>
  );
}
