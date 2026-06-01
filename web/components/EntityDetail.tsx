import type { ReactNode } from "react";
import Link from "next/link";
import { EntityCard, type EntityCardVariant } from "@/components/EntityCard";
import { EntityIcon } from "@/components/EntityIcon";
import styles from "./EntityDetail.module.css";

const t = {
  home: "Home",
  breadcrumb: "Breadcrumb",
  notes: "Notes",
  lore: "Lore",
  commentary: "Commentary",
  index: { item: "Items", relic: "Relics", unit: "Units", synergy: "Synergies" } as Record<EntityCardVariant, string>,
  overview: {
    item: "Item Overview",
    relic: "Relic Overview",
    unit: "Unit Overview",
    synergy: "Synergy Overview",
  } as Record<EntityCardVariant, string>,
};

export interface RelatedEntity {
  slug: string;
  name: string;
  description?: string;
  iconSrc: string;
  variant?: EntityCardVariant;
  level?: string | number;
  accentColor?: string;
}

export interface BodySection {
  title: string;
  body: ReactNode;
}

interface EntityDetailProps {
  variant: EntityCardVariant;
  name: string;
  iconSrc: string;
  /** Body copy for the "Overview" section. ReactNode so callers can
   *  embed contextual links with natural anchor text for SEO. */
  overview?: ReactNode;
  /** Optional list of body sections rendered in order between the hero
   *  and the notes/lore. When provided, `overview` is ignored; callers
   *  who need both should include the overview as the first entry. */
  bodySections?: BodySection[];
  /** Optional bullet list (items). */
  notes?: string[];
  /** Editorial commentary tied to this entity (e.g. patch-note analysis).
   *  Rendered in its own "Commentary" section above notes/lore. */
  commentary?: ReactNode;
  /** Flavor lore. */
  lore?: string;
  /** Small chip rendered below the title (e.g. tier label). */
  tag?: { label: string; color?: string };
  /** Color applied to the hero title text. When set, overrides the
   *  variant default (e.g. tier color on item pages). */
  titleColor?: string;
  /** "More X" section. */
  relatedTitle: string;
  related: RelatedEntity[];
  /** Accent color passed through to hover states (defaults by variant). */
  accentColor?: string;
  /** Individual accent per related card (e.g. tier color). */
  relatedAccentColor?: (item: RelatedEntity) => string | undefined;
  /** Level badge for related cards. */
  relatedLevel?: (item: RelatedEntity) => string | number | undefined;
  extraRelatedTitle?: string;
  extraRelated?: RelatedEntity[];
  /** Override the breadcrumb label for the index page. Defaults by variant. */
  indexLabel?: string;
  /** Override the breadcrumb path for the index page. Defaults by variant. */
  indexPath?: string;
}

const ENTITY_COLLECTION_PATH: Record<EntityCardVariant, string> = {
  item: "/items",
  relic: "/relics",
  unit: "/units",
  synergy: "/synergies",
};

export function EntityDetail({
  variant,
  name,
  iconSrc,
  overview,
  bodySections,
  notes,
  commentary,
  lore,
  tag,
  titleColor,
  relatedTitle,
  related,
  accentColor,
  relatedAccentColor,
  relatedLevel,
  extraRelatedTitle,
  extraRelated,
  indexLabel,
  indexPath,
}: EntityDetailProps) {
  const titleClass = `${styles.title} ${
    variant === "relic"
      ? styles.titleRelic
      : variant === "synergy"
        ? styles.titleSynergy
        : variant === "item"
          ? styles.titleItem
          : styles.titleUnit
  }`;
  const resolvedIndexPath = indexPath ?? ENTITY_COLLECTION_PATH[variant];
  const resolvedIndexLabel = indexLabel ?? t.index[variant];
  const sections: BodySection[] = bodySections ?? (
    overview ? [{ title: t.overview[variant], body: overview }] : []
  );

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.breadcrumbs} aria-label={t.breadcrumb}>
          <Link href="/">{t.home}</Link>
          <span>/</span>
          <Link href={resolvedIndexPath}>{resolvedIndexLabel}</Link>
          <span>/</span>
          <span>{name}</span>
        </nav>

        <section className={styles.hero}>
          <EntityIcon src={iconSrc} alt={name} size="lg" bordered={variant !== "unit"} crop={variant === "item"} />
          <div>
            <h1 className={titleClass} style={titleColor ? { color: titleColor } : undefined}>
              {name}
            </h1>
            {tag && (
              <div className={styles.tier} style={{ color: tag.color }}>
                {tag.label}
              </div>
            )}
          </div>
        </section>

        {sections.map((s, i) => (
          <section key={i} className={styles.section}>
            <h2 className={styles.sectionTitle}>{s.title}</h2>
            <div className={styles.bodyCopy}>{s.body}</div>
          </section>
        ))}

        {commentary && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t.commentary}</h2>
            <div className={styles.bodyCopy}>{commentary}</div>
          </section>
        )}

        {notes && notes.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t.notes}</h2>
            <ul className={styles.notes}>
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </section>
        )}

        {lore && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t.lore}</h2>
            <div className={styles.bodyCopy}>{lore}</div>
          </section>
        )}

        {related.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{relatedTitle}</h2>
            <div className={styles.relatedGrid}>
              {related.map((r) => {
                const cardVariant = r.variant ?? variant;
                return (
                  <EntityCard
                    key={`${cardVariant}-${r.slug}`}
                    href={`${ENTITY_COLLECTION_PATH[cardVariant]}/${r.slug}`}
                    iconSrc={r.iconSrc}
                    iconAlt={r.name}
                    name={r.name}
                    description={r.description}
                    variant={cardVariant}
                    accentColor={relatedAccentColor?.(r) ?? r.accentColor ?? accentColor}
                    level={relatedLevel?.(r) ?? r.level}
                  />
                );
              })}
            </div>
          </section>
        )}

        {extraRelated && extraRelated.length > 0 && extraRelatedTitle && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{extraRelatedTitle}</h2>
            <div className={styles.relatedGrid}>
              {extraRelated.map((r) => {
                const cardVariant = r.variant ?? variant;
                return (
                  <EntityCard
                    key={`${cardVariant}-${r.slug}`}
                    href={`${ENTITY_COLLECTION_PATH[cardVariant]}/${r.slug}`}
                    iconSrc={r.iconSrc}
                    iconAlt={r.name}
                    name={r.name}
                    description={r.description}
                    variant={cardVariant}
                    accentColor={relatedAccentColor?.(r) ?? r.accentColor ?? accentColor}
                    level={relatedLevel?.(r) ?? r.level}
                  />
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
