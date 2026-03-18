import { useState, useRef, useEffect, useCallback } from "react";
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

// ── Tag picker with autocomplete ────────────────────────────────────────────

interface TagPickerProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  iconPrefix?: string;
  iconStem?: (name: string) => string;
  placeholder?: string;
}

function TagPicker({ tags, onChange, suggestions, iconPrefix, iconStem, placeholder }: TagPickerProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? suggestions.filter(
        (s) =>
          s.toLowerCase().includes(query.toLowerCase()) &&
          !tags.includes(s)
      ).slice(0, 8)
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

  function addTag(name: string) {
    if (!tags.includes(name)) {
      onChange([...tags, name]);
    }
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeTag(name: string) {
    onChange(tags.filter((t) => t !== name));
  }

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            {iconPrefix && iconStem && (
              <img
                className="tag-chip-icon"
                src={`icons://${iconPrefix}/${iconStem(t)}.png`}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span className="tag-chip-name">{t}</span>
            <button className="tag-chip-remove" onClick={() => removeTag(t)}>&times;</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-picker-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-picker-dropdown">
          {filtered.map((s) => (
            <button key={s} className="tag-picker-option" onClick={() => addTag(s)}>
              {iconPrefix && iconStem && (
                <img
                  className="tag-picker-option-icon"
                  src={`icons://${iconPrefix}/${iconStem(s)}.png`}
                  alt=""
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Synergy tag with count ──────────────────────────────────────────────────

interface SynergyTagPickerProps {
  synergies: { name: string; count: number }[];
  onChange: (syns: { name: string; count: number }[]) => void;
  allSynergies: string[];
}

function SynergyTagPicker({ synergies, onChange, allSynergies }: SynergyTagPickerProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const currentNames = synergies.map((s) => s.name);
  const filtered = query
    ? allSynergies.filter(
        (s) =>
          s.toLowerCase().includes(query.toLowerCase()) &&
          !currentNames.includes(s)
      ).slice(0, 8)
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

  function addSynergy(name: string) {
    onChange([...synergies, { name, count: 1 }]);
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeSynergy(name: string) {
    onChange(synergies.filter((s) => s.name !== name));
  }

  function updateCount(name: string, count: number) {
    onChange(synergies.map((s) => (s.name === name ? { ...s, count } : s)));
  }

  return (
    <div className="tag-picker" ref={wrapRef}>
      <div className="tag-picker-tags">
        {synergies.map((s) => (
          <span key={s.name} className="tag-chip">
            <img
              className="tag-chip-icon"
              src={`icons://synergies/${synIconName(s.name)}.png`}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="tag-chip-name">{s.name}</span>
            <input
              className="tag-chip-count"
              type="number"
              min="1"
              max="20"
              value={s.count}
              onChange={(e) => updateCount(s.name, parseInt(e.target.value) || 1)}
              onClick={(e) => e.stopPropagation()}
            />
            <button className="tag-chip-remove" onClick={() => removeSynergy(s.name)}>&times;</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-picker-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={synergies.length === 0 ? "Add synergy..." : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-picker-dropdown">
          {filtered.map((s) => (
            <button key={s} className="tag-picker-option" onClick={() => addSynergy(s)}>
              <img
                className="tag-picker-option-icon"
                src={`icons://synergies/${synIconName(s)}.png`}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
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

  // Structured edit state
  const [editPlacement, setEditPlacement] = useState(game.placement || "");
  const [editLevel, setEditLevel] = useState(game.level || "");
  const [editW, setEditW] = useState(0);
  const [editL, setEditL] = useState(0);
  const [editUnits, setEditUnits] = useState<string[]>([]);
  const [editSynergies, setEditSynergies] = useState<{ name: string; count: number }[]>([]);
  const [editRelics, setEditRelics] = useState<string[]>([]);
  const [screenshotFull, setScreenshotFull] = useState(false);

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
  const allSynergyNames = Object.values(synergiesData).map((s) => s.name).sort();
  const allRelicNames = Object.values(relicsData).map((r) => r.name).sort();

  const resetEditState = useCallback(() => {
    setEditPlacement(game.placement || "");
    setEditLevel(game.level || "");
    const parsedWL = parseWL(game.wl);
    setEditW(parsedWL?.w ?? 0);
    setEditL(parsedWL?.l ?? 0);
    // Parse lineup into unit names (strip star notation)
    const parsedLineup = (game.lineup || "").split("|").filter(Boolean).map((e) => {
      const m = e.match(/^(.+?)(?:\(\d\))?$/);
      return m ? m[1] : e;
    });
    setEditUnits(parsedLineup);
    setEditSynergies(parseSynergies(game.synergies));
    setEditRelics(parseRelics(game.relic));
    setScreenshotFull(false);
    setConfirmDelete(false);
  }, [game]);

  function handleToggle() {
    if (!expanded) resetEditState();
    setExpanded(!expanded);
  }

  async function handleSave() {
    setSaving(true);
    // Rebuild pipe-separated strings from structured state
    const lineupStr = editUnits.join("|") || null;
    const synStr = editSynergies.map((s) => `${s.name}:${s.count}`).join("|") || null;
    const relicStr = editRelics.join("|") || null;
    const wlStr = (editW || editL) ? `${editW}-${editL}` : null;

    const ok = await onUpdate(game.id, {
      placement: editPlacement,
      level: editLevel || null,
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
      <div className="game-row" onClick={handleToggle} style={{ cursor: "pointer" }}>
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
                    <div className="unit-icon-wrap" onClick={(e) => e.stopPropagation()}>
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
                  <div className="syn-badge" onClick={(e) => e.stopPropagation()}>
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
                <Tooltip
                  key={i}
                  type="relic"
                  name={r}
                  relicsData={relicsData}
                >
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
                  className={`game-screenshot-thumb ${screenshotFull ? "full" : ""}`}
                  src={screenshotUrl}
                  alt="Game screenshot"
                  onClick={() => setScreenshotFull(!screenshotFull)}
                />
              </div>
            )}
            <div className="edit-fields-grid">
              {/* Row 1: Placement, Level, W-L */}
              <label className="edit-label">
                <span>Placement</span>
                <select
                  className="edit-field"
                  value={editPlacement}
                  onChange={(e) => setEditPlacement(e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={String(n)}>{n}</option>
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
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={String(n)}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="edit-label">
                <span>W – L</span>
                <div className="edit-wl-pair">
                  <input
                    className="edit-field edit-wl-input"
                    type="number"
                    min="0"
                    max="99"
                    value={editW}
                    onChange={(e) => setEditW(parseInt(e.target.value) || 0)}
                  />
                  <span className="edit-wl-dash">–</span>
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

              {/* Row 2: Lineup (full width) */}
              <div className="edit-label edit-label-wide">
                <span>Lineup</span>
                <TagPicker
                  tags={editUnits}
                  onChange={setEditUnits}
                  suggestions={allUnitNames}
                  iconPrefix="units"
                  iconStem={unitStem}
                  placeholder="Add unit..."
                />
              </div>

              {/* Row 3: Synergies (full width) */}
              <div className="edit-label edit-label-wide">
                <span>Synergies</span>
                <SynergyTagPicker
                  synergies={editSynergies}
                  onChange={setEditSynergies}
                  allSynergies={allSynergyNames}
                />
              </div>

              {/* Row 4: Relic */}
              <div className="edit-label edit-label-wide">
                <span>Relic</span>
                <TagPicker
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
              onClick={() => { setExpanded(false); setConfirmDelete(false); }}
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
    </div>
  );
}
