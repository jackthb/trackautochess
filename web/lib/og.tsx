import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";

/**
 * Bare host for the watermark the OG cards render. Both card routes had an
 * identical private copy of this.
 */
export function getSiteHost(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.trackautochess.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

const fontDir = path.join(process.cwd(), "public", "fonts");

/**
 * The JetBrains Mono regular/bold pair every OG card uses, read once per
 * process. Awaiting the same promise twice is free, so routes can await it
 * per-request.
 */
export const ogFontData: Promise<[Buffer, Buffer]> = Promise.all([
  readFile(path.join(fontDir, "JetBrainsMono-Regular.ttf")),
  readFile(path.join(fontDir, "JetBrainsMono-Bold.ttf")),
]);

interface OgFont {
  name: string;
  data: Buffer | ArrayBuffer;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: "normal" | "italic";
}

interface OgImageOptions {
  width?: number;
  height?: number;
  fonts: OgFont[];
}

export async function imageToDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    let contentType = response.headers.get("content-type") || "image/png";
    let buffer: Buffer = Buffer.from(await response.arrayBuffer());
    // resvg (the OG rasterizer) can't decode WebP. Several icons are WebP bytes
    // served at a .png name (Steam's CDN does this for unit minimap icons), so
    // they'd render as blank boxes. Browsers content-sniff and show them fine;
    // here we transcode just the WebP ones to PNG in-memory so they rasterize.
    if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      buffer = await sharp(buffer).png().toBuffer();
      contentType = "image/png";
    }
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderOgImage(
  element: ReactNode,
  options: OgImageOptions
): Promise<Buffer> {
  const width = options.width ?? 1200;
  const height = options.height ?? 630;

  const svg = await satori(element as any, {
    width,
    height,
    fonts: options.fonts,
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return Buffer.from(resvg.render().asPng());
}
