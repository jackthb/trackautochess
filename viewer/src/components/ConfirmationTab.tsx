import { useState, useEffect } from "react";
import type { ParseResult } from "../types";

interface ConfirmationTabProps {
  parseResult: ParseResult | null;
  onClear: () => void;
}

export function ConfirmationTab({
  parseResult,
  onClear,
}: ConfirmationTabProps) {
  const [checked, setChecked] = useState<boolean[]>([]);
  const [edits, setEdits] = useState<
    Record<number, Record<string, string>>
  >({});

  useEffect(() => {
    if (parseResult) {
      setChecked(parseResult.rows.map(() => true));
      setEdits({});
    }
  }, [parseResult]);

  if (!parseResult) {
    return (
      <div className="confirm-tab">
        <div className="confirm-container">
          <div className="confirm-empty">
            <div className="empty-state">
              <div className="empty-state-icon">&#128269;</div>
              <div className="empty-state-title">No matches to confirm</div>
              <div className="empty-state-desc">
                Capture a screenshot (F6) or wait for auto-detection. Parsed
                matches will appear here for review.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { rows, screenshot_b64 } = parseResult;
  const checkedCount = checked.filter(Boolean).length;

  const toggleAll = (val: boolean) => {
    setChecked(rows.map(() => val));
  };

  const toggleRow = (idx: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const setField = (idx: number, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [idx]: { ...prev[idx], [field]: value },
    }));
  };

  const getField = (idx: number, field: string, original: string) => {
    return edits[idx]?.[field] ?? original;
  };

  const handleConfirm = () => {
    const selected: number[] = [];
    checked.forEach((c, i) => {
      if (c) selected.push(i);
    });

    const editPayload: Record<string, Record<string, string | string[]>> = {};
    for (const [idxStr, fields] of Object.entries(edits)) {
      const idx = parseInt(idxStr);
      const orig = rows[idx];
      for (const [field, value] of Object.entries(fields)) {
        let origVal: string;
        if (field === "units") {
          origVal = (orig.units || []).join(", ");
        } else {
          origVal = (orig as unknown as Record<string, string>)[field] || "";
        }
        if (value !== origVal) {
          if (!editPayload[idxStr]) editPayload[idxStr] = {};
          if (field === "units") {
            editPayload[idxStr][field] = value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            editPayload[idxStr][field] = value;
          }
        }
      }
    }

    window.tracker.sendCommand({
      cmd: "confirm",
      selected,
      edits: editPayload,
    });
    onClear();
  };

  const handleCancel = () => {
    window.tracker.sendCommand({ cmd: "cancel_confirm" });
    onClear();
  };

  return (
    <div className="confirm-tab">
      <div className="confirm-container">
        <div className="confirm-preview">
          {screenshot_b64 && (
            <img
              src={`data:image/jpeg;base64,${screenshot_b64}`}
              alt="Screenshot preview"
            />
          )}
          <div className="confirm-preview-info">
            <h2>{rows.length} rows parsed</h2>
            <p>Edit fields below, uncheck rows to exclude, then Confirm.</p>
          </div>
        </div>

        <div className="confirm-table-wrap">
          <table className="confirm-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={checked.every(Boolean)}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th className="col-num">#</th>
                <th className="col-place">Place</th>
                <th className="col-level">Level</th>
                <th className="col-wl">W-L</th>
                <th className="col-rank">Rank</th>
                <th className="col-units">Units</th>
                <th className="col-syn">Synergies</th>
                <th className="col-relic">Relic</th>
                <th className="col-time">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                let rankDisplay = r.rank || "";
                let rankClass = "";
                if (r.rank_change === "up") {
                  rankDisplay += " (+)";
                  rankClass = "rank-up";
                } else if (r.rank_change === "down") {
                  rankDisplay += " (-)";
                  rankClass = "rank-down";
                }

                const synDisplay = r.synergies
                  ? r.synergies.replace(/\|/g, ", ").replace(/:/g, " ")
                  : "\u2014";
                let relicDisplay = r.relic || "\u2014";
                if (relicDisplay.length > 30)
                  relicDisplay = relicDisplay.slice(0, 27) + "...";

                return (
                  <tr key={i}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={checked[i] ?? true}
                        onChange={() => toggleRow(i)}
                      />
                    </td>
                    <td className="col-num">{i + 1}</td>
                    <td className="col-place">
                      <input
                        type="text"
                        className="edit-field"
                        value={getField(i, "placement", r.placement || "")}
                        onChange={(e) =>
                          setField(i, "placement", e.target.value)
                        }
                      />
                    </td>
                    <td className="col-level">
                      <input
                        type="text"
                        className="edit-field"
                        value={getField(i, "level", r.level || "")}
                        onChange={(e) =>
                          setField(i, "level", e.target.value)
                        }
                      />
                    </td>
                    <td className="col-wl">
                      <input
                        type="text"
                        className="edit-field"
                        value={getField(i, "wl", r.wl || "")}
                        onChange={(e) => setField(i, "wl", e.target.value)}
                      />
                    </td>
                    <td className="col-rank">
                      <span className={rankClass}>{rankDisplay}</span>
                    </td>
                    <td className="col-units">
                      <input
                        type="text"
                        className="edit-field"
                        value={getField(
                          i,
                          "units",
                          (r.units || []).join(", ")
                        )}
                        onChange={(e) =>
                          setField(i, "units", e.target.value)
                        }
                      />
                    </td>
                    <td className="col-syn">{synDisplay}</td>
                    <td className="col-relic">{relicDisplay}</td>
                    <td className="col-time">{r.time_ago || "\u2014"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="confirm-actions">
          <button
            className="btn-confirm btn-confirm-cancel"
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            className="btn-confirm btn-confirm-primary"
            onClick={handleConfirm}
          >
            Confirm ({checkedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
