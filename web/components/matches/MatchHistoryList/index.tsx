"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import type { PlayerGame, RelicInfo, UnitFullInfo, SynergyInfo } from "@dac/shared/types";
import {
  synergiesData as synergiesJson,
  unitsFullData,
} from "@/generated/content-data";
import { ITEM_SYNERGIES, UNIT_COSTS } from "@/lib/units";
import { resolveIconUrl } from "@/lib/icons";
import { getRelicsMap } from "@/lib/relics";
import styles from "./MatchHistoryList.module.css";

const RELICS_MAP: Record<string, RelicInfo> = getRelicsMap();
const UNITS_FULL = unitsFullData as Record<string, UnitFullInfo>;
const SYNERGIES_MAP = synergiesJson as Record<string, SynergyInfo>;

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
  unitsFull = UNITS_FULL,
  synergiesData = SYNERGIES_MAP,
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
                itemSynergies={ITEM_SYNERGIES as Record<string, string>}
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
