import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

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
          padding: 22px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }
        .brand {
          font-family: var(--font-mono);
          font-size: var(--fs-12);
          color: var(--text-muted);
          letter-spacing: var(--tr-body);
        }
        .links {
          display: flex;
          align-items: center;
          gap: 18px;
          flex-wrap: wrap;
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
        @media (max-width: 620px) {
          .inner {
            align-items: flex-start;
            flex-direction: column;
            padding: 20px 18px;
          }
          .disclaimer {
            padding: 0 18px 18px;
          }
        }
      `}</style>
      <footer className="footer">
        <div className="inner">
          <div className="brand">{SITE_NAME}</div>
          <nav className="links" aria-label="Footer">
            <Link href="/about" className="link">
              About
            </Link>
            <Link href="/about#support" className="link">
              Support
            </Link>
            <Link href="/privacy" className="link">
              Privacy
            </Link>
          </nav>
        </div>
        <div className="disclaimer">
          Not affiliated with or endorsed by Valve Corporation or Drodo Studio.
          Dota, Dota 2, and Dota Auto Chess are trademarks of their respective
          owners. Game data and assets are property of their respective owners
          and are used here for informational purposes only.
        </div>
      </footer>
    </>
  );
}
