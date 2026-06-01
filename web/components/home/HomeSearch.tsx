"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ProfileSearch } from "@/components/ProfileSearch";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { createSupabaseClient } from "@/lib/supabase";
import { type SearchResult } from "@/lib/playerSearch";

export interface HomeProps {
  initialSearchResults: SearchResult[];
}

const t = {
  description:
    "Look up Dota Auto Chess player MMR, season history, and tracked match stats by Steam vanity URL or Steam ID.",
  tagline:
    "Search any Steam profile to surface Auto Chess MMR, rank, season history.",
  exampleLabel: "Example:",
  placeholder: "Steam profile URL or SteamID64",
  signinDivider: "or",
  viewProfile: "View your profile",
};

export default function HomeSearch({ initialSearchResults }: HomeProps) {
  const exampleSteamUrl =
    "https://steamcommunity.com/profiles/76561198022169086";

  // Mirror the nav's auth check (AppNavBar): once we know the visitor is signed
  // in, the hero's "Sign in through Steam" CTA is wrong — swap it for a link to
  // their own profile. Gate on `authReady` so logged-in users never flash the
  // sign-in button first.
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseClient();
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          min-height: calc(100vh - var(--nav-height));
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        :global(.banner) {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 10px 20px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
          text-decoration: none;
          transition: background 0.15s ease;
        }
        :global(.banner:hover) {
          background: var(--bg-elevated);
        }
        :global(.banner) .banner-tag {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--accent);
          flex-shrink: 0;
        }
        :global(.banner) .banner-text {
          font-size: 13px;
          color: var(--text-secondary);
        }
        :global(.banner) .banner-arrow {
          font-size: 13px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        @media (max-width: 620px) {
          :global(.banner) {
            gap: 8px;
            padding: 10px 14px;
          }
          :global(.banner) .banner-text {
            font-size: 12px;
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
          background-image:
            linear-gradient(var(--border-subtle) 1px, transparent 1px),
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
        .signin-cta {
          width: min(100%, 560px);
          margin-top: 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.72s forwards;
        }
        .signin-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          margin-bottom: 18px;
          color: var(--text-muted);
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }
        .signin-divider::before,
        .signin-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--border-subtle);
        }
        .signin-note {
          margin-bottom: 14px;
          font-size: 12px;
          letter-spacing: 0.8px;
          color: var(--text-secondary);
          text-transform: uppercase;
        }
        .profile-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 42px;
          padding: 0 24px;
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.4px;
          color: #fff;
          background: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 4px;
          text-decoration: none;
          white-space: nowrap;
          transition: filter 0.15s ease, box-shadow 0.15s ease;
        }
        .profile-cta:hover {
          filter: brightness(1.08);
          box-shadow: 0 0 0 3px rgba(224, 64, 42, 0.25);
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
          <Link
            href="/patch-notes/2026-05-24-kobold-cheers-poof-appears"
            className="banner"
          >
            <span className="banner-tag">NEW PATCH</span>
            <span className="banner-text">
              Kobold rework, Monk &amp; Mech (6), new Kobold Cup — read patch
              notes
            </span>
            <span className="banner-arrow">&rarr;</span>
          </Link>
        )}
        <div className="hero">
          <div className="grid" />
          <div className="glow" />

          <main className="content">
            <h1 className="title">
              <span className="title-track">Track</span>
              <span className="title-autochess">Auto Chess</span>
            </h1>

            <div className="rule" />

            <p className="tagline">{t.tagline}</p>

            <div className="search-wrap">
              <div className="search-guidance">
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

            {authReady && (
              <div className="signin-cta">
                <div className="signin-divider">
                  <span>{t.signinDivider}</span>
                </div>
                {user ? (
                  <Link href="/dashboard" className="profile-cta">
                    {t.viewProfile}
                  </Link>
                ) : (
                  <SteamSignInButton source="home_hero" size="md" />
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
