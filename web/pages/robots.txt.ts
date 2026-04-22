import type { GetServerSideProps } from "next";
import { getRequestSiteUrl } from "@/lib/site";

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const siteUrl = getRequestSiteUrl(req.headers);
  const sitemapUrl = siteUrl ? `${siteUrl}/sitemap.xml` : "/sitemap.xml";
  const robots = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /dashboard",
    `Sitemap: ${sitemapUrl}`,
  ].join("\n");

  res.setHeader("Content-Type", "text/plain");
  res.write(robots);
  res.end();

  return { props: {} };
};

export default function RobotsTxt() {
  return null;
}
