"use client";

import Link from "next/link";
import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import styles from "./BetaSignup.module.css";

// Copy lives here (not in a locale file) to match the rest of the home hero.
const t = {
  heading: "Track Match history",
  blurbPre:
    "Sign up to get exclusive access to our match tracking software. It can record full game boards, changes, and help you track the ",
  blurbLink: "most successful boards",
  blurbPost: ".",
  placeholder: "you@example.com",
  submit: "Sign up",
  submitting: "Signing up...",
  done: "You're on the list. We'll email you when the tracker is ready.",
  invalid: "Enter a valid email address.",
  failed: "Signup failed. Try again in a moment.",
  companyLabel: "Company",
  emailLabel: "Email address",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function BetaSignup({
  source,
  exampleHref,
}: {
  source: string;
  /** Link target for "most successful boards" — a real captured game. */
  exampleHref?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      trackEvent("Beta Waitlist Validation Failed", { source });
      setError(t.invalid);
      return;
    }

    // The email itself never goes through trackEvent — lib/analytics strips
    // sensitive keys anyway, and the address is stored server-side in PostHog.
    trackEvent("Beta Waitlist Submitted", { source });
    setSending(true);
    try {
      const response = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source, company }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || t.failed);
      }
      setEmail("");
      setCompany("");
      setDone(true);
      trackEvent("Beta Waitlist Joined", { source });
    } catch (err) {
      trackEvent("Beta Waitlist Failed", { source });
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>{t.heading}</h2>
      <p className={styles.blurb}>
        {t.blurbPre}
        {exampleHref ? (
          <Link
            href={exampleHref}
            prefetch={false}
            onClick={() => trackEvent("Example Game Clicked", { source })}
          >
            {t.blurbLink}
          </Link>
        ) : (
          t.blurbLink
        )}
        {t.blurbPost}
      </p>

      {done ? (
        <p className={styles.done} role="status">
          {t.done}
        </p>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.srOnly} htmlFor="beta-email">
            {t.emailLabel}
          </label>
          <input
            id="beta-email"
            className={styles.input}
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t.placeholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
          />
          <div className={styles.honeypot} aria-hidden="true">
            <label htmlFor="beta-company">{t.companyLabel}</label>
            <input
              id="beta-company"
              name="company"
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <button className={styles.submit} type="submit" disabled={sending}>
            {sending ? t.submitting : t.submit}
          </button>
        </form>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
