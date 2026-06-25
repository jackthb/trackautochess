import type { ReactNode } from "react";
import styles from "./PageLayout.module.css";

interface PageLayoutProps {
  title?: string;
  children: ReactNode;
}

/**
 * Shared page chrome for top-level routes (talents, ranks, leaderboard,
 * matches). Provides the same max-width + padding as the EntityBrowser
 * pages (units, classes, species, items, relics) so the site reads as one
 * consistent layout instead of each page picking its own gutter.
 */
export function PageLayout({ title, children }: PageLayoutProps) {
  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <div className={styles.container}>
          {title && <h1 className={styles.pageTitle}>{title}</h1>}
          {children}
        </div>
      </div>
    </div>
  );
}
