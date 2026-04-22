import { Html, Head, Main, NextScript } from "next/document";
import { getSiteUrl } from "@/lib/site";

export default function Document() {
  const plausibleScriptSrc =
    process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_SRC ||
    "https://plausible.io/js/script.js";
  const plausibleDomain =
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ||
    (() => {
      const siteUrl = getSiteUrl();
      if (!siteUrl) return null;

      try {
        return new URL(siteUrl).host;
      } catch {
        return null;
      }
    })();

  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        {plausibleDomain && (
          <script
            defer
            data-domain={plausibleDomain}
            src={plausibleScriptSrc}
          />
        )}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
