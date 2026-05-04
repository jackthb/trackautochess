import { useState } from "react";
import { useRouter } from "next/router";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { normalizeLocale } from "@/lib/i18n";

const T = {
  en: {
    title: `About | ${SITE_TITLE}`,
    description:
      "How Tracker Autochess surfaces Dota Auto Chess player statistics from Drodo profile data and manually tracked match history.",
    structuredName: "About Track Auto Chess",
    eyebrow: "About",
    heading: "How Tracker Autochess surfaces players’ statistics",
    copy1pre: "",
    copy1post:
      " surfaces Dota Auto Chess player statistics from the best source available for a profile.",
    copy2:
      "DAC Tools is currently in pre-release, and this is our tooling to enable tracking in-game statistics.",
    copy3:
      "When Drodo exposes public profile data, we use that data. When Drodo data is not available, we fall back to manually tracked or imported match history.",
    copy4:
      "We run light advertisements to help cover hosting costs and support continued development of the tracker.",
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
  },
  ru: {
    title: `О сайте | ${SITE_TITLE}`,
    description:
      "Как Tracker Autochess собирает статистику игроков Dota Auto Chess из профилей Drodo и вручную отслеживаемой истории матчей.",
    structuredName: "О Track Auto Chess",
    eyebrow: "О сайте",
    heading: "Как Tracker Autochess показывает статистику игроков",
    copy1pre: "",
    copy1post:
      " собирает статистику игроков Dota Auto Chess из лучшего доступного источника для каждого профиля.",
    copy2:
      "DAC Tools сейчас находится в пред-релизе — это наш инструмент для отслеживания внутриигровой статистики.",
    copy3:
      "Когда Drodo делает данные профиля публичными, мы используем их. Если данных Drodo нет, мы переключаемся на вручную отслеживаемую или импортированную историю матчей.",
    copy4:
      "Мы показываем ненавязчивую рекламу, чтобы покрывать расходы на хостинг и поддерживать дальнейшую разработку трекера.",
    dataSources: "Источники данных",
    drodoTitle: "Данные профиля Drodo",
    drodoDesc:
      "Текущий ранг, MMR, пиковый MMR, игры за сезон, конфеты, победы и снимки сезонов, когда Drodo предоставляет их публично.",
    trackedTitle: "Отслеживаемая история матчей",
    trackedDesc:
      "Статистика матчей, собираемая или проверяемая вручную, когда данные профиля Drodo отсутствуют, устарели или неполные.",
    support: "Поддержка",
    contactLabel: "Контакт",
    contactPlaceholder: "Steam, Discord или e-mail",
    messageLabel: "Сообщение",
    messagePlaceholder: "Опишите, что сломано, чего не хватает или непонятно.",
    companyLabel: "Компания",
    sendBtn: "Отправить запрос",
    sendingBtn: "Отправка...",
    sentStatus: "Отправлено. Спасибо, мы посмотрим.",
    minLengthError: "Сообщение должно быть не короче 20 символов.",
    sendFailed: "Не удалось отправить. Попробуйте ещё раз.",
  },
} as const;

export default function AboutPage() {
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const t = T[locale];
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = t.title;
  const description = t.description;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setError(null);

    if (!message.trim() || message.trim().length < 20) {
      setError(t.minLengthError);
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
      setStatus(t.sentStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.sendFailed);
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
        locale={locale}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: t.structuredName,
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
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.heading}</h1>

          <div className="copy">
            <p>
              {t.copy1pre}
              <a href="https://trackautochess.com">trackautochess.com</a>
              {t.copy1post}
            </p>
            <p>{t.copy2}</p>
            <p>{t.copy3}</p>
            <p>{t.copy4}</p>
          </div>

          <section className="panel">
            <div className="panel-title">{t.dataSources}</div>
            <div className="source-list">
              <div className="source">
                <div className="source-name">{t.drodoTitle}</div>
                <div className="source-desc">{t.drodoDesc}</div>
              </div>
              <div className="source">
                <div className="source-name">{t.trackedTitle}</div>
                <div className="source-desc">{t.trackedDesc}</div>
              </div>
            </div>
          </section>

          <section className="panel" id="support">
            <div className="panel-title">{t.support}</div>
            <form className="support-form" onSubmit={handleSubmit}>
              <div className="field">
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
              <div className="field">
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
              <div className="honeypot" aria-hidden="true">
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
                className="support-submit"
                type="submit"
                disabled={sending}
              >
                {sending ? t.sendingBtn : t.sendBtn}
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
