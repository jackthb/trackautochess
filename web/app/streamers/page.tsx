import type { Metadata } from "next";
import { PageLayout } from "@/components/PageLayout";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import styles from "./streamers.module.css";

const title = `Streamer Tools | ${SITE_TITLE}`;
const description =
  "Add Track Auto Chess MMR lookup commands to Twitch chatbots such as Nightbot, StreamElements, and Streamlabs.";

const endpoint = "https://www.trackautochess.com/api/twitch/mmr?steam=";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/streamers" },
  robots: "index, follow, max-image-preview:large",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/streamers",
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

function CodeBlock({ children }: { children: string }) {
  return <pre className={styles.code}>{children}</pre>;
}

export default function StreamersPage() {
  return (
    <PageLayout title="Streamer Tools" width="narrow">
      <div className={styles.stack}>
        <section className={styles.section}>
          <p className={styles.lead}>
            Add an <code>!mmr</code> command to Twitch chat so viewers can look
            up Dota Auto Chess MMR from a Steam ID64, Steam profile URL, or
            Steam vanity name.
          </p>
          <div className={styles.example}>
            <span>Chat usage</span>
            <CodeBlock>{`!mmr 76561198000000000
!mmr https://steamcommunity.com/id/someone
!mmr someone`}</CodeBlock>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Nightbot</h2>
          <CodeBlock>
            {
              "!commands add !mmr $(urlfetch https://www.trackautochess.com/api/twitch/mmr?steam=$(querystring))"
            }
          </CodeBlock>
        </section>

        <section className={styles.section}>
          <h2>StreamElements</h2>
          <CodeBlock>
            {
              "!command add !mmr $(customapi https://www.trackautochess.com/api/twitch/mmr?steam=$(queryescape $(args)))"
            }
          </CodeBlock>
        </section>

        <section className={styles.section}>
          <h2>Streamlabs</h2>
          <p>
            In Cloudbot or Streamlabs Desktop, create a custom command named{" "}
            <code>!mmr</code> and use the command argument text as the{" "}
            <code>steam</code> query value. If your Streamlabs setup has a
            dedicated read/API field, paste this URL there:
          </p>
          <CodeBlock>{`${endpoint}<command arguments>`}</CodeBlock>
          <p>
            Streamlabs command variable syntax differs between Cloudbot and
            Desktop Bot versions. The important part is that the final requested
            URL looks like:
          </p>
          <CodeBlock>
            {
              "https://www.trackautochess.com/api/twitch/mmr?steam=76561198000000000"
            }
          </CodeBlock>
        </section>

        <section className={styles.section}>
          <h2>Response Format</h2>
          <p>The endpoint returns one line of plain text for chat:</p>
          <CodeBlock>
            {
              "Player Name | Steam ID: 76561198000000000 | 2,450 MMR (Rook-7) | Profile: https://www.trackautochess.com/players/player"
            }
          </CodeBlock>
        </section>
      </div>
    </PageLayout>
  );
}
