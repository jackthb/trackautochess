"use client";

import { useMemo } from "react";
import { BuildBoardPreview } from "@/app/builds/BuildBoardPreview";
import { finalSnapshotFromShareLink } from "@/lib/builds/shareLink";
import styles from "./guide.module.css";

export function GuideBuildPreview({ shareLink }: { shareLink: string }) {
  const snapshot = useMemo(() => finalSnapshotFromShareLink(shareLink), [shareLink]);
  if (!snapshot?.pieces?.length) return null;

  return (
    <div className={styles.boardSection}>
      <div className={styles.boardLabel}>
        {snapshot.label}
        {snapshot.focusNote ? (
          <span className={styles.boardFocus}> — {snapshot.focusNote}</span>
        ) : null}
      </div>
      <BuildBoardPreview snapshot={snapshot} compact showSynergies />
    </div>
  );
}
