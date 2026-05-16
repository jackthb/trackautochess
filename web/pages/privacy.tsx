import { useRouter } from "next/router";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { normalizeLocale } from "@/lib/i18n";

// UI chrome text stays English across locales for now. Localized chrome
// returns through the Sanity-driven pipeline once per-locale translations exist.
const t = {
  title: `Privacy | ${SITE_TITLE}`,
  description:
    "Privacy policy for Track Auto Chess: what data we collect, how cookies and advertising work, and how to contact us.",
  eyebrow: "Privacy",
  heading: "Privacy Policy",
  updated: "Last updated: May 2026",
  h1: "What we collect",
  p1: "We do not ask for or store personal information directly. We use Vercel Analytics for anonymous pageview counts, Vercel Speed Insights for performance, and PostHog for privacy-scoped product analytics (which pages people visit and how features get used). Product events do not include raw search text, tokens, or private dashboard/admin URLs. PostHog only links events to an identified person profile after you sign in with Steam, in which case the profile is keyed by your Steam ID. The browser's Do Not Track signal is respected.",
  h2: "Cookies",
  p2: "PostHog analytics cookies are only set after you accept analytics cookies. If you decline, PostHog runs in cookieless mode. Third-party services described below may set their own cookies in your browser.",
  h3: "Advertising",
  p3: "This site may display banner ads served by Adsterra or direct sponsor/job placements configured by the site owner. Adsterra and its partners may use cookies, device identifiers, and similar technologies to select and measure ads. Direct placements do not run third-party ad scripts. We do not share user data with advertisers; ad networks operate independently within the ad slots embedded on the page.",
  h4: "Third-party services",
  p4: "Steam profile data (display name, avatar, vanity URL) is fetched from the Steam Web API to render player and game pages. We do not store Steam credentials. Drodo Studio match data is fetched from public Auto Chess endpoints to populate match history.",
  h5: "Trademarks & affiliation",
  p5: "Track Auto Chess is an independent fan project. It is not affiliated with, endorsed by, or sponsored by Valve Corporation or Drodo Studio. Dota, Dota 2, and Dota Auto Chess are trademarks of their respective owners. Game icons, names, and statistical data shown on this site are property of their respective owners and are used for informational and analytical purposes only.",
  h6: "Contact",
  p6pre:
    "Questions about this policy, or requests relating to your data, can be sent through the ",
  p6link: "support form",
  p6post: " on the about page.",
};

export default function PrivacyPage() {
  const router = useRouter();
  const locale = normalizeLocale(
    router.locale ?? router.defaultLocale ?? undefined,
  );

  return (
    <>
      <SeoHead
        title={t.title}
        description={t.description}
        path="/privacy"
        locale={locale}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
        }
        .container {
          max-width: 720px;
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
          margin-bottom: 8px;
        }
        .updated {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 32px;
        }
        h2 {
          font-family: var(--font-mono);
          font-size: var(--fs-13);
          letter-spacing: var(--tr-upper-wide);
          text-transform: uppercase;
          color: var(--text-primary);
          margin-top: 28px;
          margin-bottom: 12px;
        }
        p {
          color: var(--text-secondary);
          font-size: var(--fs-15);
          line-height: var(--lh-relaxed);
          margin-bottom: 14px;
        }
        a {
          color: var(--accent-dim);
          text-decoration: underline;
          text-underline-offset: 3px;
          transition: color var(--t-base) var(--t-easing);
        }
        a:hover {
          color: var(--accent);
        }
      `}</style>

      <div className="page">
        <div className="container">
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.heading}</h1>
          <div className="updated">{t.updated}</div>

          <h2>{t.h1}</h2>
          <p>{t.p1}</p>

          <h2>{t.h2}</h2>
          <p>{t.p2}</p>

          <h2>{t.h3}</h2>
          <p>{t.p3}</p>

          <h2>{t.h4}</h2>
          <p>{t.p4}</p>

          <h2>{t.h5}</h2>
          <p>{t.p5}</p>

          <h2>{t.h6}</h2>
          <p>
            {t.p6pre}
            <a href="/about#support">{t.p6link}</a>
            {t.p6post}
          </p>
        </div>
      </div>
    </>
  );
}
