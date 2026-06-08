import type { Metadata } from "next";
import HomeSearch from "@/components/home/HomeSearch";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

export const revalidate = 300;

const description =
  "Look up Dota Auto Chess player MMR, season history, and tracked match stats by Steam vanity URL or Steam ID.";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description,
  alternates: { canonical: "/" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title: SITE_TITLE,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    locale: "en_US",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description,
    images: ["/logo.svg"],
  },
};

const siteUrl = absoluteUrl("/");
const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    ...(siteUrl ? { url: siteUrl } : {}),
    ...(siteUrl
      ? {
          potentialAction: {
            "@type": "SearchAction",
            target: `${siteUrl}/players/{search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        }
      : {}),
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    ...(siteUrl ? { url: siteUrl } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
];

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeSearch />
    </>
  );
}
