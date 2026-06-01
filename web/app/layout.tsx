import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import { getSiteUrl, DEFAULT_SITE_URL } from "@/lib/site";
import StyledJsxRegistry from "./StyledJsxRegistry";
import { AppChrome } from "@/components/app/AppChrome";

// Root layout for App Router routes (pilot). Pages Router routes keep using
// _app.tsx / _document.tsx; this mirrors the parts of _document's <head> and
// _app's chrome that App Router pages need. See app/privacy/page.tsx.

const siteUrl = getSiteUrl() ?? DEFAULT_SITE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  icons: { icon: [{ url: "/logo.svg", type: "image/svg+xml" }] },
  verification: { google: "Hy5rhjnwS0LRzaYhqAA8Cj3M2Jb1Na2jApcH1lwhvuo" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {supabaseUrl && (
          <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />
        )}
        <link
          rel="preconnect"
          href="https://cdn.sanity.io"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://avatars.steamstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/JetBrainsMono-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Cinzel-Bold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <StyledJsxRegistry>
          <AppChrome>{children}</AppChrome>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
