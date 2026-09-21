import {
  Fragment,
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { UnitFullInfo, SynergyInfo, RelicInfo } from "./types";
import { costBorderColor, unitStem, relicStem, synIconName } from "./game-utils";

/** Replace inline "(N)" tier markers with a styled chip element so the
 *  description matches the tier-chip treatment on the synergies page. */
function renderTierChips(text: string): ReactNode {
  const parts = text.split(/\((\d{1,2})\)/g);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      nodes.push(
        <span key={i} className="tooltip-tier-chip">{parts[i]}</span>,
      );
    } else if (parts[i]) {
      nodes.push(<Fragment key={i}>{parts[i]}</Fragment>);
    }
  }
  return nodes;
}

export interface TooltipData {
  unitCosts?: Record<string, number>;
  unitsFull?: Record<string, UnitFullInfo>;
  synergiesData?: Record<string, SynergyInfo>;
  relicsData?: Record<string, RelicInfo>;
  iconUrl: (type: string, stem: string) => string;
}

interface TooltipWrapProps {
  children: ReactNode;
  type: "unit" | "synergy" | "relic";
  name: string;
  stars?: number;
  /** For synergies: the activated tier (what the badge shows). */
  count?: number;
  /** For synergies: bodies on board, when it differs from the tier. */
  pieceCount?: number;
  relicIndex?: number;
  data: TooltipData;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export function TooltipWrap({
  children,
  type,
  name,
  stars = 1,
  count = 0,
  pieceCount,
  relicIndex,
  data,
}: TooltipWrapProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{
    x: number;
    y: number;
    placement: "above" | "below";
  }>({ x: 0, y: 0, placement: "above" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const trigger = useRef<HTMLDivElement>(null);
  const [focusedTarget, setFocusedTarget] = useState<HTMLElement | null>(null);
  const [hasFocusableChild, setHasFocusableChild] = useState(false);
  const tooltipId = useId();
  const content = buildContent(type, name, stars, count, pieceCount, relicIndex, data);
  const hasContent = content !== null;

  const show = useCallback((target: HTMLElement, delay = 200) => {
    clearTimeout(timer.current);
    const reveal = () => {
      const rect = target.getBoundingClientRect();
      // The tooltip is tall (stats can run ~240px). When the target sits near
      // the top of the viewport, flipping it below keeps it on-screen and
      // readable instead of being clipped above the fold.
      const placement = rect.top < 260 ? "below" : "above";
      setPos({
        x: rect.left + rect.width / 2,
        y: placement === "below" ? rect.bottom : rect.top,
        placement,
      });
      setVisible(true);
    };
    if (delay === 0) reveal();
    else timer.current = setTimeout(reveal, delay);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setVisible(false);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!hasContent) {
      hide();
      setFocusedTarget(null);
    }
  }, [hasContent, hide]);

  useEffect(() => {
    // A wrapper around a real control must not add a second tab stop. Inspect
    // rendered descendants so custom child components work as well as DOM nodes.
    const root = trigger.current;
    if (!root) return;
    const update = () => setHasFocusableChild(Boolean(root.querySelector(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    )));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "href", "tabindex", "contenteditable"] });
    return () => observer.disconnect();
  }, [hasContent]);

  useEffect(() => {
    if (!visible) return;
    const target = focusedTarget;
    if (!target || target === trigger.current) return;
    const ids = new Set((target.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    ids.add(tooltipId);
    target.setAttribute("aria-describedby", [...ids].join(" "));
    return () => {
      const remaining = (target.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== tooltipId);
      if (remaining.length) target.setAttribute("aria-describedby", remaining.join(" "));
      else target.removeAttribute("aria-describedby");
    };
  }, [visible, tooltipId, focusedTarget]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <div
      ref={trigger}
      tabIndex={hasFocusableChild ? undefined : 0}
      aria-label={hasFocusableChild ? undefined : name}
      aria-describedby={visible && !hasFocusableChild ? tooltipId : undefined}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => { if (!focusedTarget) hide(); }}
      onFocus={(event) => {
        setFocusedTarget(event.target);
        show(event.currentTarget, 0);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocusedTarget(null);
        hide();
      }}
      onKeyDown={(event) => { if (event.key === "Escape") hide(); }}
      style={{ display: "inline-flex", position: "relative" }}
    >
      {children}
      {visible &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="tooltip visible"
            style={{
              left: Math.max(4, Math.min(pos.x - 160, window.innerWidth - 324)),
              top:
                pos.placement === "below"
                  ? pos.y + 8
                  : Math.max(4, pos.y - 8),
              transform:
                pos.placement === "below" ? undefined : "translateY(-100%)",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "");
}

function findSynergyData(
  name: string,
  data: Record<string, SynergyInfo>
): SynergyInfo | null {
  for (const val of Object.values(data)) {
    if (val.name === name) return val;
  }
  const norm = normalizeName(name);
  for (const val of Object.values(data)) {
    if (normalizeName(val.name) === norm) return val;
  }
  return null;
}

function findRelicData(
  name: string,
  data: Record<string, RelicInfo>
): RelicInfo | null {
  for (const val of Object.values(data)) {
    if (val.name === name) return val;
  }
  const norm = normalizeName(name);
  for (const val of Object.values(data)) {
    if (normalizeName(val.name) === norm) return val;
  }
  return null;
}

function buildContent(
  type: string,
  name: string,
  stars: number,
  count: number,
  pieceCount: number | undefined,
  relicIndex: number | undefined,
  data: TooltipData
): ReactNode {
  const { unitCosts = {}, unitsFull = {}, synergiesData = {}, relicsData = {}, iconUrl } = data;

  if (type === "unit") {
    const cost = unitCosts[name] || 1;
    const info = unitsFull[name];
    if (!info) return null;
    const starKey = `${stars}_star`;
    const stats = info?.stats?.[starKey] ?? null;
    const syns = info?.synergies || [];

    return (
      <>
        <div className="tooltip-header">
          <img
            className="tooltip-icon"
            src={iconUrl("units", unitStem(name))}
            style={{ borderColor: costBorderColor(cost) }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
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
              {Array.isArray(stats.atk) ? `${stats.atk[0]}-${stats.atk[1]}` : stats.atk}
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
    if (!info) return null;
    return (
      <>
        <div className="tooltip-header">
          <img
            className="tooltip-icon"
            src={iconUrl("synergies", synIconName(name))}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div>
            <div className="tooltip-name">{info.name || name}</div>
            <div className="tooltip-sub">
              {/* `count` is the activated tier. When Wizards discount the
                  requirement it outruns the bodies on board, so show both. */}
              {pieceCount != null && pieceCount !== count
                ? `${pieceCount} units · (${count}) active`
                : `${count} units`}
            </div>
          </div>
        </div>
        {info.tiers && info.tiers.length > 0 && (
          <div className="tooltip-tiers">
            {info.tiers.map((t) => (
              <span key={t} className={`tooltip-tier${count >= t ? " active" : ""}`}>
                ({t})
              </span>
            ))}
          </div>
        )}
        {(info.formatted || info.description) && (
          <div className="tooltip-desc" style={{ whiteSpace: "pre-line" }}>
            {renderTierChips(info.formatted || info.description || "")}
          </div>
        )}
      </>
    );
  }

  if (type === "relic") {
    const info = findRelicData(name, relicsData);
    if (!info) return null;
    const ordinal = relicIndex !== undefined ? ORDINALS[relicIndex] || `${relicIndex + 1}th` : undefined;
    return (
      <>
        <div className="tooltip-header">
          <img
            className="tooltip-icon"
            src={iconUrl("relics", relicStem(name))}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div>
            <div className="tooltip-name">{info.name || name}</div>
            {ordinal && <div className="tooltip-sub">{ordinal} pick</div>}
          </div>
        </div>
        {info.description && (
          <div className="tooltip-desc">{info.description}</div>
        )}
      </>
    );
  }

  return null;
}
