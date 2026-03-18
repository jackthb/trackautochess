import {
  useState,
  useRef,
  useCallback,
  type ReactNode,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
import { costBorderColor, unitStem, relicStem, synIconName } from "../lib/game-utils";

interface TooltipProps {
  children: ReactNode;
  type: "unit" | "synergy" | "relic";
  name: string;
  stars?: number;
  count?: number;
  relicIndex?: number;
  unitCosts?: Record<string, number>;
  unitsFull?: Record<string, UnitFullInfo>;
  synergiesData?: Record<string, SynergyInfo>;
  relicsData?: Record<string, RelicInfo>;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export function Tooltip({
  children,
  type,
  name,
  stars = 1,
  count = 0,
  relicIndex,
  unitCosts = {},
  unitsFull = {},
  synergiesData = {},
  relicsData = {},
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback(
    (e: MouseEvent) => {
      const target = e.currentTarget as HTMLElement;
      timer.current = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2, y: rect.top });
        setVisible(true);
      }, 200);
    },
    []
  );

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setVisible(false);
  }, []);

  const content = buildContent(
    type,
    name,
    stars,
    count,
    relicIndex,
    unitCosts,
    unitsFull,
    synergiesData,
    relicsData
  );

  return (
    <div
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ display: "inline-flex", position: "relative" }}
    >
      {children}
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            className="tooltip visible"
            style={{
              left: Math.max(
                4,
                Math.min(pos.x - 160, window.innerWidth - 324)
              ),
              top: Math.max(4, pos.y - 8),
              transform: "translateY(-100%)",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
}

function findSynergyData(
  name: string,
  data: Record<string, SynergyInfo>
): SynergyInfo | null {
  // Try exact match first, then case-insensitive
  for (const val of Object.values(data)) {
    if (val.name === name) return val;
  }
  const lower = name.toLowerCase();
  for (const val of Object.values(data)) {
    if (val.name.toLowerCase() === lower) return val;
  }
  return null;
}

function normalizeRelicName(name: string): string {
  return name.toLowerCase().replace(/[-\s]+/g, " ").trim();
}

function findRelicData(
  name: string,
  data: Record<string, RelicInfo>
): RelicInfo | null {
  // Exact match
  for (const val of Object.values(data)) {
    if (val.name === name) return val;
  }
  // Normalized match (case, hyphens, spacing)
  const norm = normalizeRelicName(name);
  for (const val of Object.values(data)) {
    if (normalizeRelicName(val.name) === norm) return val;
  }
  return null;
}

function buildContent(
  type: string,
  name: string,
  stars: number,
  count: number,
  relicIndex: number | undefined,
  unitCosts: Record<string, number>,
  unitsFull: Record<string, UnitFullInfo>,
  synergiesData: Record<string, SynergyInfo>,
  relicsData: Record<string, RelicInfo>
): ReactNode {
  if (type === "unit") {
    const cost = unitCosts[name] || 1;
    const info = unitsFull[name];
    const starKey = `${stars}_star`;
    const stats =
      info?.stats && info.stats[starKey] ? info.stats[starKey] : null;
    const syns = info?.synergies || [];

    return (
      <>
        <div className="tooltip-header">
          <img
            className="tooltip-icon"
            src={`icons://units/${unitStem(name)}.png`}
            style={{ borderColor: costBorderColor(cost) }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div>
            <div className="tooltip-name">{name}</div>
            <div className="tooltip-sub">
              Cost {cost}
              {syns.length > 0 && ` \u00B7 ${syns.join(" / ")}`}
              {stars > 1 && ` \u00B7 ${"★".repeat(stars)}`}
            </div>
          </div>
        </div>
        {stats && (
          <div className="tooltip-stats">
            <span className="tooltip-stat-label">HP</span>
            <span className="tooltip-stat-value">{stats.hp}</span>
            <span className="tooltip-stat-label">ATK</span>
            <span className="tooltip-stat-value">
              {Array.isArray(stats.atk)
                ? `${stats.atk[0]}-${stats.atk[1]}`
                : stats.atk}
            </span>
            <span className="tooltip-stat-label">Armor</span>
            <span className="tooltip-stat-value">{stats.armor}</span>
            <span className="tooltip-stat-label">MR</span>
            <span className="tooltip-stat-value">{stats.magic_resist}%</span>
            <span className="tooltip-stat-label">Mana</span>
            <span className="tooltip-stat-value">{stats.mana}</span>
            <span className="tooltip-stat-label">AS</span>
            <span className="tooltip-stat-value">{stats.atk_rate}s</span>
          </div>
        )}
      </>
    );
  }

  if (type === "synergy") {
    const info = findSynergyData(name, synergiesData);
    return (
      <>
        <div className="tooltip-header">
          <img
            className="tooltip-icon"
            src={`icons://synergies/${synIconName(name)}.png`}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div>
            <div className="tooltip-name">{info?.name || name}</div>
            <div className="tooltip-sub">{count} units</div>
          </div>
        </div>
        {info?.tiers && info.tiers.length > 0 && (
          <div className="tooltip-tiers">
            {info.tiers.map((t) => (
              <span
                key={t}
                className={`tooltip-tier${count >= t ? " active" : ""}`}
              >
                ({t})
              </span>
            ))}
          </div>
        )}
        {(info?.formatted || info?.description) && (
          <div className="tooltip-desc" style={{ whiteSpace: "pre-line" }}>
            {info.formatted || info.description}
          </div>
        )}
      </>
    );
  }

  if (type === "relic") {
    const info = findRelicData(name, relicsData);
    const ordinal = relicIndex !== undefined ? ORDINALS[relicIndex] || `${relicIndex + 1}th` : undefined;
    return (
      <>
        <div className="tooltip-header">
          <img
            className="tooltip-icon"
            src={`icons://relics/${relicStem(name)}.png`}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div>
            <div className="tooltip-name">{info?.name || name}</div>
            {ordinal && (
              <div className="tooltip-sub">{ordinal} pick</div>
            )}
          </div>
        </div>
        {info?.description && (
          <div className="tooltip-desc">{info.description}</div>
        )}
      </>
    );
  }

  return null;
}
