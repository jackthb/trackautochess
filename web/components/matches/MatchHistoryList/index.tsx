"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame, RelicInfo, UnitFullInfo, SynergyInfo } from "@dac/shared/types";
import { relicsData as relicsJson } from "@/generated/content-data";
import { UNIT_COSTS } from "@/lib/units";
import { resolveIconUrl } from "@/lib/icons";
import styles from "./MatchHistoryList.module.css";

const RELICS_MAP = (relicsJson as { relics?: Record<string, RelicInfo> }).relics ?? {};

interface MatchHistoryListProps {
  games: PlayerGame[];
  unitsFull?: Record<string, UnitFullInfo>;
  synergiesData?: Record<string, SynergyInfo>;
  relicsData?: Record<string, RelicInfo>;
  getHref?: (game: PlayerGame) => string;
  getDateExtra?: (game: PlayerGame) => ReactNode;
}

export function MatchHistoryList({
  games,
  unitsFull,
  synergiesData,
  relicsData = RELICS_MAP,
  getHref = (game) => `/matches/${game.id}`,
  getDateExtra,
}: MatchHistoryListProps) {
  const router = useRouter();

  if (games.length === 0) return null;

  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableHeader}>
        <div className={styles.th}>#</div>
        <div className={styles.th}>Lineup</div>
        <div className={styles.th}>Rank</div>
        <div className={styles.th}>W &ndash; L</div>
        <div className={styles.th}>Lv</div>
        <div className={styles.th}>Relic</div>
        <div className={styles.th}>Date</div>
      </div>
      {games.map((game) => {
        const href = getHref(game);
        const dateExtra = getDateExtra?.(game);
        return (
          <div key={game.id} className={styles.gameEntry}>
            <div
              className={styles.gameRowLink}
              role="link"
              tabIndex={0}
              onClick={() => router.push(href)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(href);
                }
              }}
            >
              <GameRowDisplay
                game={game}
                unitCosts={UNIT_COSTS}
                unitsFull={unitsFull}
                synergiesData={synergiesData}
                relicsData={relicsData}
                iconUrl={resolveIconUrl}
                shareUrl={href}
                dateExtra={dateExtra ? <div className={styles.dateExtra}>{dateExtra}</div> : undefined}
                style={{ cursor: "pointer" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
