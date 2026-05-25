import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";

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
    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
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
