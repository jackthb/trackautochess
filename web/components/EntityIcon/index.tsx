"use client";

import styles from "./EntityIcon.module.css";

export type EntityIconSize = "sm" | "lg";

interface EntityIconProps {
  src: string;
  alt: string;
  size?: EntityIconSize;
  bordered?: boolean;
  className?: string;
}

export function EntityIcon({ src, alt, size = "sm", bordered = true, className }: EntityIconProps) {
  return (
    <img
      className={`${styles.icon} ${styles[size]}${bordered ? "" : ` ${styles.borderless}`}${className ? ` ${className}` : ""}`}
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
