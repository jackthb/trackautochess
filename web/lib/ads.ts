export type AdSlot =
  | "bottom"
  | "sidebar"
  | "sidebar-left"
  | "in-content"
  | "in-content-2";

export interface DirectAd {
  href: string;
  title: string;
  description: string;
  cta: string;
}

const DEFAULT_DIRECT_AD_SLOTS: AdSlot[] = ["bottom", "in-content"];

export function adsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADS_ENABLED !== "false";
}

export function shouldShowGlobalAd(pathname: string): boolean {
  if (!adsEnabled()) return false;
  return (
    pathname !== "/dashboard" &&
    pathname !== "/privacy" &&
    !pathname.startsWith("/admin")
  );
}

export function adKeyForSlot(slot: AdSlot): string | undefined {
  if (slot === "bottom") return process.env.NEXT_PUBLIC_ADSTERRA_KEY_BOTTOM;
  if (slot === "sidebar-left")
    return process.env.NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR_LEFT;
  if (slot === "in-content")
    return process.env.NEXT_PUBLIC_ADSTERRA_KEY_INCONTENT;
  if (slot === "in-content-2")
    return process.env.NEXT_PUBLIC_ADSTERRA_KEY_INCONTENT_2;
  return process.env.NEXT_PUBLIC_ADSTERRA_KEY_SIDEBAR;
}

export function directAdForSlot(slot: AdSlot): DirectAd | null {
  const href = cleanUrlEnv(process.env.NEXT_PUBLIC_DIRECT_AD_URL);
  if (!href || !directAdSlots().includes(slot)) return null;

  return {
    href,
    title: cleanEnv(process.env.NEXT_PUBLIC_DIRECT_AD_TITLE) || "Sponsor Track Auto Chess",
    description:
      cleanEnv(process.env.NEXT_PUBLIC_DIRECT_AD_DESCRIPTION) ||
      "Reach Dota Auto Chess players with a lightweight direct placement.",
    cta: cleanEnv(process.env.NEXT_PUBLIC_DIRECT_AD_CTA) || "Learn more",
  };
}

function directAdSlots(): AdSlot[] {
  const raw = process.env.NEXT_PUBLIC_DIRECT_AD_SLOTS;
  if (!raw) return DEFAULT_DIRECT_AD_SLOTS;
  const values = raw
    .split(",")
    .map((slot) => slot.trim())
    .filter(Boolean);
  return values.filter(isAdSlot);
}

function isAdSlot(value: string): value is AdSlot {
  return (
    value === "bottom" ||
    value === "sidebar" ||
    value === "sidebar-left" ||
    value === "in-content" ||
    value === "in-content-2"
  );
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanUrlEnv(value: string | undefined): string | null {
  const trimmed = cleanEnv(value);
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
