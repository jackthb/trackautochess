import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/PageLayout";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";
import {
  loadCreatorLiveStreams,
  loadCreatorUploads,
  type CreatorLiveStream,
  type CreatorPlatform,
  type CreatorUpload,
} from "@/lib/creators";
import styles from "./creators.module.css";

const title = `Creators | ${SITE_TITLE}`;
const description =
  "Find live Dota Auto Chess creators and the latest community uploads in one Track Auto Chess feed.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/creators" },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: SITE_NAME,
    url: "/creators",
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

export const revalidate = 900;

const platformLabels: Record<CreatorPlatform, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  douyu: "Douyu",
  website: "Stream",
};

function formatDate(value: string | null): string {
  if (!value) return "Recent upload";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent upload";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function youtubeEmbedUrl(videoUrl: string): string | null {
  try {
    const parsed = new URL(videoUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const videoId =
      hostname === "youtu.be"
        ? parsed.pathname.split("/").filter(Boolean)[0]
        : hostname.endsWith("youtube.com")
          ? parsed.searchParams.get("v")
          : null;

    return videoId
      ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`
      : null;
  } catch {
    return null;
  }
}

function StreamCard({ stream }: { stream: CreatorLiveStream }) {
  const initial = stream.name.trim().charAt(0) || "?";
  const displayUrl = stream.url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .split("/")
    .filter(Boolean)
    .pop() ?? stream.url;
  return (
    <article className={styles.streamCard}>
      {stream.avatarUrl ? (
        <img
          className={styles.avatar}
          src={stream.avatarUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className={styles.avatarFallback} aria-hidden="true">
          {initial}
        </div>
      )}
      <div className={styles.streamBody}>
        <div className={styles.streamTopline}>
          <span className={styles.platform}>
            {platformLabels[stream.platform]}
          </span>
          <span className={styles.source}>Live now</span>
        </div>
        <h3 className={styles.creatorName}>{stream.name}</h3>
        <div className={styles.streamUrl} title={stream.url}>
          {displayUrl}
        </div>
        {stream.title && <p className={styles.liveTitle}>{stream.title}</p>}
        {stream.description && (
          <p className={styles.creatorDescription}>{stream.description}</p>
        )}
        <div className={styles.streamActions}>
          <a
            className={styles.actionButton}
            href={stream.url}
            target="_blank"
            rel="noopener noreferrer"
            title={stream.url}
          >
            Go to Stream
          </a>
          {stream.profilePath && (
            <Link
              className={styles.actionButtonSecondary}
              href={stream.profilePath}
              prefetch={false}
            >
              Player Page
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function UploadCard({ upload }: { upload: CreatorUpload }) {
  return (
    <a
      className={styles.uploadCard}
      href={upload.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {upload.thumbnailUrl ? (
        <img
          className={styles.thumbnail}
          src={upload.thumbnailUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className={styles.thumbnailFallback} aria-hidden="true">
          DAC
        </div>
      )}
      <div className={styles.uploadBody}>
        <div className={styles.uploadMeta}>
          <span>{upload.creatorName}</span>
          <span>{formatDate(upload.publishedAt)}</span>
        </div>
        <h3 className={styles.uploadTitle}>{upload.title}</h3>
      </div>
    </a>
  );
}

export default async function CreatorsPage() {
  const [{ streams, error }, creatorMedia] = await Promise.all([
    loadCreatorLiveStreams(),
    loadCreatorUploads(),
  ]);
  const { uploads, liveStreams } = creatorMedia;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Dota Auto Chess creators",
    description,
    hasPart: uploads.slice(0, 10).map((upload) => {
      const embedUrl = youtubeEmbedUrl(upload.url);

      return {
        "@type": "VideoObject",
        name: upload.title,
        description: `${upload.title} by ${upload.creatorName}, featured in the Track Auto Chess creators feed.`,
        url: upload.url,
        ...(embedUrl ? { embedUrl } : { contentUrl: upload.url }),
        uploadDate: upload.publishedAt ?? undefined,
        thumbnailUrl: upload.thumbnailUrl ?? undefined,
        author: { "@type": "Person", name: upload.creatorName },
      };
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <PageLayout title="Creators">
        <p className={styles.lead}>
          A community hub for Auto Chess creators. This page only shows creators
          that are detected as live right now, plus the most recent Dota Auto
          Chess uploads from configured YouTube channels.{" "}
          <Link href="/support" prefetch={false}>
            Use the support form
          </Link>{" "}
          to suggest another creator.
        </p>
        {error && <p className={styles.notice}>{error}</p>}

        <section
          className={styles.section}
          aria-labelledby="live-streams-heading"
        >
          <div className={styles.sectionHeader}>
            <h2 id="live-streams-heading" className={styles.sectionTitle}>
              Live creators
            </h2>
            <span className={styles.sectionKicker}>
              {streams.length} live now
            </span>
          </div>
          {streams.length > 0 ? (
            <div className={styles.streamGrid}>
              {streams.map((stream) => (
                <StreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              No configured creators appear to be live right now. Add or edit
              creator stream URLs in the CMS to include more channels here.
            </div>
          )}
        </section>

        {liveStreams.length > 0 && (
          <section
            className={styles.section}
            aria-labelledby="youtube-live-streams-heading"
          >
            <div className={styles.sectionHeader}>
              <h2
                id="youtube-live-streams-heading"
                className={styles.sectionTitle}
              >
                Recent YouTube live streams
              </h2>
              <span className={styles.sectionKicker}>
                Latest per creator
              </span>
            </div>
            <div className={styles.uploadGrid}>
              {liveStreams.map((upload) => (
                <UploadCard key={upload.id} upload={upload} />
              ))}
            </div>
          </section>
        )}

        <section
          className={styles.section}
          aria-labelledby="recent-uploads-heading"
        >
          <div className={styles.sectionHeader}>
            <h2 id="recent-uploads-heading" className={styles.sectionTitle}>
              Recent uploads
            </h2>
          </div>
          {uploads.length > 0 ? (
            <div className={styles.uploadGrid}>
              {uploads.map((upload) => (
                <UploadCard key={upload.id} upload={upload} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              No matching Dota Auto Chess YouTube uploads were found. Add
              creator YouTube channel IDs, handles, playlists, or search terms
              in the CMS to tune this feed.
            </div>
          )}
        </section>
      </PageLayout>
    </>
  );
}
