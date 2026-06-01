"use client";

import { useState, type ReactNode } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { StyleRegistry, createStyleRegistry } from "styled-jsx";

/**
 * Lets styled-jsx components (e.g. the shared <Footer>) render with correct
 * SSR styles inside the App Router. Standard Next.js pattern — collects the
 * styled-jsx output during render and flushes it into <head> on the server.
 * Remove once no App Router route depends on a styled-jsx component.
 */
export default function StyledJsxRegistry({ children }: { children: ReactNode }) {
  const [registry] = useState(() => createStyleRegistry());

  useServerInsertedHTML(() => {
    const styles = registry.styles();
    registry.flush();
    return <>{styles}</>;
  });

  return <StyleRegistry registry={registry}>{children}</StyleRegistry>;
}
