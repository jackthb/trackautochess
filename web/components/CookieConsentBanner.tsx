import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getPostHog } from "@/lib/posthog";
import { normalizeLocale } from "@/lib/i18n";
import styles from "./CookieConsentBanner.module.css";

type ConsentStatus = "pending" | "granted" | "denied" | "unavailable";

const T = {
  en: {
    title: "Analytics cookies",
    body:
      "We use PostHog cookies to understand how Track Auto Chess is used and improve the site. You can accept or decline analytics cookies.",
    privacy: "Privacy policy",
    accept: "Accept cookies",
    decline: "Decline",
  },
  ru: {
    title: "Файлы cookies аналитики",
    body:
      "Мы используем cookies PostHog, чтобы понимать, как используется Track Auto Chess, и улучшать сайт. Вы можете принять или отклонить аналитические cookies.",
    privacy: "Политика конфиденциальности",
    accept: "Принять cookies",
    decline: "Отклонить",
  },
} as const;

export function CookieConsentBanner() {
  const router = useRouter();
  const locale = normalizeLocale(
    router.locale ?? router.defaultLocale ?? undefined,
  );
  const t = T[locale];
  const [status, setStatus] = useState<ConsentStatus>("unavailable");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getPostHog().then((posthog) => {
      if (cancelled) return;
      if (!posthog) {
        setStatus("unavailable");
        return;
      }
      const explicitStatus = posthog.get_explicit_consent_status();
      setStatus(
        explicitStatus === "granted" || explicitStatus === "denied"
          ? explicitStatus
          : "pending",
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAccept = () => {
    setSaving(true);
    void getPostHog()
      .then((posthog) => {
        posthog?.opt_in_capturing();
        setStatus("granted");
      })
      .finally(() => setSaving(false));
  };

  const handleDecline = () => {
    setSaving(true);
    void getPostHog()
      .then((posthog) => {
        posthog?.opt_out_capturing();
        setStatus("denied");
      })
      .finally(() => setSaving(false));
  };

  if (status !== "pending") return null;

  return (
    <div className={styles.wrap} role="region" aria-label={t.title}>
      <div className={styles.banner}>
        <div className={styles.copy}>
          <div className={styles.title}>{t.title}</div>
          <p className={styles.body}>
            {t.body}{" "}
            <Link className={styles.link} href="/privacy">
              {t.privacy}
            </Link>
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            onClick={handleDecline}
            disabled={saving}
          >
            {t.decline}
          </button>
          <button
            className={`${styles.button} ${styles.buttonPrimary}`}
            type="button"
            onClick={handleAccept}
            disabled={saving}
          >
            {t.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
