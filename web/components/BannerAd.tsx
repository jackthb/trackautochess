import { useEffect, useState } from "react";

type Slot = "bottom" | "sidebar";

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

function pickDims(slot: Slot, viewportWidth: number): Dims | null {
  if (slot === "bottom") {
    return viewportWidth < 728 ? BOTTOM_MOBILE : BOTTOM_DESKTOP;
  }
  return viewportWidth < 1024 ? null : SIDEBAR_DESKTOP;
}

function buildSrcDoc(adKey: string, dims: Dims): string {
  const safeKey = adKey.replace(/[^A-Za-z0-9_-]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><base href="https://www.highperformanceformat.com/"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head><body><script type="text/javascript">atOptions={'key':'${safeKey}','format':'iframe','height':${dims.height},'width':${dims.width},'params':{}};</script><script type="text/javascript" src="https://www.highperformanceformat.com/${safeKey}/invoke.js"></script></body></html>`;
}

export function BannerAd({ slot }: BannerAdProps) {
  const [mounted, setMounted] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    setMounted(true);
    setViewportWidth(window.innerWidth);
  }, []);

  const adKey =
    slot === "bottom"
      ? process.env.NEXT_PUBLIC_ADSTERRA_KEY_BOTTOM
      : process.env.NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR;

  if (!mounted || !adKey) return null;

  const dims = pickDims(slot, viewportWidth);
  if (!dims) return null;

  const srcDoc = buildSrcDoc(adKey, dims);
  const wrapClass = slot === "bottom" ? "ad-bottom" : "ad-sidebar";

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
          padding: 20px 16px;
          border-top: 1px solid var(--border-subtle);
          background: rgba(8, 9, 11, 0.5);
        }
        .ad-sidebar {
          position: sticky;
          top: 96px;
          padding: 12px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-3);
          background: rgba(8, 9, 11, 0.5);
        }
        .label {
          font-family: var(--font-mono);
          font-size: var(--fs-11, 11px);
          letter-spacing: var(--tr-upper, 1.2px);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .frame {
          display: block;
          border: 0;
        }
      `}</style>
      <div className={`ad-wrap ${wrapClass}`} aria-label="Advertisement">
        <div className="label">Advertisement</div>
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
