import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Game, UnitFullInfo, SynergyInfo, RelicInfo } from "../types";
import {
  placementColor,
  placementBg,
  costBorderColor,
  unitStem,
  relicStem,
  synIconName,
  parseLineup,
  parseSynergies,
  parseRelics,
  parseWL,
} from "../lib/game-utils";
import { Tooltip } from "./Tooltip";

interface GameRowProps {
  game: Game;
  unitCosts: Record<string, number>;
  unitsFull: Record<string, UnitFullInfo>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
  onUpdate: (gameId: number, fields: Partial<Game>) => Promise<boolean>;
  onDelete: (gameId: number) => Promise<boolean>;
}

// ── Generic counted tag picker (used for lineup + synergies) ────────────────

interface CountedTag {
  name: string;
  count: number;
}

interface CountedTagPickerProps {
  tags: CountedTag[];
  onChange: (tags: CountedTag[]) => void;
  suggestions: string[];
  iconPrefix: string;
  iconStem: (name: string) => string;
  placeholder?: string;
  countLabel?: string;
  minCount?: number;
  maxCount?: number;
  defaultCount?: number;
}

function CountedTagPicker({
  tags,
  onChange,
  suggestions,
  iconPrefix,
  iconStem,
  placeholder,
  countLabel,
  minCount = 1,
  maxCount = 20,
  defaultCount = 1,
}: CountedTagPickerProps) {
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

  function add(name: string) {
    if (!currentNames.includes(name)) {
      onChange([...tags, { name, count: defaultCount }]);
    }
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(tags.filter((t) => t.name !== name));
  }

  function updateCount(name: string, count: number) {
    const clamped = Math.max(minCount, Math.min(maxCount, count));
    onChange(tags.map((t) => (t.name === name ? { ...t, count: clamped } : t)));
  }

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t) => (
          <span key={t.name} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={`icons://${iconPrefix}/${iconStem(t.name)}.png`}
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
              onChange={(e) =>
                updateCount(t.name, parseInt(e.target.value) || defaultCount)
              }
              onClick={(e) => e.stopPropagation()}
            />
            <button className="tag-chip-remove" onClick={() => remove(t.name)}>
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
              onClick={() => add(s)}
            >
              <img
                className="tag-picker-option-icon"
                src={`icons://${iconPrefix}/${iconStem(s)}.png`}
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

// ── Reorderable tag picker (for relics) ─────────────────────────────────────

interface ReorderableTagPickerProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  iconPrefix: string;
  iconStem: (name: string) => string;
  placeholder?: string;
}

function ReorderableTagPicker({
  tags,
  onChange,
  suggestions,
  iconPrefix,
  iconStem,
  placeholder,
}: ReorderableTagPickerProps) {
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

  function add(name: string) {
    if (!tags.includes(name)) onChange([...tags, name]);
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function remove(name: string) {
    onChange(tags.filter((t) => t !== name));
  }

  function moveUp(idx: number) {
    if (idx <= 0) return;
    const next = [...tags];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  }

  function moveDown(idx: number) {
    if (idx >= tags.length - 1) return;
    const next = [...tags];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  }

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t, i) => (
          <span key={t} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={`icons://${iconPrefix}/${iconStem(t)}.png`}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="tag-chip-name">{t}</span>
            {tags.length > 1 && (
              <span className="tag-chip-arrows">
                <button
                  className="tag-chip-arrow"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                >
                  &#9664;
                </button>
                <button
                  className="tag-chip-arrow"
                  onClick={() => moveDown(i)}
                  disabled={i === tags.length - 1}
                >
                  &#9654;
                </button>
              </span>
            )}
            <button className="tag-chip-remove" onClick={() => remove(t)}>
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
              onClick={() => add(s)}
            >
              <img
                className="tag-picker-option-icon"
                src={`icons://${iconPrefix}/${iconStem(s)}.png`}
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

// ── Screenshot lightbox ─────────────────────────────────────────────────────

function ScreenshotLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="screenshot-lightbox" onClick={onClose}>
      <img
        className="screenshot-lightbox-img"
        src={src}
        alt="Game screenshot"
        onClick={(e) => e.stopPropagation()}
      />
      <button className="screenshot-lightbox-close" onClick={onClose}>
        &times;
      </button>
    </div>,
    document.body
  );
}

// ── Main GameRow ────────────────────────────────────────────────────────────

export function GameRow({
  game,
  unitCosts,
  unitsFull,
  synergiesData,
  relicsData,
  onUpdate,
  onDelete,
}: GameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  // Structured edit state — units have stars, synergies have counts
  const [editPlacement, setEditPlacement] = useState(game.placement || "");
  const [editLevel, setEditLevel] = useState(game.level || "");
  const [editW, setEditW] = useState(0);
  const [editL, setEditL] = useState(0);
  const [editUnits, setEditUnits] = useState<CountedTag[]>([]);
  const [editSynergies, setEditSynergies] = useState<CountedTag[]>([]);
  const [editRankTier, setEditRankTier] = useState("");
  const [editRankNum, setEditRankNum] = useState("");
  const [editRelics, setEditRelics] = useState<string[]>([]);

  const RANK_TIERS = ["Pawn", "Knight", "Bishop", "Rook", "King", "Queen"];

  const p = parseInt(game.placement) || 0;
  const wl = parseWL(game.wl);
  const rankParts = game.rank ? game.rank.split("-") : [];
  const tier = rankParts[0] || "";
  const rankNum = rankParts[1] || "";
  const lineup = parseLineup(game.lineup, unitCosts);
  const syns = parseSynergies(game.synergies);
  const relics = parseRelics(game.relic);
  const pColor = placementColor(p);

  // Screenshot is already a full URL from Supabase
  const screenshotUrl = game.screenshot || null;

  // Build suggestion lists from reference data
  const allUnitNames = Object.keys(unitCosts).sort();
  const allSynergyNames = Object.values(synergiesData)
    .map((s) => s.name)
    .sort();
  const allRelicNames = Object.values(relicsData)
    .map((r) => r.name)
    .sort();

  const resetEditState = useCallback(() => {
    setEditPlacement(game.placement || "");
    setEditLevel(game.level || "");
    const parsedRank = game.rank ? game.rank.split("-") : [];
    setEditRankTier(parsedRank[0] || "");
    setEditRankNum(parsedRank[1] || "");
    const parsedWL = parseWL(game.wl);
    setEditW(parsedWL?.w ?? 0);
    setEditL(parsedWL?.l ?? 0);
    // Parse lineup preserving star data as counted tags
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
    // Rebuild pipe-separated strings preserving stars/counts
    const lineupStr =
      editUnits
        .map((u) => (u.count > 1 ? `${u.name}(${u.count})` : u.name))
        .join("|") || null;
    const synStr =
      editSynergies.map((s) => `${s.name}:${s.count}`).join("|") || null;
    const relicStr = editRelics.join("|") || null;
    const wlStr = editW || editL ? `${editW}-${editL}` : null;

    const rankStr = editRankTier
      ? editRankNum
        ? `${editRankTier}-${editRankNum}`
        : editRankTier
      : null;

    const ok = await onUpdate(game.id, {
      placement: editPlacement,
      level: editLevel || null,
      rank: rankStr,
      wl: wlStr,
      lineup: lineupStr,
      synergies: synStr,
      relic: relicStr,
    });
    setSaving(false);
    if (ok) setExpanded(false);
  }

  return (
    <div className="game-entry" style={{ background: placementBg(p) }}>
      <div
        className="game-row"
        onClick={handleToggle}
        style={{ cursor: "pointer" }}
      >
        <div className="cell">
          <div
            className="placement"
            style={{ color: pColor, borderColor: pColor }}
          >
            {game.placement}
          </div>
        </div>
        <div className="cell units-cell">
          {lineup.length > 0 && (
            <div className="lineup">
              {lineup.map((u, i) => {
                const cost = unitCosts[u.name] || 1;
                return (
                  <Tooltip
                    key={i}
                    type="unit"
                    name={u.name}
                    stars={u.stars}
                    unitCosts={unitCosts}
                    unitsFull={unitsFull}
                  >
                    <div
                      className="unit-icon-wrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <img
                        className="unit-icon"
                        src={`icons://units/${unitStem(u.name)}.png`}
                        alt={u.name}
                        loading="lazy"
                        style={{ borderColor: costBorderColor(cost) }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      {u.stars > 1 && (
                        <span className={`unit-stars s${u.stars}`}>
                          {"★".repeat(u.stars)}
                        </span>
                      )}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )}
          {syns.length > 0 && (
            <div className="synergies">
              {syns.map((s, i) => (
                <Tooltip
                  key={i}
                  type="synergy"
                  name={s.name}
                  count={s.count}
                  synergiesData={synergiesData}
                >
                  <div
                    className="syn-badge"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img
                      className="syn-icon"
                      src={`icons://synergies/${synIconName(s.name)}.png`}
                      alt={s.name}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span className="syn-count">{s.count}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
        <div className="cell rank-cell">
          <span className="rank-tier">{tier}</span>{" "}
          <span className="rank-num">{rankNum}</span>
          {game.rank && game.rank_change === "up" && (
            <span className="arrow-up">&#9650;</span>
          )}
          {game.rank && game.rank_change === "down" && (
            <span className="arrow-down">&#9660;</span>
          )}
        </div>
        <div className="cell wl">
          {wl ? (
            <>
              <span className="wl-w">{wl.w}</span>
              <span className="wl-sep"> &ndash; </span>
              <span className="wl-l">{wl.l}</span>
            </>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
          )}
        </div>
        <div className="cell level-cell">{game.level || "\u2014"}</div>
        <div className="cell relics-cell">
          {relics.length > 0 ? (
            <div className="relics">
              {relics.map((r, i) => (
                <Tooltip key={i} type="relic" name={r} relicsData={relicsData}>
                  <img
                    className="relic-icon"
                    src={`icons://relics/${relicStem(r)}.png`}
                    alt={r}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </Tooltip>
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
          )}
        </div>
        <div className="cell date-cell">
          {game.played_at ? (
            <>
              <div>
                {new Date(game.played_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <div>
                {new Date(game.played_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </>
          ) : (
            "\u2014"
          )}
        </div>
      </div>

      {expanded && (
        <div className="game-edit-panel" onClick={(e) => e.stopPropagation()}>
          <div className="edit-panel-body">
            {screenshotUrl && (
              <div className="edit-screenshot-col">
                <img
                  className="game-screenshot-thumb"
                  src={screenshotUrl}
                  alt="Game screenshot"
                  onClick={() => setLightbox(true)}
                />
              </div>
            )}
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
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {editRankTier && editRankTier !== "Queen" && (
                    <select
                      className="edit-field"
                      value={editRankNum}
                      onChange={(e) => setEditRankNum(e.target.value)}
                    >
                      <option value="">&mdash;</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <option key={n} value={String(n)}>{n}</option>
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
              </div>

              <div className="edit-label edit-label-wide">
                <span>Lineup</span>
                <CountedTagPicker
                  tags={editUnits}
                  onChange={setEditUnits}
                  suggestions={allUnitNames}
                  iconPrefix="units"
                  iconStem={unitStem}
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
                  iconPrefix="synergies"
                  iconStem={synIconName}
                  placeholder="Add synergy..."
                  countLabel="Count"
                  minCount={1}
                  maxCount={20}
                  defaultCount={1}
                />
              </div>

              <div className="edit-label edit-label-wide">
                <span>Relic</span>
                <ReorderableTagPicker
                  tags={editRelics}
                  onChange={setEditRelics}
                  suggestions={allRelicNames}
                  iconPrefix="relics"
                  iconStem={relicStem}
                  placeholder="Add relic..."
                />
              </div>
            </div>
          </div>
          <div className="edit-panel-actions">
            {!confirmDelete ? (
              <button
                className="btn-confirm btn-confirm-cancel btn-delete-game"
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
              className="btn-confirm btn-confirm-cancel"
              onClick={() => {
                setExpanded(false);
                setConfirmDelete(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn-confirm btn-confirm-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {lightbox && screenshotUrl && (
        <ScreenshotLightbox
          src={screenshotUrl}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}
