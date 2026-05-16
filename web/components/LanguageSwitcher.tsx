import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  LOCALES,
  LOCALE_LABEL,
  LOCALE_SHORT,
  type Locale,
} from "@/lib/i18n";

/**
 * Compact dropdown switcher: a single button shows the active locale's short
 * code (e.g. "EN", "RU", "中"), and clicking opens a small popover listing
 * every locale by its native label. Switching uses Next's `locale` prop on
 * Link so routing stays consistent and the active path is preserved.
 *
 * The previous inline row pattern ("English · Русский · 中文") consumed
 * unbounded space in the navbar and looked noisy when scripts mixed; a
 * fixed-width trigger sidesteps both.
 */
export function LanguageSwitcher() {
  const router = useRouter();
  const current = (router.locale ?? router.defaultLocale ?? "en") as Locale;
  const path = router.asPath;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Close when the route changes (e.g. user picks a locale).
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${LOCALE_LABEL[current]}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          minWidth: 44,
          height: 26,
          padding: "0 8px",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-3, 3px)",
          color: "var(--text-secondary)",
          fontSize: 12,
          letterSpacing: "0.04em",
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        <span>{LOCALE_SHORT[current]}</span>
        <span aria-hidden="true" style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 130,
            padding: "4px 0",
            background: "rgba(8, 9, 11, 0.98)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-4, 4px)",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(8px)",
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {LOCALES.map((loc) => {
            const isActive = loc === current;
            return (
              <Link
                key={loc}
                href={path}
                locale={loc}
                prefetch={false}
                role="menuitem"
                aria-current={isActive ? "true" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 12px",
                  fontSize: 13,
                  textDecoration: "none",
                  color: isActive
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                  fontWeight: isActive ? 600 : 400,
                  background: isActive
                    ? "rgba(255, 255, 255, 0.04)"
                    : "transparent",
                }}
              >
                <span>{LOCALE_LABEL[loc]}</span>
                <span
                  aria-hidden="true"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    letterSpacing: "0.05em",
                  }}
                >
                  {LOCALE_SHORT[loc]}
                </span>
              </Link>
            );
          })}
        </span>
      )}
    </span>
  );
}
