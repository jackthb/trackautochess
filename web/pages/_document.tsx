import {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentProps,
} from "next/document";
import { HTML_LANG, isLocale, DEFAULT_LOCALE } from "@/lib/i18n";

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
        <link
          rel="preload"
          href="/fonts/JetBrainsMono-Regular.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Cinzel-Bold.woff"
          as="font"
          type="font/woff"
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
