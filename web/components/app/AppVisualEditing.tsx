"use client";

import { VisualEditing } from "next-sanity/visual-editing";
import { useLiveMode } from "@sanity/react-loader";
import { client } from "@/lib/sanity/client";

// App Router counterpart of components/SanityVisualEditing.tsx (which imports the
// Pages-Router-only `@sanity/visual-editing/next-pages-router`). Rendered by a
// detail page only when draft mode is enabled, so published pages stay static.
const stegaClient = client.withConfig({ stega: true });

export default function AppVisualEditing() {
  useLiveMode({ client: stegaClient });
  return <VisualEditing />;
}
