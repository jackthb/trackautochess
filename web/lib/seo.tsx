import Head from "next/head";
import { absoluteUrl, SITE_NAME } from "@/lib/site";
import {
  DEFAULT_LOCALE,
  HREFLANG,
  LOCALES,
  localePath,
  type Locale,
} from "@/lib/i18n";

interface SeoHeadProps {
  title: string;
  description: string;
  /**
   * Locale-agnostic path (e.g. `/units/abaddon`). The component prepends the
   * active locale for canonical/og:url and emits hreflang alternates for the
   * other locales. For pages that opt out of i18n (e.g. patch notes), pass
   * `localized={false}` to suppress alternate emission.
   */
  path: string;
  /** Active locale; defaults to English. */
  locale?: Locale;
  /** Pages that aren't translated (patch notes, privacy). Suppresses hreflang. */
  localized?: boolean;
  type?: "website" | "article" | "profile";
  imagePath?: string;
  imageUrl?: string | null;
  imageAlt?: string;
  canonicalUrl?: string | null;
  noindex?: boolean;
  publishedTime?: string;
  structuredData?:
    | Record<string, unknown>
    | Array<Record<string, unknown>>
    | null;
}

export function SeoHead({
  title,
  description,
  path,
  locale = DEFAULT_LOCALE,
  localized = true,
  type = "website",
  imagePath = "/logo.svg",
  imageUrl,
  imageAlt,
  canonicalUrl,
  noindex = false,
  publishedTime,
  structuredData,
}: SeoHeadProps) {
  // When the page opts out of i18n (localized=false), canonical points to
  // the unprefixed URL regardless of which locale URL the visitor used —
  // so /ru/patch-notes/x and /patch-notes/x both canonicalize to the
  // unprefixed path. Localized pages canonicalize to their own locale.
  const canonical =
    canonicalUrl ?? absoluteUrl(localized ? localePath(locale, path) : path);
  const image = imageUrl ?? (imagePath ? absoluteUrl(imagePath) : null);
  const robots = noindex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large";
  const schemas = Array.isArray(structuredData)
    ? structuredData
    : structuredData
      ? [structuredData]
      : [];

  // Per Google's hreflang spec, every locale variant — including the page's
  // own — should be enumerated, plus an `x-default` pointing at the
  // unprefixed canonical so Google has a fallback for unmatched languages.
  const alternates = localized
    ? LOCALES.map((loc) => ({
        hreflang: HREFLANG[loc],
        href: absoluteUrl(localePath(loc, path)),
      })).filter((a) => Boolean(a.href))
    : [];
  const xDefault = localized ? absoluteUrl(path) : null;

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content={robots} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content={ogLocale(locale)} />
      <meta name="application-name" content={SITE_NAME} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      {canonical && <link rel="canonical" href={canonical} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {alternates.map((alt) => (
        <link
          key={alt.hreflang}
          rel="alternate"
          hrefLang={alt.hreflang}
          href={alt.href!}
        />
      ))}
      {xDefault && <link rel="alternate" hrefLang="x-default" href={xDefault} />}
      {image && <meta property="og:image" content={image} />}
      {image && <meta name="twitter:image" content={image} />}
      {image && imageAlt && <meta property="og:image:alt" content={imageAlt} />}
      {image && imageAlt && <meta name="twitter:image:alt" content={imageAlt} />}
      {publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {schemas.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </Head>
  );
}

function ogLocale(locale: Locale): string {
  switch (locale) {
    case "ru":
      return "ru_RU";
    default:
      return "en_US";
  }
}
