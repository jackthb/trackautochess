import Link from "next/link";
import { EntityCard, type EntityCardVariant } from "@/components/EntityCard";
import { EntityIcon } from "@/components/EntityIcon";
import styles from "./EntityDetail.module.css";

export interface RelatedEntity {
  slug: string;
  name: string;
  description?: string;
  iconSrc: string;
}

interface EntityDetailProps {
  variant: EntityCardVariant;
  name: string;
  iconSrc: string;
  lede?: string;
  /** Body copy for the "Overview" section. */
  overview?: string;
  /** Optional bullet list (items). */
  notes?: string[];
  /** Flavor lore. */
  lore?: string;
  /** Small chip rendered below the title (e.g. tier label). */
  tag?: { label: string; color?: string };
  /** "More X" section. */
  relatedTitle: string;
  related: RelatedEntity[];
  /** Accent color passed through to hover states (defaults by variant). */
  accentColor?: string;
  /** Individual accent per related card (e.g. tier color). */
  relatedAccentColor?: (item: RelatedEntity) => string | undefined;
  /** Level badge for related cards. */
  relatedLevel?: (item: RelatedEntity) => string | number | undefined;
}

const INDEX_LABEL: Record<EntityCardVariant, string> = {
  item: "Items",
  relic: "Relics",
};

const OVERVIEW_LABEL: Record<EntityCardVariant, string> = {
  item: "Item Overview",
  relic: "Relic Overview",
};

export function EntityDetail({
  variant,
  name,
  iconSrc,
  lede,
  overview,
  notes,
  lore,
  tag,
  relatedTitle,
  related,
  accentColor,
  relatedAccentColor,
  relatedLevel,
}: EntityDetailProps) {
  const titleClass = `${styles.title} ${
    variant === "relic" ? styles.titleRelic : styles.titleItem
  }`;
  const indexPath = `/${variant}s`;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href={indexPath}>{INDEX_LABEL[variant]}</Link>
          <span>/</span>
          <span>{name}</span>
        </nav>

        <section className={styles.hero}>
          <EntityIcon src={iconSrc} alt={name} size="lg" />
          <div>
            <h1 className={titleClass}>{name}</h1>
            {tag && (
              <div className={styles.tier} style={{ color: tag.color }}>
                {tag.label}
              </div>
            )}
            {lede && <div className={styles.lede}>{lede}</div>}
          </div>
        </section>

        {overview && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{OVERVIEW_LABEL[variant]}</h2>
            <div className={styles.bodyCopy}>{overview}</div>
          </section>
        )}

        {notes && notes.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Notes</h2>
            <ul className={styles.notes}>
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </section>
        )}

        {lore && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Lore</h2>
            <div className={styles.bodyCopy}>{lore}</div>
          </section>
        )}

        {related.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{relatedTitle}</h2>
            <div className={styles.relatedGrid}>
              {related.map((r) => (
                <EntityCard
                  key={r.slug}
                  href={`/${variant}s/${r.slug}`}
                  iconSrc={r.iconSrc}
                  iconAlt={r.name}
                  name={r.name}
                  description={r.description}
                  variant={variant}
                  accentColor={relatedAccentColor?.(r) ?? accentColor}
                  level={relatedLevel?.(r)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
