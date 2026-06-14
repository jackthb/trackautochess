"use client";

import { useState } from "react";
import { SITE_TITLE } from "@/lib/site";
import { trackEvent } from "@/lib/analytics";
import styles from "./about.module.css";

const t = {
  title: `About | ${SITE_TITLE}`,
  description:
    "How Track Auto Chess surfaces Dota Auto Chess player statistics from Drodo profile data and manually tracked match history.",
  structuredName: "About Track Auto Chess",
  eyebrow: "About",
  heading: "How Track Auto Chess surfaces players’ statistics",
  copy1pre: "",
  copy1post:
    " surfaces Dota Auto Chess player statistics from the best source available for a profile.",
  copy2:
    "Track Auto Chess is currently in pre-release, and this is our tooling to enable tracking in-game statistics.",
  copy3:
    "When Drodo exposes public profile data, we use that data. When Drodo data is not available, we fall back to manually tracked or imported match history.",
  dataSources: "Data Sources",
  drodoTitle: "Drodo profile data",
  drodoDesc:
    "Current rank, MMR, peak MMR, season games, candies, wins, and season snapshots when Drodo returns them publicly.",
  trackedTitle: "Tracked match history",
  trackedDesc:
    "Match-level stats captured or checked manually when public Drodo profile data is missing, stale, or incomplete.",
  support: "Support",
  contactLabel: "Contact",
  contactPlaceholder: "Steam name, Discord, or email",
  messageLabel: "Message",
  messagePlaceholder: "Tell us what is broken, missing, or confusing.",
  companyLabel: "Company",
  sendBtn: "Send support request",
  sendingBtn: "Sending...",
  sentStatus: "Sent. Thanks, we'll take a look.",
  minLengthError: "Message must be at least 20 characters.",
  sendFailed: "Support request failed. Try again.",
};

/**
 * Client island for /about: the support/contact form (state + submit handler
 * posting to /api/support) and all rendered page content. Migrated verbatim
 * from pages/about.tsx; the SeoHead/structuredData moved to the Server
 * Component page.tsx.
 */
export function AboutContent() {
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setError(null);

    if (!message.trim() || message.trim().length < 20) {
      trackEvent("Support Request Validation Failed", {
        reason: "message_too_short",
        has_contact: Boolean(contact.trim()),
      });
      setError(t.minLengthError);
      return;
    }

    trackEvent("Support Request Submitted", {
      has_contact: Boolean(contact.trim()),
    });
    setSending(true);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact,
          message,
          company,
          page: typeof window !== "undefined" ? window.location.href : "/about",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Support request failed");
      }
      setContact("");
      setMessage("");
      setCompany("");
      setStatus(t.sentStatus);
      trackEvent("Support Request Sent", {
        has_contact: Boolean(contact.trim()),
      });
    } catch (err) {
      trackEvent("Support Request Failed", {
        reason: err instanceof Error ? "server" : "unknown",
        has_contact: Boolean(contact.trim()),
      });
      setError(err instanceof Error ? err.message : t.sendFailed);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>{t.eyebrow}</div>
        <h1>{t.heading}</h1>

        <div className={styles.copy}>
          <p>
            {t.copy1pre}
            <a href="https://www.trackautochess.com">trackautochess.com</a>
            {t.copy1post}
          </p>
          <p>{t.copy2}</p>
          <p>{t.copy3}</p>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelTitle}>{t.dataSources}</div>
          <div className={styles.sourceList}>
            <div className={styles.source}>
              <div className={styles.sourceName}>{t.drodoTitle}</div>
              <div className={styles.sourceDesc}>{t.drodoDesc}</div>
            </div>
            <div className={styles.source}>
              <div className={styles.sourceName}>{t.trackedTitle}</div>
              <div className={styles.sourceDesc}>{t.trackedDesc}</div>
            </div>
          </div>
        </section>

        <section className={styles.panel} id="support">
          <div className={styles.panelTitle}>{t.support}</div>
          <form className={styles.supportForm} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label htmlFor="support-contact">{t.contactLabel}</label>
              <input
                id="support-contact"
                name="contact"
                type="text"
                autoComplete="email"
                placeholder={t.contactPlaceholder}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="support-message">{t.messageLabel}</label>
              <textarea
                id="support-message"
                name="message"
                required
                placeholder={t.messagePlaceholder}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <div className={styles.honeypot} aria-hidden="true">
              <label htmlFor="support-company">{t.companyLabel}</label>
              <input
                id="support-company"
                name="company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            </div>
            <button
              className={styles.supportSubmit}
              type="submit"
              disabled={sending}
            >
              {sending ? t.sendingBtn : t.sendBtn}
            </button>
            {status && <div className={styles.formStatus}>{status}</div>}
            {error && (
              <div className={`${styles.formStatus} ${styles.formError}`}>
                {error}
              </div>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
