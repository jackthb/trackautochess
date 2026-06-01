import styles from "./EntityIcon.module.css";

export type EntityIconSize = "sm" | "lg";

interface EntityIconProps {
  src: string;
  alt: string;
  size?: EntityIconSize;
  bordered?: boolean;
  /** Frame the icon to the standard item aspect ratio (center-crop via
   *  object-fit: cover). Use for item icons, whose sources are mixed aspect
   *  (Dota econ icons are rectangular; custom Auto Chess items ship a square
   *  spellicon). No-op visually for icons already at that ratio. */
  crop?: boolean;
}

export function EntityIcon({ src, alt, size = "sm", bordered = true, crop = false }: EntityIconProps) {
  return (
    <img
      className={`${styles.icon} ${styles[size]}${bordered ? "" : ` ${styles.borderless}`}${crop ? ` ${styles.crop}` : ""}`}
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
