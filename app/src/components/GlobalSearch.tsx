import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  UnitFullInfo,
  SynergyInfo,
  RelicInfo,
  ItemInfo,
  TalentInfo,
} from "../types";
import { unitStem, relicStem, synIconName } from "../lib/game-utils";

type EntityKind = "unit" | "item" | "synergy" | "relic" | "talent";

interface SearchResult {
  kind: EntityKind;
  name: string;
  description?: string;
  iconUrl?: string;
  score: number;
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  unitsFull: Record<string, UnitFullInfo>;
  unitCosts: Record<string, number>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  itemsData: Record<string, ItemInfo>;
  talentsData: Record<string, TalentInfo>;
}

const PER_GROUP_LIMIT = 5;

const KIND_LABEL: Record<EntityKind, string> = {
  unit: "Units",
  item: "Items",
  synergy: "Synergies",
  relic: "Relics",
  talent: "Talents",
};

const KIND_ORDER: EntityKind[] = ["unit", "item", "synergy", "relic", "talent"];

function score(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 500 - n.length;
  const idx = n.indexOf(q);
  if (idx >= 0) return 200 - idx;
  return -1;
}

export function GlobalSearch({
  open,
  onClose,
  unitsFull,
  unitCosts,
  synergiesData,
  relicsData,
  itemsData,
  talentsData,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Defer focus until portal mounts
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const grouped = useMemo(() => {
    const q = query.trim();
    const out: Record<EntityKind, SearchResult[]> = {
      unit: [],
      item: [],
      synergy: [],
      relic: [],
      talent: [],
    };
    if (!q) return out;

    // Units — name from unitsFull keys (preferred) or unitCosts
    const unitNames = new Set<string>([
      ...Object.keys(unitsFull),
      ...Object.keys(unitCosts),
    ]);
    for (const name of unitNames) {
      const s = score(name, q);
      if (s < 0) continue;
      out.unit.push({
        kind: "unit",
        name,
        iconUrl: `icons://units/${unitStem(name)}.png`,
        score: s,
      });
    }

    // Items — keys are display names, value has icon filename
    for (const [name, info] of Object.entries(itemsData)) {
      const s = score(name, q);
      if (s < 0) continue;
      const iconFile = info.icon || `${name.toLowerCase().replace(/\s+/g, "_")}.png`;
      out.item.push({
        kind: "item",
        name,
        iconUrl: `icons://items/${iconFile}`,
        score: s,
      });
    }

    // Synergies — keys are internal ids; .name is display
    for (const info of Object.values(synergiesData)) {
      const display = info?.name;
      if (!display) continue;
      const s = score(display, q);
      if (s < 0) continue;
      out.synergy.push({
        kind: "synergy",
        name: display,
        description: info.description,
        iconUrl: `icons://synergies/${synIconName(display)}.png`,
        score: s,
      });
    }

    // Relics — keys are internal ids (e.g. "item_upgrade_lootbox"); .name is display
    for (const info of Object.values(relicsData)) {
      const display = info?.name;
      if (!display) continue;
      const s = score(display, q);
      if (s < 0) continue;
      out.relic.push({
        kind: "relic",
        name: display,
        description: info?.description,
        iconUrl: `icons://relics/${relicStem(display)}.png`,
        score: s,
      });
    }

    // Talents — keys are slot ids (1a, 1b, ...); .title is display
    for (const info of Object.values(talentsData)) {
      const display = info?.title;
      if (!display) continue;
      const s = score(display, q);
      if (s < 0) continue;
      out.talent.push({
        kind: "talent",
        name: display,
        description: info.description,
        score: s,
      });
    }

    for (const k of KIND_ORDER) {
      out[k].sort((a, b) => b.score - a.score);
      out[k] = out[k].slice(0, PER_GROUP_LIMIT);
    }
    return out;
  }, [query, unitsFull, unitCosts, synergiesData, relicsData, itemsData, talentsData]);

  const flat = useMemo(() => {
    const list: SearchResult[] = [];
    for (const k of KIND_ORDER) list.push(...grouped[k]);
    return list;
  }, [grouped]);

  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(0);
  }, [flat.length, activeIdx]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) =>
          flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length
        );
      } else if (e.key === "Enter") {
        if (flat[activeIdx]) {
          e.preventDefault();
          onClose();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, flat, activeIdx, onClose]);

  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(
      ".gsearch-result.is-active"
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  const totalResults = flat.length;
  const showEmpty = query.trim().length > 0 && totalResults === 0;

  let runningIdx = 0;

  return createPortal(
    <div className="gsearch-backdrop" onClick={onClose}>
      <div
        className="gsearch-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Global search"
      >
        <div className="gsearch-input-row">
          <input
            ref={inputRef}
            className="gsearch-input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Search units, items, synergies, relics, talents…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="gsearch-hint">esc</span>
        </div>
        <div className="gsearch-results" ref={listRef}>
          {showEmpty && (
            <div className="gsearch-empty">No matches for "{query}"</div>
          )}
          {!query.trim() && (
            <div className="gsearch-empty">
              Start typing to search across units, items, synergies, relics, and talents.
            </div>
          )}
          {KIND_ORDER.map((kind) => {
            const items = grouped[kind];
            if (items.length === 0) return null;
            return (
              <div key={kind} className="gsearch-group">
                <div className="gsearch-group-header">{KIND_LABEL[kind]}</div>
                {items.map((r) => {
                  const idx = runningIdx++;
                  return (
                    <button
                      key={`${r.kind}-${r.name}`}
                      className={
                        "gsearch-result" + (idx === activeIdx ? " is-active" : "")
                      }
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => {
                        onClose();
                      }}
                    >
                      {r.iconUrl && (
                        <img
                          className="gsearch-result-icon"
                          src={r.iconUrl}
                          alt=""
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.visibility = "hidden";
                          }}
                        />
                      )}
                      <span className="gsearch-result-name">{r.name}</span>
                      <span className="gsearch-result-kind">{kind}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
