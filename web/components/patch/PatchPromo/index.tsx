import Link from "next/link";
import {
  formatHighlightText,
  getLatestPatchPromo,
  getPatchPromo,
  type PatchPromoData,
} from "@/lib/latestPatch";
import { KIND_COLOR, KIND_LABEL } from "@/lib/patchKinds";
import styles from "./PatchPromo.module.css";

function formatPatchDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function PatchPromo({
  variant = "featured",
  slug,
  patch,
}: {
  variant?: "compact" | "featured";
  slug?: string;
  patch?: PatchPromoData | null;
}) {
  const promo = patch ?? (slug ? getPatchPromo(slug) : getLatestPatchPromo());
  if (!promo) return null;

  const isCompact = variant === "compact";
  const { highlight } = promo;
  const highlightText = formatHighlightText(highlight);

  return (
    <section
      className={`${styles.wrap} ${isCompact ? styles.wrapCompact : styles.wrapFeatured}`}
      aria-label="Latest patch notes"
    >
      <Link
        href={`/patch-notes/${promo.slug}`}
        className={`${styles.card} ${isCompact ? styles.cardCompact : styles.cardFeatured}`}
      >
        {promo.image && (
          <div
            className={`${styles.imageWrap} ${isCompact ? styles.imageWrapCompact : styles.imageWrapFeatured}`}
          >
            <img
              className={styles.image}
              src={promo.image}
              alt=""
              loading="eager"
            />
            <div className={styles.imageOverlay} aria-hidden />
          </div>
        )}

        <div
          className={`${styles.body} ${isCompact ? styles.bodyCompact : styles.bodyFeatured}`}
        >
          <div className={styles.meta}>
            <span className={styles.tag}>New patch</span>
            {!isCompact && (
              <span className={styles.date}>{formatPatchDate(promo.date)}</span>
            )}
            {isCompact && (
              <span className={styles.titleCompactInline}>{promo.title}</span>
            )}
          </div>

          {!isCompact && (
            <h2 className={styles.titleFeatured}>{promo.title}</h2>
          )}

          <p className={styles.highlightLine}>
            <span
              className={styles.kind}
              style={{ color: KIND_COLOR[highlight.kind] }}
            >
              {KIND_LABEL[highlight.kind]}
            </span>
            <span className={styles.change}>{highlightText}</span>
            {isCompact && (
              <span className={styles.compactArrow} aria-hidden>
                &rarr;
              </span>
            )}
          </p>

          <span className={styles.cta}>
            Read patch notes
            <span className={styles.ctaArrow} aria-hidden>
              &rarr;
            </span>
          </span>
        </div>
      </Link>
    </section>
  );
}
