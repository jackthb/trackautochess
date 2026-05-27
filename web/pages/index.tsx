import { createClient } from "@supabase/supabase-js";
import type { GetStaticProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { ProfileSearch } from "@/components/ProfileSearch";
import {
  getDefaultPlayerSearchResults,
  type SearchResult,
} from "@/lib/playerSearch";
import { SeoHead } from "@/lib/seo";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { normalizeLocale } from "@/lib/i18n";

interface HomeProps {
  initialSearchResults: SearchResult[];
}

const t = {
  description:
    "Look up Dota Auto Chess player MMR, season history, and tracked match stats by Steam vanity URL or Steam ID.",
  tagline:
    "Search any Steam profile to surface Auto Chess MMR, rank, season history, and tracked match stats.",
  pasteLabel: "Paste a Steam profile URL or SteamID64",
  exampleLabel: "Example:",
  placeholder: "Steam profile URL or SteamID64",
  snapshot: "Player Snapshot",
  currentSeason: "Current season",
  liveLabel: "Live MMR and rank bracket",
  liveValue: "Queen 3380+",
  historyLabel: "Season history",
  historyValue: "MMR peaks and games",
};

export default function Home({ initialSearchResults }: HomeProps) {
  const router = useRouter();
  const locale = normalizeLocale(router.locale ?? router.defaultLocale ?? undefined);
  const title = SITE_TITLE;
  const description = t.description;
  const siteUrl = absoluteUrl("/");
  const exampleSteamUrl =
    "https://steamcommunity.com/profiles/76561198022169086";

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      ...(siteUrl ? { url: siteUrl } : {}),
      ...(siteUrl
        ? {
            potentialAction: {
              "@type": "SearchAction",
              target: `${siteUrl}/players/{search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE_NAME,
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      ...(siteUrl ? { url: siteUrl } : {}),
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ];

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        path="/"
        locale={locale}
        structuredData={structuredData}
      />

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--s-12);
          padding: var(--s-10) var(--s-20);
          background: linear-gradient(90deg, rgba(224, 64, 42, 0.12) 0%, rgba(242, 188, 100, 0.10) 100%);
          border-bottom: 1px solid var(--border);
          text-decoration: none;
          transition: background var(--t-base) var(--t-easing);
        }
        .banner:hover {
          background: linear-gradient(90deg, rgba(224, 64, 42, 0.18) 0%, rgba(242, 188, 100, 0.16) 100%);
        }
        .banner-tag {
          font-size: var(--fs-11);
          font-weight: var(--fw-semibold);
          letter-spacing: var(--tr-upper);
          text-transform: uppercase;
          color: var(--accent);
          background: rgba(224, 64, 42, 0.15);
          padding: 2px 8px;
          border-radius: var(--r-3);
          flex-shrink: 0;
        }
        .banner-text {
          font-size: var(--fs-13);
          color: var(--text-secondary);
          letter-spacing: var(--tr-body);
        }
        .banner-arrow {
          font-size: var(--fs-13);
          color: var(--text-muted);
          flex-shrink: 0;
        }
        @media (max-width: 620px) {
          .banner {
            gap: var(--s-8);
            padding: var(--s-10) var(--s-14);
          }
          .banner-text {
            font-size: var(--fs-12);
          }
        }
        .hero {
          flex: 1;
          display: grid;
          place-items: center;
          position: relative;
          padding: 48px 24px;
        }
        .grid {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(
              var(--border-subtle) 1px,
              transparent 1px
            ),
            linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(
            ellipse at center,
            black 0%,
            transparent 65%
          );
          -webkit-mask-image: radial-gradient(
            ellipse at center,
            black 0%,
            transparent 65%
          );
          pointer-events: none;
        }
        .glow {
          position: absolute;
          width: 520px;
          height: 520px;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            rgba(224, 64, 42, 0.05) 0%,
            transparent 70%
          );
          pointer-events: none;
          filter: blur(42px);
        }
        .corner {
          position: absolute;
          width: 24px;
          height: 24px;
          border-color: var(--border);
          border-style: solid;
          border-width: 0;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.9s forwards;
        }
        .corner-tl {
          top: 32px;
          left: 32px;
          border-top-width: 1px;
          border-left-width: 1px;
        }
        .corner-tr {
          top: 32px;
          right: 32px;
          border-top-width: 1px;
          border-right-width: 1px;
        }
        .corner-bl {
          bottom: 32px;
          left: 32px;
          border-bottom-width: 1px;
          border-left-width: 1px;
        }
        .corner-br {
          bottom: 32px;
          right: 32px;
          border-bottom-width: 1px;
          border-right-width: 1px;
        }
        .content {
          position: relative;
          width: min(100%, 720px);
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .title {
          font-family: "Cinzel", serif;
          font-size: clamp(42px, 7vw, 72px);
          font-weight: 700;
          letter-spacing: 10px;
          text-transform: uppercase;
          line-height: 1;
          opacity: 0;
          animation: arrive 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
        }
        .title-track {
          color: var(--accent);
        }
        .title-autochess {
          color: var(--text-secondary);
          display: block;
        }
        .rule {
          width: 48px;
          height: 1px;
          background: var(--accent-dim);
          margin: 28px 0 24px;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.35s forwards;
        }
        .tagline {
          font-size: 14px;
          color: var(--text-muted);
          letter-spacing: 1.5px;
          max-width: 440px;
          line-height: 1.7;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards;
        }
        .search-wrap {
          position: relative;
          z-index: 5;
          width: min(100%, 560px);
          margin-top: 38px;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.65s forwards;
        }
        .search-guidance {
          margin-bottom: 12px;
          text-align: left;
        }
        .search-guidance-label {
          font-size: 12px;
          color: var(--text-secondary);
          letter-spacing: 0.8px;
        }
        .search-example {
          margin-top: 5px;
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.35px;
          overflow-wrap: anywhere;
        }
        .search-example span {
          color: var(--gold);
        }
        .preview {
          position: relative;
          z-index: 1;
          width: min(100%, 560px);
          margin-top: 30px;
          border: 1px solid var(--border);
          background: rgba(13, 15, 18, 0.74);
          text-align: left;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.8s forwards;
        }
        .preview-head,
        .preview-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: center;
        }
        .preview-head {
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .preview-title {
          font-size: 12px;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .preview-season {
          font-size: 12px;
          color: var(--gold);
        }
        .preview-row {
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .preview-row:last-child {
          border-bottom: none;
        }
        .preview-label {
          color: var(--text-secondary);
          font-size: 13px;
        }
        .preview-value {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 700;
        }
        @keyframes arrive {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 620px) {
          .hero {
            padding: 42px 18px;
          }
          .title {
            letter-spacing: 6px;
          }
          .preview-head,
          .preview-row {
            grid-template-columns: 1fr;
            gap: 6px;
          }
        }
      `}</style>

      <div className="page">
        {Date.now() < new Date("2026-06-15").getTime() && (
          <Link href="/patch-notes/2026-05-24-rebalance-patch" className="banner">
            <span className="banner-tag">NEW PATCH</span>
            <span className="banner-text">
              Kobold rework, Monk &amp; Mech (6), Lifestealer class change, new Kobold Cup item
            </span>
            <span className="banner-arrow">&rarr;</span>
          </Link>
        )}
        <div className="hero">
          <div className="grid" />
          <div className="glow" />

          <div className="corner corner-tl" />
          <div className="corner corner-tr" />
          <div className="corner corner-bl" />
          <div className="corner corner-br" />

          <main className="content">
            <h1 className="title">
              <span className="title-track">Track</span>
              <span className="title-autochess">Auto Chess</span>
            </h1>

            <div className="rule" />

            <p className="tagline">{t.tagline}</p>

            <div className="search-wrap">
              <div className="search-guidance">
                <div className="search-guidance-label">{t.pasteLabel}</div>
                <div className="search-example">
                  {t.exampleLabel} <span>{exampleSteamUrl}</span>
                </div>
              </div>
              <ProfileSearch
                initialResults={initialSearchResults}
                analyticsSource="home_hero"
                placeholder={t.placeholder}
              />
            </div>

            <div className="preview" aria-hidden="true">
              <div className="preview-head">
                <div className="preview-title">{t.snapshot}</div>
                <div className="preview-season">{t.currentSeason}</div>
              </div>
              <div className="preview-row">
                <span className="preview-label">{t.liveLabel}</span>
                <span className="preview-value">{t.liveValue}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">{t.historyLabel}</span>
                <span className="preview-value">{t.historyValue}</span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

export const getStaticProps: GetStaticProps<HomeProps> = async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { props: { initialSearchResults: [] }, revalidate: 300 };
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const initialSearchResults = await getDefaultPlayerSearchResults(supabase);
    return { props: { initialSearchResults }, revalidate: 300 };
  } catch {
    return { props: { initialSearchResults: [] }, revalidate: 300 };
  }
};
