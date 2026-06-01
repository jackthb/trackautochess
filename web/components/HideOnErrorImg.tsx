"use client";

import type { ImgHTMLAttributes } from "react";

/**
 * <img> that hides itself if the source fails to load. A small client island so
 * Server Components can keep the original hide-on-broken-icon behavior (event
 * handlers like onError can't live in a Server Component).
 */
export function HideOnErrorImg(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={props.alt ?? ""}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
