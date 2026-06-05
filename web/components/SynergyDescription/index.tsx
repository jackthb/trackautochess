import { parseSynergyDescription } from "@/lib/synergyDescription";
import styles from "./SynergyDescription.module.css";

interface SynergyDescriptionProps {
  description: string;
}

/**
 * Render a synergy description with the perk header, intro, activation
 * rule and tier breakpoints in a fixed visual order, regardless of where
 * the source VPK text happens to put them. Tier rows show the "(N)" as a
 * styled chip instead of inline parenthetical text.
 */
export function SynergyDescription({ description }: SynergyDescriptionProps) {
  const parts = parseSynergyDescription(description);

  // Nothing parsed cleanly — fall back to the raw text so we never blank
  // out a description we don't recognise.
  if (!parts.perkLabel && parts.tiers.length === 0) {
    return <div className={styles.fallback}>{description}</div>;
  }

  return (
    <div className={styles.root}>
      {parts.perkLabel && parts.perkName && (
        <div className={styles.perk}>
          <span className={styles.perkLabel}>{parts.perkLabel}</span>
          <span className={styles.perkName}>{parts.perkName}</span>
        </div>
      )}
      {parts.intro && <p className={styles.intro}>{parts.intro}</p>}
      {parts.activation && (
        <p className={styles.activation}>{parts.activation}</p>
      )}
      {parts.tiers.length > 0 && (
        <ul className={styles.tiers}>
          {parts.tiers.map((tier) => (
            <li key={tier.count} className={styles.tier}>
              <span className={styles.tierCount}>{tier.count}</span>
              <span className={styles.tierBody}>{tier.text}</span>
            </li>
          ))}
        </ul>
      )}
      {parts.trailing && <p className={styles.trailing}>{parts.trailing}</p>}
    </div>
  );
}
