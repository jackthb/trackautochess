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
          padding: 26px 32px 14px;
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

        .divider-row {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 32px;
          display: grid;
          grid-template-columns: 9px 1fr 9px;
          align-items: center;
          gap: 10px;
        }
        .divider-line {
          height: 1px;
          background: var(--border-subtle);
          opacity: 0.7;
        }
        .corner-mark {
          width: 9px;
          height: 9px;
          border: 1px solid var(--accent-dim);
          opacity: 0.5;
        }
        .corner-mark.left {
          border-right: 0;
          border-bottom: 0;
        }
        .corner-mark.right {
          border-left: 0;
          border-bottom: 0;
          margin-left: auto;
        }

        .disclaimer-row {
          max-width: 1200px;
          margin: 0 auto;
          padding: 14px 32px 24px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 24px;
          align-items: end;
        }
        .legal {
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }
        .legal-tag {
          flex: 0 0 auto;
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--accent-dim);
          opacity: 0.65;
          line-height: 1.6;
          padding-top: 1px;
          white-space: nowrap;
        }
        .legal-text {
          font-family: var(--font-mono);
          font-size: var(--fs-11, 11px);
          line-height: 1.6;
          color: var(--text-muted);
          opacity: 0.7;
        }
        .legal-text em {
          font-style: normal;
          color: var(--text-secondary);
          opacity: 0.92;
        }
        .station {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          opacity: 0.45;
          white-space: nowrap;
          padding-bottom: 1px;
        }
        .station .dot {
          display: inline-block;
          width: 5px;
          height: 5px;
          background: var(--accent-dim);
          border-radius: 50%;
          margin-right: 7px;
          vertical-align: 1px;
          opacity: 0.7;
          animation: pulse 3.4s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.85;
          }
        }

        @media (max-width: 720px) {
          .inner {
            align-items: flex-start;
            flex-direction: column;
            padding: 22px 20px 12px;
            gap: 14px;
          }
          .divider-row,
          .disclaimer-row {
            padding-left: 20px;
            padding-right: 20px;
          }
          .disclaimer-row {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .legal {
            flex-direction: column;
            gap: 6px;
          }
          .station {
            padding-bottom: 0;
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

        <div className="divider-row" aria-hidden="true">
          <span className="corner-mark left" />
          <span className="divider-line" />
          <span className="corner-mark right" />
        </div>

        <div className="disclaimer-row">
          <div className="legal">
            <span className="legal-tag">Trademarks</span>
            <p className="legal-text">
              <em>Not affiliated with or endorsed by Valve Corporation or
              Drodo Studio.</em>{" "}
              Dota, Dota 2, and Dota Auto Chess are trademarks of their
              respective owners. Game data and assets are property of their
              respective owners and are used here for informational purposes
              only.
            </p>
          </div>
          <div className="station" aria-hidden="true">
            <span className="dot" />
            STN/01 · ON-AIR
          </div>
        </div>
      </footer>
    </>
  );
}
