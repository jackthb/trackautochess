"use client";

import { useEffect, useRef, useState } from "react";
import {
  adKeyForSlot,
  adsEnabled,
  directAdForSlot,
  type AdSlot,
} from "@/lib/ads";
import { trackEvent } from "@/lib/analytics";
import styles from "./BannerAd.module.css";

interface BannerAdProps {
  slot: AdSlot;
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

function pickDims(slot: AdSlot, viewportWidth: number): Dims | null {
  if (slot === "bottom") {
    return viewportWidth < 728 ? BOTTOM_MOBILE : BOTTOM_DESKTOP;
  }
  if (slot === "in-content" || slot === "in-content-2") {
    return IN_CONTENT;
  }
  if (viewportWidth < 1280) return null;
  return slot === "sidebar-left" ? SIDEBAR_LEFT_DESKTOP : SIDEBAR_DESKTOP;
}

function buildSrcDoc(adKey: string, dims: Dims): string {
  const safeKey = adKey.replace(/[^A-Za-z0-9_-]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><base href="https://www.highperformanceformat.com/"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style></head><body><script type="text/javascript">atOptions={'key':'${safeKey}','format':'iframe','height':${dims.height},'width':${dims.width},'params':{}};</script><script type="text/javascript" src="https://www.highperformanceformat.com/${safeKey}/invoke.js"></script></body></html>`;
}

function wrapClassFor(slot: AdSlot): string {
  if (slot === "bottom") return styles.adBottom;
  if (slot === "in-content" || slot === "in-content-2") return styles.adIncontent;
  return styles.adSidebar;
}

// Largest dim a slot can occupy. Used to reserve vertical space before the
// iframe/sponsor mounts so the page doesn't shift (CLS). Sidebars collapse
// to zero via the >=1280px media query below — matches pickDims().
function reservedHeight(slot: AdSlot): number {
  if (slot === "bottom") return BOTTOM_DESKTOP.height;
  if (slot === "in-content" || slot === "in-content-2") return IN_CONTENT.height;
  if (slot === "sidebar-left") return SIDEBAR_LEFT_DESKTOP.height;
  return SIDEBAR_DESKTOP.height;
}

export function BannerAd({ slot }: BannerAdProps) {
  const [mounted, setMounted] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackedViewRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    setViewportWidth(window.innerWidth);
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const adKey = adKeyForSlot(slot);
  const directAd = directAdForSlot(slot);
  const creativeType = directAd ? "direct" : "network";
  const dims = mounted ? pickDims(slot, viewportWidth) : null;
  // Ads are configured for this slot — render the wrapper so the page
  // layout reserves space immediately, then fill it once dims resolve.
  const hasCreative = adKey || directAd;
  const shouldMount = adsEnabled() && Boolean(hasCreative);
  const ready = Boolean(mounted && dims && hasCreative);
  const srcDoc = adKey && dims ? buildSrcDoc(adKey, dims) : "";

  useEffect(() => {
    if (!ready || !dims || trackedViewRef.current) return;
    const node = wrapRef.current;
    if (!node) return;

    const properties = {
      slot,
      creative_type: creativeType,
      size: `${dims.width}x${dims.height}`,
    };

    if (!("IntersectionObserver" in window)) {
      trackedViewRef.current = true;
      trackEvent("Ad Slot Viewed", properties);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          trackedViewRef.current = true;
          trackEvent("Ad Slot Viewed", properties);
          observer.disconnect();
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [creativeType, dims, ready, slot]);

  if (!shouldMount) return null;

  const reserved = reservedHeight(slot);

  return (
    <div
      ref={wrapRef}
      className={`${styles.adWrap} ${wrapClassFor(slot)}`}
      style={slot === "sidebar" || slot === "sidebar-left" ? { minHeight: reserved } : undefined}
      aria-label="Advertisement"
    >
      <span className={styles.label}>Advertisement</span>
      {ready && directAd && dims ? (
        <a
          className={`${styles.sponsor} ${dims.height <= 90 ? styles.compact : ""}`}
          style={{ maxWidth: reserved > 0 ? "320px" : "100%", minHeight: reserved }}
          href={directAd.href}
          target="_blank"
          rel="nofollow sponsored noopener noreferrer"
          onClick={() =>
            trackEvent("Direct Ad Clicked", {
              slot,
              creative_type: creativeType,
            })
          }
        >
          <span>
            <span className={styles.sponsorTitle}>{directAd.title}</span>
            <span className={styles.sponsorBody}>{directAd.description}</span>
          </span>
          <span className={styles.sponsorCta}>{directAd.cta}</span>
        </a>
      ) : ready && srcDoc && dims ? (
        <iframe
          className={styles.frame}
          srcDoc={srcDoc}
          width={dims.width}
          height={dims.height}
          scrolling="no"
          title="Advertisement"
          // allow-same-origin is required for Adsterra: invoke.js fetches
          // ad creative from highperformanceformat.com (set as the iframe's
          // base href). Without it the iframe loads but the script can't
          // pull content and the slot renders blank. The srcDoc payload is
          // built from a sanitized key + fixed-format string, so the same-
          // origin grant is scoped to the ad iframe alone.
          sandbox="allow-scripts allow-popups allow-same-origin"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <span className={styles.placeholder} aria-hidden />
      )}
    </div>
  );
}
