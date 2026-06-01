import type { Metadata } from "next";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import styles from "./privacy.module.css";

// First page migrated to the App Router (pilot — see app/layout.tsx). It is
// intentionally non-localized: the content is English-only, and the App Router
// doesn't use the Pages `i18n` config, so /ru/privacy and /zh/privacy redirect
// here (see next.config.ts) instead of rendering locale variants.

const title = `Privacy | ${SITE_TITLE}`;
const description =
  "Privacy policy for Track Auto Chess: what data we collect, how cookies and advertising work, and how to contact us.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/privacy" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/privacy",
    locale: "en_US",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/logo.svg"],
  },
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>Privacy</div>
        <h1>Privacy Policy</h1>
        <div className={styles.updated}>Last updated: May 2026</div>

        <h2>What we collect</h2>
        <p>
          We do not ask for or store personal information directly. We use Vercel
          Analytics for anonymous pageview counts, Vercel Speed Insights for
          performance, and PostHog for privacy-scoped product analytics (which
          pages people visit and how features get used). Product events do not
          include raw search text, tokens, or private dashboard/admin URLs.
          PostHog only links events to an identified person profile after you
          sign in with Steam, in which case the profile is keyed by your Steam
          ID. The browser&apos;s Do Not Track signal is respected.
        </p>

        <h2>Cookies</h2>
        <p>
          PostHog analytics cookies are only set after you accept analytics
          cookies. If you decline, PostHog runs in cookieless mode. Third-party
          services described below may set their own cookies in your browser.
        </p>

        <h2>Advertising</h2>
        <p>
          This site may display banner ads served by Adsterra or direct
          sponsor/job placements configured by the site owner. Adsterra and its
          partners may use cookies, device identifiers, and similar technologies
          to select and measure ads. Direct placements do not run third-party ad
          scripts. We do not share user data with advertisers; ad networks
          operate independently within the ad slots embedded on the page.
        </p>

        <h2>Third-party services</h2>
        <p>
          Steam profile data (display name, avatar, vanity URL) is fetched from
          the Steam Web API to render player and game pages. We do not store
          Steam credentials. Drodo Studio match data is fetched from public Auto
          Chess endpoints to populate match history.
        </p>

        <h2>Trademarks &amp; affiliation</h2>
        <p>
          Track Auto Chess is an independent fan project. It is not affiliated
          with, endorsed by, or sponsored by Valve Corporation or Drodo Studio.
          Dota, Dota 2, and Dota Auto Chess are trademarks of their respective
          owners. Game icons, names, and statistical data shown on this site are
          property of their respective owners and are used for informational and
          analytical purposes only.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy, or requests relating to your data, can be
          sent through the <a href="/about#support">support form</a> on the
          about page.
        </p>
      </div>
    </div>
  );
}
