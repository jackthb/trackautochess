import { useState, useRef, useEffect, useCallback } from "react";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "@dac/shared/types";
import {
  placementBg,
  unitStem,
  relicStem,
  synIconName,
  parseSynergies,
  parseRelics,
  parseWL,
  RANK_TIERS,
  NUMBERED_RANK_TIERS,
} from "@dac/shared/game-utils";
import { GameRowDisplay } from "@dac/shared/GameRowDisplay";
import { resolveIconUrl } from "@/lib/icons";

interface GameRowProps {
  game: Game;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  allUnitNames: string[];
  allSynergyNames: string[];
  allRelicNames: string[];
  onUpdate: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  onDelete: (gameId: number) => Promise<boolean>;
}

interface CountedTag {
  name: string;
  count: number;
}

function CountedTagPicker({
  tags,
  onChange,
  suggestions,
  iconUrl,
  placeholder,
  countLabel,
  minCount = 1,
  maxCount = 20,
  defaultCount = 1,
}: {
  tags: CountedTag[];
  onChange: (tags: CountedTag[]) => void;
  suggestions: string[];
  iconUrl: (name: string) => string;
  placeholder?: string;
  countLabel?: string;
  minCount?: number;
  maxCount?: number;
  defaultCount?: number;
}) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const currentNames = tags.map((t) => t.name);
  const filtered = query
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(query.toLowerCase()) &&
            !currentNames.includes(s)
        )
        .slice(0, 8)
    : [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t) => (
          <span key={t.name} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={iconUrl(t.name)}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="tag-chip-name">{t.name}</span>
            <input
              className="tag-chip-count"
              type="number"
              min={minCount}
              max={maxCount}
              value={t.count}
              title={countLabel}
              onChange={(e) => {
                const val = Math.max(
                  minCount,
                  Math.min(maxCount, parseInt(e.target.value) || defaultCount)
                );
                onChange(
                  tags.map((tag) =>
                    tag.name === t.name ? { ...tag, count: val } : tag
                  )
                );
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="tag-chip-remove"
              onClick={() => onChange(tags.filter((tag) => tag.name !== t.name))}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-picker-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-picker-dropdown">
          {filtered.map((s) => (
            <button
              key={s}
              className="tag-picker-option"
              onClick={() => {
                if (!currentNames.includes(s)) {
                  onChange([...tags, { name: s, count: defaultCount }]);
                }
                setQuery("");
                setShowSuggestions(false);
                inputRef.current?.focus();
              }}
            >
              <img
                className="tag-picker-option-icon"
                src={iconUrl(s)}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SimpleTagPicker({
  tags,
  onChange,
  suggestions,
  iconUrl,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  iconUrl: (name: string) => string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? suggestions
        .filter(
          (s) =>
            s.toLowerCase().includes(query.toLowerCase()) && !tags.includes(s)
        )
        .slice(0, 8)
    : [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={iconUrl(t)}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="tag-chip-name">{t}</span>
            <button
              className="tag-chip-remove"
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-picker-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-picker-dropdown">
          {filtered.map((s) => (
            <button
              key={s}
              className="tag-picker-option"
              onClick={() => {
                if (!tags.includes(s)) onChange([...tags, s]);
                setQuery("");
                setShowSuggestions(false);
                inputRef.current?.focus();
              }}
            >
              <img
                className="tag-picker-option-icon"
                src={iconUrl(s)}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GameRow({
  game,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  allUnitNames,
  allSynergyNames,
  allRelicNames,
  onUpdate,
  onDelete,
}: GameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [editPlacement, setEditPlacement] = useState(String(game.placement ?? ""));
  const [editLevel, setEditLevel] = useState(String(game.level ?? ""));
  const [editW, setEditW] = useState(0);
  const [editL, setEditL] = useState(0);
  const [editUnits, setEditUnits] = useState<CountedTag[]>([]);
  const [editSynergies, setEditSynergies] = useState<CountedTag[]>([]);
  const [editRankTier, setEditRankTier] = useState("");
  const [editRankNum, setEditRankNum] = useState("");
  const [editRelics, setEditRelics] = useState<string[]>([]);
  const [editPlayedAt, setEditPlayedAt] = useState("");

  const p = parseInt(game.placement) || 0;

  function toDatetimeLocal(isoStr: string) {
    const d = new Date(isoStr);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const resetEditState = useCallback(() => {
    setEditPlacement(String(game.placement ?? ""));
    setEditLevel(String(game.level ?? ""));
    const parsedRank = game.rank ? game.rank.split("-") : [];
    setEditRankTier(parsedRank[0] || "");
    setEditRankNum(parsedRank[1] || "");
    const parsedWL = parseWL(game.wl);
    setEditW(parsedWL?.w ?? 0);
    setEditL(parsedWL?.l ?? 0);
    const playedAt = game.played_at;
    setEditPlayedAt(playedAt ? toDatetimeLocal(playedAt) : "");
    const parsedLineup = (game.lineup || "")
      .split("|")
      .filter(Boolean)
      .map((e) => {
        const m = e.match(/^(.+?)(?:\((\d)\))?$/);
        return {
          name: m ? m[1] : e,
          count: m && m[2] ? parseInt(m[2]) : 1,
        };
      });
    setEditUnits(parsedLineup);
    setEditSynergies(
      parseSynergies(game.synergies).map((s) => ({
        name: s.name,
        count: s.count,
      }))
    );
    setEditRelics(parseRelics(game.relic));
    setConfirmDelete(false);
  }, [game]);

  function handleToggle() {
    if (!expanded) resetEditState();
    setExpanded(!expanded);
  }

  async function handleSave() {
    setSaving(true);
    const lineupStr =
      editUnits
        .map((u) => (u.count > 1 ? `${u.name}(${u.count})` : u.name))
        .join("|") || null;
    const synStr =
      editSynergies.map((s) => `${s.name}:${s.count}`).join("|") || null;
    const relicStr = editRelics.join("|") || null;
    const safeW = Math.max(0, Math.min(99, Number.isFinite(editW) ? editW : 0));
    const safeL = Math.max(0, Math.min(99, Number.isFinite(editL) ? editL : 0));
    const wlStr = safeW || safeL ? `${safeW}-${safeL}` : null;
    const rankStr = editRankTier
      ? editRankNum
        ? `${editRankTier}-${editRankNum}`
        : editRankTier
      : null;

    const ok = await onUpdate(game.id, {
      placement: editPlacement || game.placement,
      level: editLevel || null,
      rank: rankStr,
      wl: wlStr,
      lineup: lineupStr,
      synergies: synStr,
      relic: relicStr,
      played_at: editPlayedAt
        ? new Date(editPlayedAt).toISOString()
        : game.played_at,
    });
    setSaving(false);
    if (ok) setExpanded(false);
  }

  return (
    <div className="game-entry" style={{ background: placementBg(p) }}>
      <div style={{ position: "relative" }}>
        <GameRowDisplay
          game={game}
          unitCosts={unitCosts}
          unitsFull={unitsFull}
          synergiesData={synergiesData}
          relicsData={relicsData}
          iconUrl={resolveIconUrl}
          onClick={handleToggle}
          style={{ cursor: "pointer" }}
          dateExtra={
            <a
              className="btn-share"
              href={`/games/${game.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open share page"
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          }
        />
      </div>

      {expanded && (
        <div className="game-edit-panel" onClick={(e) => e.stopPropagation()}>
          <div className="edit-fields-grid">
            <div className="edit-fields-row">
              <label className="edit-label">
                <span>Placement</span>
                <select
                  className="edit-field"
                  value={editPlacement}
                  onChange={(e) => setEditPlacement(e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="edit-label">
                <span>Level</span>
                <select
                  className="edit-field"
                  value={editLevel}
                  onChange={(e) => setEditLevel(e.target.value)}
                >
                  <option value="">&mdash;</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="edit-label">
                <span>Rank</span>
                <div className="edit-rank-pair">
                  <select
                    className="edit-field"
                    value={editRankTier}
                    onChange={(e) => setEditRankTier(e.target.value)}
                  >
                    <option value="">&mdash;</option>
                    {RANK_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {NUMBERED_RANK_TIERS.includes(editRankTier as typeof NUMBERED_RANK_TIERS[number]) && (
                    <select
                      className="edit-field"
                      value={editRankNum}
                      onChange={(e) => setEditRankNum(e.target.value)}
                    >
                      <option value="">&mdash;</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <option key={n} value={String(n)}>
                          {n}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <div className="edit-label">
                <span>W &ndash; L</span>
                <div className="edit-wl-pair">
                  <input
                    className="edit-field edit-wl-input"
                    type="number"
                    min="0"
                    max="99"
                    value={editW}
                    onChange={(e) => setEditW(parseInt(e.target.value) || 0)}
                  />
                  <span className="edit-wl-dash">&ndash;</span>
                  <input
                    className="edit-field edit-wl-input"
                    type="number"
                    min="0"
                    max="99"
                    value={editL}
                    onChange={(e) => setEditL(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
              <label className="edit-label">
                <span>Time</span>
                <input
                  className="edit-field"
                  type="datetime-local"
                  value={editPlayedAt}
                  onChange={(e) => setEditPlayedAt(e.target.value)}
                />
              </label>
            </div>

            <div className="edit-label edit-label-wide">
              <span>Lineup</span>
              <CountedTagPicker
                tags={editUnits}
                onChange={setEditUnits}
                suggestions={allUnitNames}
                iconUrl={(name) => resolveIconUrl("units", unitStem(name))}
                placeholder="Add unit..."
                countLabel="Stars"
                minCount={1}
                maxCount={3}
                defaultCount={1}
              />
            </div>

            <div className="edit-label edit-label-wide">
              <span>Synergies</span>
              <CountedTagPicker
                tags={editSynergies}
                onChange={setEditSynergies}
                suggestions={allSynergyNames}
                iconUrl={(name) => resolveIconUrl("synergies", synIconName(name))}
                placeholder="Add synergy..."
                countLabel="Count"
                minCount={1}
                maxCount={20}
                defaultCount={1}
              />
            </div>

            <div className="edit-label edit-label-wide">
              <span>Relic</span>
              <SimpleTagPicker
                tags={editRelics}
                onChange={setEditRelics}
                suggestions={allRelicNames}
                iconUrl={(name) => resolveIconUrl("relics", relicStem(name))}
                placeholder="Add relic..."
              />
            </div>
          </div>

          <div className="edit-panel-actions">
            {!confirmDelete ? (
              <button
                className="btn-confirm btn-delete-game"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            ) : (
              <button
                className="btn-confirm btn-modal-danger"
                onClick={() => onDelete(game.id)}
              >
                Confirm delete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="btn-confirm btn-cancel"
              onClick={() => {
                setExpanded(false);
                setConfirmDelete(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-confirm btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
