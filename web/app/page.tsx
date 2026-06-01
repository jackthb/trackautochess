import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import HomeSearch from "@/components/home/HomeSearch";
import {
  getDefaultPlayerSearchResults,
  type SearchResult,
} from "@/lib/playerSearch";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

// App Router migration of pages/index.tsx (home). ISR (revalidate 300) like the
// old getStaticProps; the interactive search UI is the HomeSearch client island.

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

async function getInitialSearchResults(): Promise<SearchResult[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    return await getDefaultPlayerSearchResults(supabase);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const initialSearchResults = await getInitialSearchResults();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeSearch initialSearchResults={initialSearchResults} />
    </>
  );
}
