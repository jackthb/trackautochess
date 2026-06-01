import type { Metadata } from "next";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import { AboutContent } from "./AboutContent";

// App Router migration of pages/about.tsx. The page is a Server Component that
// owns metadata + the AboutPage JSON-LD, and renders a "use client" island
// (AboutContent) holding the support-form state and submit logic.

const title = `About | ${SITE_TITLE}`;
const description =
  "How Tracker Autochess surfaces Dota Auto Chess player statistics from Drodo profile data and manually tracked match history.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/about" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/about",
    locale: "en_US",
    images: ["/logo.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/logo.svg"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About Track Auto Chess",
  description,
};

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <AboutContent />
    </>
  );
}
