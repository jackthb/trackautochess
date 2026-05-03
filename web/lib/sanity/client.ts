import { createClient } from "next-sanity";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const studioUrl = process.env.NEXT_PUBLIC_SANITY_STUDIO_URL;

// Pinned API version. Bump when you intentionally adopt new GROQ features.
export const apiVersion = "2025-08-06";

// Single shared client. Reads come from the CDN by default; per-fetch
// overrides switch to the live API when we need draft content.
export const client = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: true,
  perspective: "published",
  stega: studioUrl ? { studioUrl } : false,
});

// Server-side client used by draft-mode handlers and `getStaticProps` in
// preview. `SANITY_VIEWER_TOKEN` must be a Viewer-permission token.
export function tokenClient() {
  const token = process.env.SANITY_VIEWER_TOKEN;
  if (!token) {
    throw new Error(
      "SANITY_VIEWER_TOKEN is not set — required to read drafts in preview mode."
    );
  }
  return client.withConfig({ token, useCdn: false });
}
