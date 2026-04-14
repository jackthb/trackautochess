import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface HomeProps {
  supabase: SupabaseClient | null;
}

export default function Home({ supabase }: HomeProps) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setLoggedIn(true);
      setReady(true);
    });
  }, [supabase]);

  return (
    <>
      <Head>
        <title>DAC Tools</title>
        <meta
          name="description"
          content="Match tracker for Dota Auto Chess."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      </Head>

      <style jsx>{`
        .page {
          position: relative;
          z-index: 1;
          height: 100vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        /* Grid — faint chessboard echo */
        .grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(var(--border-subtle) 1px, transparent 1px),
            linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(ellipse at center, black 0%, transparent 65%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 65%);
          pointer-events: none;
        }

        /* Warm glow behind content */
        .glow {
          position: absolute;
          width: 480px;
          height: 480px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(201,168,76,0.04) 0%, transparent 70%);
          pointer-events: none;
          filter: blur(40px);
        }

        /* Content stack */
        .content {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }

        .hero-logo {
          width: 80px;
          height: 80px;
          margin-bottom: 32px;
          opacity: 0;
          animation: arrive 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0s forwards;
        }

        .title {
          font-family: 'Cinzel', serif;
          font-size: clamp(42px, 7vw, 72px);
          font-weight: 700;
          letter-spacing: 10px;
          text-transform: uppercase;
          line-height: 1;
          opacity: 0;
          animation: arrive 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards;
        }
        .title-dac {
          color: var(--gold);
        }
        .title-tools {
          color: var(--text-secondary);
          margin-left: 0.15em;
        }

        /* Thin rule */
        .rule {
          width: 48px;
          height: 1px;
          background: var(--gold-dim);
          margin: 28px 0 24px;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.35s forwards;
        }

        .tagline {
          font-size: 14px;
          color: var(--text-muted);
          letter-spacing: 1.5px;
          text-align: center;
          max-width: 340px;
          line-height: 1.7;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards;
        }

        /* Actions */
        .actions {
          display: flex;
          gap: 20px;
          margin-top: 44px;
          align-items: center;
          opacity: 0;
          animation: arrive 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.7s forwards;
        }

        .btn-download {
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 14px 28px;
          cursor: default;
          position: relative;
          overflow: hidden;
        }

        .btn-download::after {
          content: 'coming soon';
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--text-muted);
          background: var(--bg-surface);
          opacity: 0;
          transition: opacity 0.25s;
        }
        .btn-download:hover::after {
          opacity: 1;
        }

        .divider {
          width: 1px;
          height: 20px;
          background: var(--border);
        }

        .btn-sign-in {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--text-secondary);
          letter-spacing: 0.5px;
          padding: 14px 0;
          transition: color 0.2s;
        }
        .btn-sign-in:hover {
          color: var(--text-primary);
        }

        /* Corner marks — subtle geometric detail */
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
        .corner-tl { top: 32px; left: 32px; border-top-width: 1px; border-left-width: 1px; }
        .corner-tr { top: 32px; right: 32px; border-top-width: 1px; border-right-width: 1px; }
        .corner-bl { bottom: 32px; left: 32px; border-bottom-width: 1px; border-left-width: 1px; }
        .corner-br { bottom: 32px; right: 32px; border-bottom-width: 1px; border-right-width: 1px; }

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
      `}</style>

      <div className="page">
        <div className="grid" />
        <div className="glow" />

        <div className="corner corner-tl" />
        <div className="corner corner-tr" />
        <div className="corner corner-bl" />
        <div className="corner corner-br" />

        <div className="content">
          <img src="/logo.svg" alt="DAC Tools" className="hero-logo" />
          <h1 className="title">
            <span className="title-dac">DAC</span>
            <span className="title-tools">Tools</span>
          </h1>

          <div className="rule" />

          <p className="tagline">
            Match tracker for Dota Auto Chess
          </p>

          <div className="actions">
            <button className="btn-download" disabled>
              Download
            </button>

            <div className="divider" />

            {ready && (
              loggedIn ? (
                <Link href="/dashboard" className="btn-sign-in">
                  Dashboard
                </Link>
              ) : (
                <a href="/api/auth/steam" className="btn-sign-in">
                  Sign in
                </a>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}
