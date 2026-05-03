import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import { EntityCard, type EntityCardVariant } from "@/components/EntityCard";
import styles from "./EntityBrowser.module.css";

export interface BrowsableEntity {
  slug: string;
  name: string;
  description?: string;
  lore?: string;
  iconSrc: string;
}

interface EntityBrowserProps {
  title: string;
  variant: EntityCardVariant;
  /**
   * Flat list (relics) or nested by tier (items). When nested, index 0
   * is tier 1, index 1 is tier 2, etc.
   */
  data: BrowsableEntity[] | BrowsableEntity[][];
  /** Formats the tier label (e.g. "Tier 1"). Only used for tiered data. */
  tierLabel?: (tier: number) => string;
  /** Returns a CSS color expression for the tier. */
  tierColor?: (tier: number) => string;
  /** Optional left-rail content (rendered desktop-only). */
  sidebarLeft?: ReactNode;
  /** Optional right-rail content (rendered desktop-only). */
  sidebarRight?: ReactNode;
  /** Optional in-content content rendered between the title block and the grid. */
  topAd?: ReactNode;
  /** Optional in-content content rendered after the grid. */
  bottomAd?: ReactNode;
}
const ENTITY_PATH: Record<EntityCardVariant, string> = {
  item: "items",
  relic: "relics",
  unit: "units",
  synergy: "synergies",
};

const ENTITY_COLLECTION_PATH: Record<EntityCardVariant, string> = {
  item: "/items",
  relic: "/relics",
  unit: "/units",
  synergy: "/synergies",
};

const ENTITY_COUNT_LABEL: Record<EntityCardVariant, string> = {
  item: "items",
  relic: "relics",
  unit: "units",
  synergy: "synergies",
};

function isTiered(
  data: BrowsableEntity[] | BrowsableEntity[][]
): data is BrowsableEntity[][] {
  return data.length > 0 && Array.isArray(data[0]);
}

function matches(entity: BrowsableEntity, lowered: string): boolean {
  if (!lowered) return true;
  return (
    entity.name.toLowerCase().includes(lowered) ||
    (entity.description?.toLowerCase().includes(lowered) ?? false) ||
    (entity.lore?.toLowerCase().includes(lowered) ?? false)
  );
}

export function EntityBrowser({
  title,
  variant,
  data,
  tierLabel,
  tierColor,
  sidebarLeft,
  sidebarRight,
  topAd,
  bottomAd,
}: EntityBrowserProps) {
  const hasSidebar = Boolean(sidebarLeft || sidebarRight);
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const search = router.query.q;
    if (typeof search === "string") setQuery(search);
  }, [router.query.q]);

  const lowered = query.toLowerCase();

  const filteredTiered = useMemo(() => {
    if (!isTiered(data)) return null;
    return data.map((tier) => tier.filter((e) => matches(e, lowered)));
  }, [data, lowered]);

  const filteredFlat = useMemo(() => {
    if (isTiered(data)) return null;
    return data.filter((e) => matches(e, lowered));
  }, [data, lowered]);

  const gridClass = `${styles.grid} ${
    variant === "relic" || variant === "synergy"
      ? styles.gridRelic
      : styles.gridItem
  }`;
  const placeholder = `Search ${ENTITY_COUNT_LABEL[variant]}...`;
  const collectionPath = ENTITY_COLLECTION_PATH[variant];
  const total = filteredTiered
    ? filteredTiered.reduce((sum, tier) => sum + tier.length, 0)
    : filteredFlat?.length ?? 0;

  return (
    <div className={styles.page}>
      <div className={hasSidebar ? styles.layoutWithSidebar : styles.layout}>
        {hasSidebar && (
          <aside className={styles.sidebarLeft}>{sidebarLeft}</aside>
        )}
        <div className={styles.container}>
          <h1 className={styles.pageTitle}>{title}</h1>
        <input
          className={styles.search}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={styles.total}>
          {total} {ENTITY_COUNT_LABEL[variant]}
        </div>

        {topAd && <div className={styles.topAd}>{topAd}</div>}

        {filteredTiered &&
          filteredTiered
            .map((entities, index) => ({ entities, tier: index + 1 }))
            .filter(({ entities }) => entities.length > 0)
            .map(({ entities, tier }) => {
              const color = tierColor?.(tier);
              return (
                <section key={tier} className={styles.panel}>
                  {tierLabel && (
                    <div className={styles.panelHeader} style={{ color }}>
                      <span>{tierLabel(tier)}</span>
                      <span className={styles.count}>{entities.length}</span>
                    </div>
                  )}
                  <div className={gridClass}>
                    {entities.map((entity) => (
                      <EntityCard
                        key={entity.slug}
                        href={`${collectionPath}/${entity.slug}`}
                        iconSrc={entity.iconSrc}
                        iconAlt={entity.name}
                        name={entity.name}
                        description={entity.description}

                        variant={variant}
                        accentColor={color}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

        {filteredFlat && (
          <section className={styles.panel}>
            {filteredFlat.length === 0 ? (
              <div className={styles.empty}>No matches.</div>
            ) : (
              <div className={gridClass}>
                {filteredFlat.map((entity) => (
                  <EntityCard
                    key={entity.slug}
                    href={`${collectionPath}/${entity.slug}`}
                    iconSrc={entity.iconSrc}
                    iconAlt={entity.name}
                    name={entity.name}
                    description={entity.description}
                    variant={variant}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {bottomAd && <div className={styles.topAd}>{bottomAd}</div>}
        </div>
        {hasSidebar && (
          <aside className={styles.sidebarRight}>{sidebarRight}</aside>
        )}
      </div>
    </div>
  );
}
