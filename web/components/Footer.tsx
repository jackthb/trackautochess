import Link from "next/link";
import { useRouter } from "next/router";
import { SITE_NAME } from "@/lib/site";
import { normalizeLocale } from "@/lib/i18n";

const T = {
  en: {
    about: "About",
    support: "Support",
    privacy: "Privacy",
    footerAria: "Footer",
    disclaimer:
      "Not affiliated with or endorsed by Valve Corporation or Drodo Studio. Dota, Dota 2, and Dota Auto Chess are trademarks of their respective owners. Game data and assets are property of their respective owners and are used here for informational purposes only.",
  },
  ru: {
    about: "О сайте",
    support: "Поддержать",
    privacy: "Конфиденциальность",
    footerAria: "Подвал",
    disclaimer:
      "Сайт не связан с Valve Corporation или Drodo Studio и не одобрен ими. Dota, Dota 2 и Dota Auto Chess — товарные знаки соответствующих правообладателей. Игровые данные и ресурсы принадлежат их правообладателям и используются исключительно в информационных целях.",
  },
} as const;

export function Footer() {
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const t = T[locale];
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
          <nav className="links" aria-label={t.footerAria}>
            <Link href="/about" className="link">
              {t.about}
            </Link>
            <Link href="/about#support" className="link">
              {t.support}
            </Link>
            <Link href="/privacy" className="link">
              {t.privacy}
            </Link>
          </nav>
        </div>
        <div className="disclaimer">{t.disclaimer}</div>
      </footer>
    </>
  );
}
