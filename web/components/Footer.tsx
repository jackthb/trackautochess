"use client";

import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import styles from "./Footer.module.css";

// UI chrome strings stay English across locales for now. Localized chrome
// will return through the same Sanity-driven pipeline as entity names once
// per-locale UI translations exist.
const t = {
  about: "About",
  support: "Support",
  privacy: "Privacy",
  footerAria: "Footer",
  browseHeading: "Browse",
  referenceHeading: "Reference",
  siteHeading: "Site",
  units: "Units",
  items: "Items",
  classes: "Classes",
  species: "Species",
  relics: "Relics",
  talents: "Talents",
  ranks: "Ranks",
  patchNotes: "Patch notes",
  disclaimer:
    "Not affiliated with or endorsed by Valve Corporation or Drodo Studio. Dota, Dota 2, and Dota Auto Chess are trademarks of their respective owners. Game data and assets are property of their respective owners and are used here for informational purposes only.",
};

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.columns} aria-label={t.footerAria}>
          <div className={styles.brandCol}>{SITE_NAME}</div>
          <div>
            <h3 className={styles.colHeading}>{t.browseHeading}</h3>
            <div className={styles.colLinks}>
              <Link href="/units" className={styles.link}>{t.units}</Link>
              <Link href="/items" className={styles.link}>{t.items}</Link>
              <Link href="/classes" className={styles.link}>{t.classes}</Link>
              <Link href="/species" className={styles.link}>{t.species}</Link>
              <Link href="/relics" className={styles.link}>{t.relics}</Link>
            </div>
          </div>
          <div>
            <h3 className={styles.colHeading}>{t.referenceHeading}</h3>
            <div className={styles.colLinks}>
              <Link href="/talents" className={styles.link}>{t.talents}</Link>
              <Link href="/ranks" className={styles.link}>{t.ranks}</Link>
              <Link href="/patch-notes" className={styles.link}>
                {t.patchNotes}
              </Link>
            </div>
          </div>
          <div>
            <h3 className={styles.colHeading}>{t.siteHeading}</h3>
            <div className={styles.colLinks}>
              <Link href="/about" className={styles.link}>{t.about}</Link>
              <Link href="/about#support" className={styles.link}>{t.support}</Link>
              <Link href="/privacy" className={styles.link}>{t.privacy}</Link>
            </div>
          </div>
        </nav>
      </div>
      <div className={styles.disclaimer}>{t.disclaimer}</div>
    </footer>
  );
}
