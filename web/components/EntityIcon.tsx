import styles from "./EntityIcon.module.css";

export type EntityIconSize = "sm" | "lg";

interface EntityIconProps {
  src: string;
  alt: string;
  size?: EntityIconSize;
}

export function EntityIcon({ src, alt, size = "sm" }: EntityIconProps) {
  return (
    <img
      className={`${styles.icon} ${styles[size]}`}
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
