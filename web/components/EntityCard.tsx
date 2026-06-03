import type { CSSProperties } from "react";
import Link from "next/link";
import { EntityIcon } from "@/components/EntityIcon";
import styles from "./EntityCard.module.css";

export type EntityCardVariant = "item" | "relic" | "unit" | "synergy";

interface EntityCardProps {
  href: string;
  iconSrc: string;
  iconAlt: string;
  name: string;
  description?: string;
  variant: EntityCardVariant;
  /** Small label rendered in the top-right corner (e.g. tier). */
  level?: string | number;
  /** Hover border/glow color. Defaults by variant. */
  accentColor?: string;
  onClick?: () => void;
}

const DEFAULT_ACCENT: Record<EntityCardVariant, string> = {
  item: "var(--accent)",
  relic: "var(--gold)",
  unit: "var(--accent)",
  synergy: "#8bbf9f",
};

export function EntityCard({
  href,
  iconSrc,
  iconAlt,
  name,
  description,
  variant,
  level,
  accentColor,
  onClick,
}: EntityCardProps) {
  const accent = accentColor ?? DEFAULT_ACCENT[variant];

  return (
    <Link
      href={href}
      className={`${styles.card} ${styles[variant]}`}
      style={{ "--card-accent": accent } as CSSProperties}
      onClick={onClick}
    >
      <EntityIcon src={iconSrc} alt={iconAlt} size="sm" bordered={variant !== "unit"} />
      <div className={styles.body}>
        <div className={styles.name}>{name}</div>
        {description !== undefined && (
          <div className={styles.desc}>{description || "-"}</div>
        )}
      </div>
      {level !== undefined && (
        <div className={styles.level}>{level}</div>
      )}
    </Link>
  );
}
