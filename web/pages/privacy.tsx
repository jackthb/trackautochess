import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";

export default function PrivacyPage() {
  const title = `Privacy | ${SITE_TITLE}`;
  const description =
    "Privacy policy for Track Auto Chess: what data we collect, how cookies and advertising work, and how to contact us.";

  return (
    <>
      <SeoHead title={title} description={description} path="/privacy" localized={false} />

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
          <div className="eyebrow">Privacy</div>
          <h1>Privacy Policy</h1>
          <div className="updated">Last updated: May 2026</div>

          <h2>What we collect</h2>
          <p>
            We do not ask for or store personal information directly. We use
            Vercel Analytics to count anonymous pageviews and Vercel Speed
            Insights to measure performance. Neither service identifies
            individual visitors to us.
          </p>

          <h2>Cookies</h2>
          <p>
            This site does not set first-party cookies for tracking. Third-party
            services described below may set their own cookies in your browser.
          </p>

          <h2>Advertising</h2>
          <p>
            This site displays banner ads served by Adsterra. Adsterra and its
            partners may use cookies, device identifiers, and similar
            technologies to select and measure ads. Their data practices are
            governed by their own privacy policy. We do not share any user data
            with Adsterra; the ad network operates independently within the ad
            slots embedded on the page.
          </p>

          <h2>Third-party services</h2>
          <p>
            Steam profile data (display name, avatar, vanity URL) is fetched
            from the Steam Web API to render player and game pages. We do not
            store Steam credentials. Drodo Studio match data is fetched from
            public Auto Chess endpoints to populate match history.
          </p>

          <h2>Trademarks &amp; affiliation</h2>
          <p>
            Track Auto Chess is an independent fan project. It is not
            affiliated with, endorsed by, or sponsored by Valve Corporation or
            Drodo Studio. Dota, Dota 2, and Dota Auto Chess are trademarks of
            their respective owners. Game icons, names, and statistical data
            shown on this site are property of their respective owners and are
            used for informational and analytical purposes only.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about this policy, or requests relating to your data,
            can be sent through the{" "}
            <a href="/about#support">support form</a> on the about page.
          </p>
        </div>
      </div>
    </>
  );
}
