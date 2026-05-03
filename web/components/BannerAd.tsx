import { useEffect, useState } from "react";

type Slot =
  | "bottom"
  | "sidebar"
  | "sidebar-left"
  | "in-content"
  | "in-content-2";

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
  if (slot === "in-content" || slot === "in-content-2") {
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
  if (slot === "in-content-2")
    return process.env.NEXT_PUBLIC_ADSTERRA_KEY_INCONTENT_2;
  return process.env.NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR;
}

function buildSrcDoc(adKey: string, dims: Dims): string {
  const safeKey = adKey.replace(/[^A-Za-z0-9_-]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><base href="https://www.highperformanceformat.com/"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head><body><script type="text/javascript">atOptions={'key':'${safeKey}','format':'iframe','height':${dims.height},'width':${dims.width},'params':{}};</script><script type="text/javascript" src="https://www.highperformanceformat.com/${safeKey}/invoke.js"></script></body></html>`;
}

function wrapClassFor(slot: Slot): string {
  if (slot === "bottom") return "ad-bottom";
  if (slot === "in-content" || slot === "in-content-2") return "ad-incontent";
  return "ad-sidebar";
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
          gap: 6px;
        }
        .ad-bottom {
          padding: 32px 24px 24px;
        }
        .ad-sidebar {
          position: sticky;
          top: 96px;
        }
        .ad-incontent {
          padding: 8px 0 20px;
          margin: 0 auto;
        }
        .label {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          opacity: 0.6;
        }
        .frame {
          display: block;
          border: 0;
        }
      `}</style>
      <div
        className={`ad-wrap ${wrapClassFor(slot)}`}
        aria-label="Advertisement"
      >
        <span className="label">Advertisement</span>
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
    </>
  );
}
