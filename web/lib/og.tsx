import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";

interface OgImageOptions {
  width?: number;
  height?: number;
  fonts: { name: string; data: Buffer | ArrayBuffer; weight: number; style: "normal" | "italic" }[];
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
    fonts: options.fonts.map((f) => ({
      ...f,
      data: f.data instanceof Buffer ? f.data : Buffer.from(f.data),
    })),
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return Buffer.from(resvg.render().asPng());
}
