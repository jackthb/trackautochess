import Head from "next/head";
import { absoluteUrl, SITE_NAME } from "@/lib/site";

interface SeoHeadProps {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  imagePath?: string;
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
  type = "website",
  imagePath = "/logo.svg",
  noindex = false,
  publishedTime,
  structuredData,
}: SeoHeadProps) {
  const canonical = absoluteUrl(path);
  const image = imagePath ? absoluteUrl(imagePath) : null;
  const robots = noindex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large";
  const schemas = Array.isArray(structuredData)
    ? structuredData
    : structuredData
      ? [structuredData]
      : [];

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
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      {canonical && <link rel="canonical" href={canonical} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {image && <meta property="og:image" content={image} />}
      {image && <meta name="twitter:image" content={image} />}
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
