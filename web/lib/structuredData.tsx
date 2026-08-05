import type { ReactElement } from "react";

/**
 * Schema.org JSON-LD helpers.
 *
 * Seventeen pages each hand-rolled the same `<script type="application/ld+json">`
 * tag, seven rebuilt the identical two-level `BreadcrumbList`, and five rebuilt
 * the identical `CollectionPage` node. Keeping the shapes here means an SEO fix
 * lands once instead of seventeen times.
 */

export type JsonLdNode = Record<string, unknown>;

const SCHEMA_CONTEXT = "https://schema.org";

export interface Crumb {
  name: string;
  /** Omitted from the output when absent, so a missing `absoluteUrl()` is fine. */
  url?: string | null;
}

/**
 * A `BreadcrumbList` whose positions are derived from array order — the hand
 * written copies numbered `position` manually, which is easy to get wrong when
 * a level is inserted.
 */
export function breadcrumbList(trail: Crumb[]): JsonLdNode {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(crumb.url ? { item: crumb.url } : {}),
    })),
  };
}

/**
 * The `WebPage` node the entity detail pages (unit/item/relic/synergy) use,
 * where `about` names the thing the page documents.
 */
export function entityWebPage(options: {
  name: string;
  description: string;
  url?: string | null;
  about: string;
}): JsonLdNode {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    name: options.name,
    description: options.description,
    ...(options.url ? { url: options.url } : {}),
    about: { "@type": "Thing", name: options.about },
  };
}

/** The `CollectionPage` node every entity index page uses. */
export function collectionPage(options: {
  name: string;
  description: string;
  about?: string;
}): JsonLdNode {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "CollectionPage",
    name: options.name,
    description: options.description,
    ...(options.about ? { about: options.about } : {}),
  };
}

/**
 * `JSON.stringify` does not escape `<`, so a `</script>` sequence inside any
 * string value — a patch note headline or a creator's video title, both of
 * which are authored content — would close the tag early and spill the rest of
 * the payload into the document as markup. `<` is valid JSON and parses
 * back to `<`, so consumers see the original string.
 */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Renders one node, or an array of nodes, as a single JSON-LD script tag. */
export function JsonLd({
  data,
}: {
  data: JsonLdNode | JsonLdNode[];
}): ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
