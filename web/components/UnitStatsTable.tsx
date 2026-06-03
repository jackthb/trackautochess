import styles from "./UnitStatsTable.module.css";
import type { UnitStatsByStar } from "@/lib/units";

const STAR_LABELS: Record<keyof UnitStatsByStar, string> = {
  "1_star": "★",
  "2_star": "★★",
  "3_star": "★★★",
};

const STAT_ROWS = [
  { key: "hp", label: "Health" },
  { key: "mana", label: "Mana" },
  { key: "atk", label: "Attack" },
  { key: "armor", label: "Armor" },
  { key: "magic_resist", label: "Magic Resist" },
  { key: "atk_rate", label: "Attack Rate" },
  { key: "atk_range", label: "Attack Range" },
] as const;

function formatStat(value: number | number[] | undefined): string {
  if (value === undefined) return "-";
  if (Array.isArray(value)) return `${value[0]}-${value[1]}`;
  return String(value);
}

export function UnitStatsTable({ stats }: { stats: UnitStatsByStar }) {
  const stars = Object.keys(STAR_LABELS) as (keyof UnitStatsByStar)[];

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Stat</th>
            {stars.map((star) => (
              <th key={star} scope="col">{STAR_LABELS[star]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map(({ key, label }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {stars.map((star) => (
                <td key={star}>{formatStat(stats[star]?.[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
