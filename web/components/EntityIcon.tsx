import styles from "./EntityIcon.module.css";

export type EntityIconSize = "sm" | "lg";

interface EntityIconProps {
  src: string;
  alt: string;
  size?: EntityIconSize;
  bordered?: boolean;
}

export function EntityIcon({ src, alt, size = "sm", bordered = true }: EntityIconProps) {
  return (
    <img
      className={`${styles.icon} ${styles[size]}${bordered ? "" : ` ${styles.borderless}`}`}
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
