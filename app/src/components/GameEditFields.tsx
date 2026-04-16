import { CountedTagPicker, ReorderableTagPicker } from "./TagPickers";
import type { CountedTag } from "./TagPickers";
import type { SynergyInfo, RelicInfo } from "../types";
import { unitStem, relicStem, synIconName } from "../lib/game-utils";

const RANK_TIERS = ["Pawn", "Knight", "Bishop", "Rook", "King", "Queen"];

interface GameEditFieldsProps {
  editPlacement: string;
  editLevel: string;
  editRankTier: string;
  editRankNum: string;
  editW: number;
  editL: number;
  editUnits: CountedTag[];
  editSynergies: CountedTag[];
  editRelics: string[];
  editPlayedAt: string;
  setEditPlacement: (v: string) => void;
  setEditLevel: (v: string) => void;
  setEditRankTier: (v: string) => void;
  setEditRankNum: (v: string) => void;
  setEditW: (v: number) => void;
  setEditL: (v: number) => void;
  setEditUnits: (v: CountedTag[]) => void;
  setEditSynergies: (v: CountedTag[]) => void;
  setEditRelics: (v: string[]) => void;
  setEditPlayedAt: (v: string) => void;
  unitCosts: Record<string, number>;
  synergiesData: Record<string, SynergyInfo>;
  relicsData: Record<string, RelicInfo>;
}

export function GameEditFields({
  editPlacement,
  editLevel,
  editRankTier,
  editRankNum,
  editW,
  editL,
  editUnits,
  editSynergies,
  editRelics,
  editPlayedAt,
  setEditPlacement,
  setEditLevel,
  setEditRankTier,
  setEditRankNum,
  setEditW,
  setEditL,
  setEditUnits,
  setEditSynergies,
  setEditRelics,
  setEditPlayedAt,
  unitCosts,
  synergiesData,
  relicsData,
}: GameEditFieldsProps) {
  const allUnitNames = Object.keys(unitCosts).sort();
  const allSynergyNames = Object.values(synergiesData).map((s) => s.name).sort();
  const allRelicNames = Object.values(relicsData).map((r) => r.name).sort();

  return (
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
  );
}
