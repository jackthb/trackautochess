import { useEffect, useState } from "react";

type Slot = "bottom" | "sidebar" | "sidebar-left" | "in-content";

interface BannerAdProps {
  slot: Slot;
}

interface Dims {
  width: number;
  height: number;
}

const BOTTOM_DESKTOP: Dims = { width: 728, height: 90 };
const BOTTOM_MOBILE: Dims = { width: 320, height: 50 };
const SIDEBAR_DESKTOP: Dims = { width: 160, height: 600 };
const SIDEBAR_LEFT_DESKTOP: Dims = { width: 160, height: 300 };
const IN_CONTENT: Dims = { width: 300, height: 250 };

function pickDims(slot: Slot, viewportWidth: number): Dims | null {
  if (slot === "bottom") {
    return viewportWidth < 728 ? BOTTOM_MOBILE : BOTTOM_DESKTOP;
  }
  if (slot === "in-content") {
    return IN_CONTENT;
  }
  if (viewportWidth < 1280) return null;
  return slot === "sidebar-left" ? SIDEBAR_LEFT_DESKTOP : SIDEBAR_DESKTOP;
}

function pickKey(slot: Slot): string | undefined {
  if (slot === "bottom") return process.env.NEXT_PUBLIC_ADSTERRA_KEY_BOTTOM;
  if (slot === "sidebar-left")
    return process.env.NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR_LEFT;
  if (slot === "in-content")
    return process.env.NEXT_PUBLIC_ADSTERRA_KEY_INCONTENT;
  return process.env.NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR;
}

function buildSrcDoc(adKey: string, dims: Dims): string {
  const safeKey = adKey.replace(/[^A-Za-z0-9_-]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><base href="https://www.highperformanceformat.com/"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head><body><script type="text/javascript">atOptions={'key':'${safeKey}','format':'iframe','height':${dims.height},'width':${dims.width},'params':{}};</script><script type="text/javascript" src="https://www.highperformanceformat.com/${safeKey}/invoke.js"></script></body></html>`;
}

function wrapClassFor(slot: Slot): string {
  if (slot === "bottom") return "ad-bottom";
  if (slot === "in-content") return "ad-incontent";
  return "ad-sidebar";
}

function slotCode(slot: Slot): string {
  if (slot === "bottom") return "BCAST/01";
  if (slot === "in-content") return "INSERT/02";
  if (slot === "sidebar-left") return "RAIL/L03";
  return "RAIL/R04";
}

export function BannerAd({ slot }: BannerAdProps) {
  const [mounted, setMounted] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    setMounted(true);
    setViewportWidth(window.innerWidth);
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const adKey = pickKey(slot);

  if (!mounted || !adKey) return null;

  const dims = pickDims(slot, viewportWidth);
  if (!dims) return null;

  const srcDoc = buildSrcDoc(adKey, dims);

  return (
    <>
      <style jsx>{`
        .ad-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .ad-bottom {
          padding: 44px 24px 32px;
        }
        .ad-sidebar {
          position: sticky;
          top: 96px;
        }
        .ad-incontent {
          padding: 8px 0 24px;
          margin: 0 auto;
        }

        .shell {
          display: inline-flex;
          flex-direction: column;
          gap: 9px;
          align-items: stretch;
        }

        .meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 2px;
          line-height: 1;
        }
        .label {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--accent-dim);
          opacity: 0.55;
        }
        .code {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 1.5px;
          color: var(--text-muted);
          opacity: 0.32;
        }

        .frame-wrap {
          position: relative;
          display: inline-block;
          line-height: 0;
        }

        .frame-wrap > .corner {
          position: absolute;
          width: 9px;
          height: 9px;
          border: 1px solid var(--accent-dim);
          opacity: 0.5;
          pointer-events: none;
          transition: opacity 280ms ease;
        }
        .corner-tl {
          top: -5px;
          left: -5px;
          border-right: 0;
          border-bottom: 0;
        }
        .corner-tr {
          top: -5px;
          right: -5px;
          border-left: 0;
          border-bottom: 0;
        }
        .corner-bl {
          bottom: -5px;
          left: -5px;
          border-right: 0;
          border-top: 0;
        }
        .corner-br {
          bottom: -5px;
          right: -5px;
          border-left: 0;
          border-top: 0;
        }
        .frame-wrap:hover > .corner {
          opacity: 0.9;
        }

        .frame {
          display: block;
          border: 0;
          background: transparent;
        }
      `}</style>
      <div
        className={`ad-wrap ${wrapClassFor(slot)}`}
        aria-label="Advertisement"
      >
        <div className="shell">
          <div className="meta">
            <span className="label">Sponsor</span>
            <span className="code">{slotCode(slot)}</span>
          </div>
          <div className="frame-wrap">
            <span className="corner corner-tl" />
            <span className="corner corner-tr" />
            <span className="corner corner-bl" />
            <span className="corner corner-br" />
            <iframe
              className="frame"
              srcDoc={srcDoc}
              width={dims.width}
              height={dims.height}
              scrolling="no"
              title="Advertisement"
              sandbox="allow-scripts allow-popups allow-same-origin"
            />
          </div>
        </div>
      </div>
    </>
  );
}
