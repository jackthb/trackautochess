import type { Metadata } from "next";
import { pageMetadata, SITE_TITLE } from "@/lib/site";
import { AboutContent } from "./AboutContent";

const title = `About | ${SITE_TITLE}`;
const description =
  "How Track Auto Chess surfaces Dota Auto Chess player statistics from Drodo profile data and manually tracked match history.";

export const metadata: Metadata = pageMetadata({
  title,
  description,
  path: "/about",
});

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
