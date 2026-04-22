import styles from "./EntityIcon.module.css";

export type EntityIconSize = "sm" | "lg";

interface EntityIconProps {
  src: string;
  alt: string;
  size?: EntityIconSize;
}

// Matches EntityIcon.module.css sizes. Set as width/height HTML
// attributes so the browser reserves correct aspect ratio space
// before the image decodes, preventing layout shift on refresh.
const DIMENSIONS: Record<EntityIconSize, { w: number; h: number }> = {
  sm: { w: 88, h: 64 },
  lg: { w: 132, h: 96 },
};

export function EntityIcon({ src, alt, size = "sm" }: EntityIconProps) {
  const { w, h } = DIMENSIONS[size];
  return (
    <img
      className={`${styles.icon} ${styles[size]}`}
      src={src}
      alt={alt}
      width={w}
      height={h}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
