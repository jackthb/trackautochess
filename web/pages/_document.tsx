import {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentProps,
} from "next/document";
import { HTML_LANG, isLocale, DEFAULT_LOCALE } from "@/lib/i18n";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function Document(props: DocumentProps) {
  // `__NEXT_DATA__.locale` reflects the active i18n locale on every
  // request — even on the default locale, where Next sets it to `en` (no
  // URL prefix). Falls back if locale routing is somehow disabled.
  const raw = props.__NEXT_DATA__?.locale;
  const htmlLang = isLocale(raw) ? HTML_LANG[raw] : HTML_LANG[DEFAULT_LOCALE];
  return (
    <Html lang={htmlLang}>
      <Head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        {SUPABASE_URL && (
          <link rel="preconnect" href={SUPABASE_URL} crossOrigin="anonymous" />
        )}
        <link rel="preconnect" href="https://cdn.sanity.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://avatars.steamstatic.com" crossOrigin="anonymous" />
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
        <meta
          name="google-site-verification"
          content="Hy5rhjnwS0LRzaYhqAA8Cj3M2Jb1Na2jApcH1lwhvuo"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
