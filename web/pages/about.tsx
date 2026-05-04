import { useState } from "react";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";

export default function AboutPage() {
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = `About | ${SITE_TITLE}`;
  const description =
    "How Tracker Autochess surfaces Dota Auto Chess player statistics from Drodo profile data and manually tracked match history.";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setError(null);

    if (!message.trim() || message.trim().length < 20) {
      setError("Message must be at least 20 characters.");
      return;
    }

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
      setStatus("Sent. Thanks, we'll take a look.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Support request failed. Try again."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/about"
        localized={false}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: "About Track Auto Chess",
          description,
        }}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 840px;
          margin: 0 auto;
          padding: 56px 32px 84px;
        }
        .eyebrow {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper-wide);
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 14px;
        }
        h1 {
          font-family: var(--font-display);
          font-size: var(--fs-32);
          line-height: 1.15;
          color: var(--text-primary);
          margin-bottom: 22px;
        }
        .copy {
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: var(--text-secondary);
          font-size: var(--fs-15);
          line-height: var(--lh-relaxed);
        }
        .copy a {
          color: var(--accent-dim);
          text-decoration: underline;
          text-underline-offset: 3px;
          transition: color var(--t-base) var(--t-easing);
        }
        .copy a:hover {
          color: var(--accent);
        }
        .panel {
          margin-top: 30px;
          padding: 24px;
          border: 1px solid var(--border);
          border-radius: var(--r-8);
          background: var(--bg-surface);
        }
        .panel-title {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper-wide);
          text-transform: uppercase;
          color: var(--text-primary);
          margin-bottom: 16px;
        }
        .source-list {
          display: grid;
          gap: 14px;
        }
        .source {
          display: grid;
          gap: 5px;
        }
        .source-name {
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          font-weight: var(--fw-bold);
          color: var(--gold);
          letter-spacing: var(--tr-body);
          text-transform: uppercase;
        }
        .source-desc {
          color: var(--text-secondary);
          line-height: var(--lh-relaxed);
        }
        .support-form {
          display: grid;
          gap: 14px;
        }
        .field {
          display: grid;
          gap: 8px;
        }
        label {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        input,
        textarea {
          width: 100%;
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-primary);
          background: var(--bg-deep);
          border: 1px solid var(--border);
          border-radius: var(--r-3);
          padding: 11px 12px;
          letter-spacing: var(--tr-body);
          transition: border-color var(--t-base) var(--t-easing);
        }
        textarea {
          min-height: 132px;
          resize: vertical;
          line-height: var(--lh-body);
        }
        input:focus,
        textarea:focus {
          outline: none;
          border-color: var(--accent-dim);
        }
        .honeypot {
          display: none;
        }
        .support-submit {
          justify-self: start;
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          color: var(--text-primary);
          background: rgba(201, 79, 61, 0.16);
          border: 1px solid var(--accent-dim);
          border-radius: var(--r-4);
          padding: 10px 18px;
          cursor: pointer;
          letter-spacing: var(--tr-body);
          transition:
            background var(--t-base) var(--t-easing),
            border-color var(--t-base) var(--t-easing);
        }
        .support-submit:hover:not(:disabled) {
          background: rgba(201, 79, 61, 0.24);
          border-color: var(--accent);
        }
        .support-submit:disabled {
          cursor: wait;
          opacity: 0.62;
        }
        .form-status {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          color: var(--text-secondary);
        }
        .form-error {
          color: var(--accent);
        }
      `}</style>

      <main className="page">
        <div className="container">
          <div className="eyebrow">About</div>
          <h1>How Tracker Autochess surfaces players&apos; statistics</h1>

          <div className="copy">
            <p>
              <a href="https://trackautochess.com">trackautochess.com</a>{" "}
              surfaces Dota Auto Chess player statistics from the best source
              available for a profile.
            </p>
            <p>
              DAC Tools is currently in pre-release, and this is our tooling to
              enable tracking in-game statistics.
            </p>
            <p>
              When Drodo exposes public profile data, we use that data. When
              Drodo data is not available, we fall back to manually tracked or
              imported match history.
            </p>
            <p>
              We run light advertisements to help cover hosting costs and
              support continued development of the tracker.
            </p>
          </div>

          <section className="panel">
            <div className="panel-title">Data Sources</div>
            <div className="source-list">
              <div className="source">
                <div className="source-name">Drodo profile data</div>
                <div className="source-desc">
                  Current rank, MMR, peak MMR, season games, candies, wins, and
                  season snapshots when Drodo returns them publicly.
                </div>
              </div>
              <div className="source">
                <div className="source-name">Tracked match history</div>
                <div className="source-desc">
                  Match-level stats captured or checked manually when public
                  Drodo profile data is missing, stale, or incomplete.
                </div>
              </div>
            </div>
          </section>

          <section className="panel" id="support">
            <div className="panel-title">Support</div>
            <form className="support-form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="support-contact">Contact</label>
                <input
                  id="support-contact"
                  name="contact"
                  type="text"
                  autoComplete="email"
                  placeholder="Steam name, Discord, or email"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="support-message">Message</label>
                <textarea
                  id="support-message"
                  name="message"
                  required
                  placeholder="Tell us what is broken, missing, or confusing."
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </div>
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="support-company">Company</label>
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
                className="support-submit"
                type="submit"
                disabled={sending}
              >
                {sending ? "Sending..." : "Send support request"}
              </button>
              {status && <div className="form-status">{status}</div>}
              {error && (
                <div className="form-status form-error">{error}</div>
              )}
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
