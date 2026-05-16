import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

// UI chrome strings stay English across locales for now. Localized chrome
// will return through the same Sanity-driven pipeline as entity names once
// per-locale UI translations exist.
const t = {
  about: "About",
  support: "Support",
  privacy: "Privacy",
  footerAria: "Footer",
  browseHeading: "Browse",
  referenceHeading: "Reference",
  siteHeading: "Site",
  units: "Units",
  items: "Items",
  classes: "Classes",
  species: "Species",
  relics: "Relics",
  talents: "Talents",
  ranks: "Ranks",
  patchNotes: "Patch notes",
  disclaimer:
    "Not affiliated with or endorsed by Valve Corporation or Drodo Studio. Dota, Dota 2, and Dota Auto Chess are trademarks of their respective owners. Game data and assets are property of their respective owners and are used here for informational purposes only.",
};

export function Footer() {
  return (
    <>
      <style jsx>{`
        .footer {
          position: relative;
          z-index: 1;
          border-top: 1px solid var(--border-subtle);
          background: rgba(8, 9, 11, 0.74);
        }
        .inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 28px 32px 20px;
        }
        .columns {
          display: grid;
          grid-template-columns: 1.4fr 1fr 1fr 1fr;
          gap: 28px;
          align-items: flex-start;
        }
        .brand-col {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          color: var(--text-muted);
          letter-spacing: var(--tr-body);
        }
        .col-heading {
          font-family: var(--font-mono);
          font-size: var(--fs-11);
          letter-spacing: var(--tr-upper-wide);
          text-transform: uppercase;
          color: var(--text-primary);
          opacity: 0.7;
          margin: 0 0 10px;
        }
        .col-links {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .link {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--text-muted);
          text-decoration: none;
          transition: color var(--t-base) var(--t-easing);
        }
        .link:hover {
          color: var(--text-primary);
        }
        .disclaimer {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 32px 20px;
          font-family: var(--font-mono);
          font-size: var(--fs-11, 11px);
          color: var(--text-muted);
          line-height: 1.5;
          opacity: 0.6;
        }
        @media (max-width: 720px) {
          .columns {
            grid-template-columns: 1fr 1fr;
            gap: 22px;
          }
          .brand-col {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 420px) {
          .inner {
            padding: 22px 18px 16px;
          }
          .disclaimer {
            padding: 0 18px 18px;
          }
        }
      `}</style>
      <footer className="footer">
        <div className="inner">
          <nav className="columns" aria-label={t.footerAria}>
            <div className="brand-col">{SITE_NAME}</div>
            <div>
              <h3 className="col-heading">{t.browseHeading}</h3>
              <div className="col-links">
                <Link href="/units" className="link">{t.units}</Link>
                <Link href="/items" className="link">{t.items}</Link>
                <Link href="/classes" className="link">{t.classes}</Link>
                <Link href="/species" className="link">{t.species}</Link>
                <Link href="/relics" className="link">{t.relics}</Link>
              </div>
            </div>
            <div>
              <h3 className="col-heading">{t.referenceHeading}</h3>
              <div className="col-links">
                <Link href="/talents" className="link">{t.talents}</Link>
                <Link href="/ranks" className="link">{t.ranks}</Link>
                <Link href="/patch-notes" className="link">
                  {t.patchNotes}
                </Link>
              </div>
            </div>
            <div>
              <h3 className="col-heading">{t.siteHeading}</h3>
              <div className="col-links">
                <Link href="/about" className="link">{t.about}</Link>
                <Link href="/about#support" className="link">{t.support}</Link>
                <Link href="/privacy" className="link">{t.privacy}</Link>
              </div>
            </div>
          </nav>
        </div>
        <div className="disclaimer">{t.disclaimer}</div>
      </footer>
    </>
  );
}
