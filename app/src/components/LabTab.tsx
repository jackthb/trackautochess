import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LabRegion,
  LabFixture,
  LabScreenshotGroup,
  LabPytestEvent,
  LabConfigBundle,
} from "../types";

const KIND_COLORS: Record<string, string> = {
  ocr: "#22d3ee",
  template: "#f472b6",
  grid: "#facc15",
  band: "#94a3b8",
};

const LOUPE_SIZE = 140;
const LOUPE_ZOOM = 8;
const HANDLE_PX = 8;

type ScreenType = "my_matches" | "game_over" | "final_ranking" | "unknown";

type DragMode =
  | { kind: "none" }
  | { kind: "move"; name: string; startBbox: [number, number, number, number]; startMouseFrac: [number, number] }
  | { kind: "resize"; name: string; corner: "nw" | "ne" | "sw" | "se"; startBbox: [number, number, number, number] };

export function LabTab() {
  const [groups, setGroups] = useState<LabScreenshotGroup[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [screenType, setScreenType] = useState<ScreenType>("unknown");
  const [regions, setRegions] = useState<LabRegion[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<LabFixture[]>([]);
  const [fixtureName, setFixtureName] = useState("");
  const [pytestLog, setPytestLog] = useState("");
  const [pytestRunning, setPytestRunning] = useState(false);
  const [showLoupe, setShowLoupe] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragMode>({ kind: "none" });
  const mouseFracRef = useRef<[number, number] | null>(null);
  const mousePxRef = useRef<[number, number] | null>(null);

  // ── Load screenshot list + fixtures on mount ──────────────────────────────
  useEffect(() => {
    void window.lab.listScreenshots().then(setGroups);
    void window.lab.listFixtures().then(setFixtures);
  }, []);

  // ── Pytest output stream ──────────────────────────────────────────────────
  useEffect(() => {
    const off = window.lab.onPytestOutput((evt: LabPytestEvent) => {
      setPytestLog((prev) => prev + evt.text);
      if (evt.kind === "exit" || evt.kind === "error") setPytestRunning(false);
    });
    return off;
  }, []);

  // ── Load image when path changes ──────────────────────────────────────────
  const loadScreenshot = useCallback(async (filePath: string) => {
    setParseError(null);
    setRegions([]);
    setSelectedName(null);
    setCurrentPath(filePath);
    const dataUrl = await window.lab.imageData(filePath);
    if (!dataUrl) {
      setParseError("Failed to read image");
      return;
    }
    setImgSrc(dataUrl);

    setParsing(true);
    const result = await window.lab.parseFull({ path: filePath });
    setParsing(false);
    if (!result.ok) {
      setParseError(result.error || "Parse failed");
      return;
    }
    setScreenType((result.screen_type as ScreenType) || "unknown");
    setImgDims({ w: result.width || 0, h: result.height || 0 });
    setRegions(result.regions || []);
    const stem = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "fixture";
    setFixtureName(stem);
  }, []);

  // ── Image element sized to canvas ─────────────────────────────────────────
  useEffect(() => {
    if (!imgSrc) return;
    const img = new Image();
    img.onload = () => {
      imgElRef.current = img;
      requestAnimationFrame(redraw);
    };
    img.src = imgSrc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgSrc]);

  // ── Filtered regions ──────────────────────────────────────────────────────
  const visibleRegions = useMemo(() => {
    if (filterCategory === "all") return regions;
    return regions.filter((r) => r.category === filterCategory);
  }, [regions, filterCategory]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    regions.forEach((r) => set.add(r.category));
    return Array.from(set).sort();
  }, [regions]);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.name === selectedName) || null,
    [regions, selectedName],
  );

  // ── Canvas drawing ────────────────────────────────────────────────────────
  const fitTransform = useCallback(() => {
    const cvs = canvasRef.current;
    const img = imgElRef.current;
    if (!cvs || !img) return null;
    const cw = cvs.width;
    const ch = cvs.height;
    const ratio = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const drawW = img.naturalWidth * ratio;
    const drawH = img.naturalHeight * ratio;
    return {
      x: (cw - drawW) / 2,
      y: (ch - drawH) / 2,
      w: drawW,
      h: drawH,
      scale: ratio,
    };
  }, []);

  const redraw = useCallback(() => {
    const cvs = canvasRef.current;
    const img = imgElRef.current;
    if (!cvs || !img) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = "#0a0e16";
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    const t = fitTransform();
    if (!t) return;
    ctx.drawImage(img, t.x, t.y, t.w, t.h);

    // Draw regions
    for (const r of visibleRegions) {
      const [fx0, fy0, fx1, fy1] = r.bbox;
      const x = t.x + fx0 * t.w;
      const y = t.y + fy0 * t.h;
      const w = (fx1 - fx0) * t.w;
      const h = (fy1 - fy0) * t.h;
      const color = KIND_COLORS[r.kind] || "#94a3b8";
      const isSelected = r.name === selectedName;

      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.strokeStyle = isSelected ? "#fff" : color;
      ctx.fillStyle = color + "22";
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      if (r.label) {
        ctx.font = "11px system-ui, sans-serif";
        const text = r.label.length > 32 ? r.label.slice(0, 30) + "…" : r.label;
        const m = ctx.measureText(text);
        const labelY = y - 14 < t.y ? y + h + 14 : y - 4;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(x, labelY - 11, m.width + 6, 14);
        ctx.fillStyle = "#fff";
        ctx.fillText(text, x + 3, labelY);
      }

      if (isSelected) {
        ctx.fillStyle = "#fff";
        const handles: Array<[number, number]> = [
          [x, y], [x + w, y], [x, y + h], [x + w, y + h],
        ];
        for (const [hx, hy] of handles) {
          ctx.fillRect(hx - HANDLE_PX / 2, hy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
        }
      }
    }

    // Loupe
    if (showLoupe && mousePxRef.current && mouseFracRef.current) {
      const [mx, my] = mousePxRef.current;
      const [fx, fy] = mouseFracRef.current;
      if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
        const lx = cvs.width - LOUPE_SIZE - 8;
        const ly = 8;
        ctx.save();
        ctx.beginPath();
        ctx.rect(lx, ly, LOUPE_SIZE, LOUPE_SIZE);
        ctx.clip();
        ctx.fillStyle = "#000";
        ctx.fillRect(lx, ly, LOUPE_SIZE, LOUPE_SIZE);
        const srcW = LOUPE_SIZE / LOUPE_ZOOM;
        const srcH = LOUPE_SIZE / LOUPE_ZOOM;
        const srcX = fx * img.naturalWidth - srcW / 2;
        const srcY = fy * img.naturalHeight - srcH / 2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, lx, ly, LOUPE_SIZE, LOUPE_SIZE);
        ctx.imageSmoothingEnabled = true;
        // crosshair
        ctx.strokeStyle = "#22ff8855";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx + LOUPE_SIZE / 2, ly);
        ctx.lineTo(lx + LOUPE_SIZE / 2, ly + LOUPE_SIZE);
        ctx.moveTo(lx, ly + LOUPE_SIZE / 2);
        ctx.lineTo(lx + LOUPE_SIZE, ly + LOUPE_SIZE / 2);
        ctx.stroke();
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(lx + 0.5, ly + 0.5, LOUPE_SIZE - 1, LOUPE_SIZE - 1);
        ctx.restore();
        // Coords readout
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(lx, ly + LOUPE_SIZE, LOUPE_SIZE, 18);
        ctx.fillStyle = "#fff";
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText(
          `(${fx.toFixed(4)}, ${fy.toFixed(4)})`,
          lx + 4,
          ly + LOUPE_SIZE + 12,
        );
      }
    }
  }, [visibleRegions, selectedName, fitTransform, showLoupe]);

  // Redraw when state changes
  useEffect(() => { redraw(); }, [redraw]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    const cvs = canvasRef.current;
    if (!el || !cvs) return;
    const ro = new ResizeObserver(() => {
      cvs.width = el.clientWidth;
      cvs.height = el.clientHeight;
      redraw();
    });
    ro.observe(el);
    cvs.width = el.clientWidth;
    cvs.height = el.clientHeight;
    redraw();
    return () => ro.disconnect();
  }, [redraw]);

  // ── Mouse handling ────────────────────────────────────────────────────────
  const canvasToImageFrac = useCallback((cx: number, cy: number): [number, number] | null => {
    const t = fitTransform();
    if (!t) return null;
    const fx = (cx - t.x) / t.w;
    const fy = (cy - t.y) / t.h;
    return [fx, fy];
  }, [fitTransform]);

  const hitTestHandle = useCallback((cx: number, cy: number, region: LabRegion): "nw" | "ne" | "sw" | "se" | null => {
    const t = fitTransform();
    if (!t) return null;
    const [fx0, fy0, fx1, fy1] = region.bbox;
    const corners: Array<{ name: "nw" | "ne" | "sw" | "se"; x: number; y: number }> = [
      { name: "nw", x: t.x + fx0 * t.w, y: t.y + fy0 * t.h },
      { name: "ne", x: t.x + fx1 * t.w, y: t.y + fy0 * t.h },
      { name: "sw", x: t.x + fx0 * t.w, y: t.y + fy1 * t.h },
      { name: "se", x: t.x + fx1 * t.w, y: t.y + fy1 * t.h },
    ];
    for (const c of corners) {
      if (Math.abs(cx - c.x) <= HANDLE_PX && Math.abs(cy - c.y) <= HANDLE_PX) {
        return c.name;
      }
    }
    return null;
  }, [fitTransform]);

  const hitTestRegion = useCallback((fx: number, fy: number): LabRegion | null => {
    // Topmost (last drawn) first
    for (let i = visibleRegions.length - 1; i >= 0; i--) {
      const r = visibleRegions[i];
      const [x0, y0, x1, y1] = r.bbox;
      if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) return r;
    }
    return null;
  }, [visibleRegions]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    mousePxRef.current = [cx, cy];
    const frac = canvasToImageFrac(cx, cy);
    mouseFracRef.current = frac;

    const drag = dragRef.current;
    if (drag.kind !== "none" && frac) {
      setRegions((prev) => prev.map((r) => {
        if (r.name !== drag.name) return r;
        if (drag.kind === "move") {
          const dx = frac[0] - drag.startMouseFrac[0];
          const dy = frac[1] - drag.startMouseFrac[1];
          const [x0, y0, x1, y1] = drag.startBbox;
          return { ...r, bbox: [
            clamp01(x0 + dx), clamp01(y0 + dy),
            clamp01(x1 + dx), clamp01(y1 + dy),
          ] as [number, number, number, number] };
        }
        // resize
        const [x0, y0, x1, y1] = drag.startBbox;
        let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
        if (drag.corner === "nw") { nx0 = clamp01(frac[0]); ny0 = clamp01(frac[1]); }
        if (drag.corner === "ne") { nx1 = clamp01(frac[0]); ny0 = clamp01(frac[1]); }
        if (drag.corner === "sw") { nx0 = clamp01(frac[0]); ny1 = clamp01(frac[1]); }
        if (drag.corner === "se") { nx1 = clamp01(frac[0]); ny1 = clamp01(frac[1]); }
        return { ...r, bbox: [
          Math.min(nx0, nx1), Math.min(ny0, ny1),
          Math.max(nx0, nx1), Math.max(ny0, ny1),
        ] as [number, number, number, number] };
      }));
    }
    redraw();
  }, [canvasToImageFrac, redraw]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const frac = canvasToImageFrac(cx, cy);
    if (!frac) return;

    // First check resize handle on selected
    if (selectedRegion) {
      const corner = hitTestHandle(cx, cy, selectedRegion);
      if (corner) {
        dragRef.current = {
          kind: "resize",
          name: selectedRegion.name,
          corner,
          startBbox: [...selectedRegion.bbox] as [number, number, number, number],
        };
        return;
      }
    }

    // Then click region
    const hit = hitTestRegion(frac[0], frac[1]);
    if (hit) {
      setSelectedName(hit.name);
      if (e.shiftKey || e.altKey) {
        // start move drag
        dragRef.current = {
          kind: "move",
          name: hit.name,
          startBbox: [...hit.bbox] as [number, number, number, number],
          startMouseFrac: frac,
        };
      }
      return;
    }
    setSelectedName(null);
  }, [canvasToImageFrac, selectedRegion, hitTestHandle, hitTestRegion]);

  const reparseRegion = useCallback(async (region: LabRegion) => {
    if (!currentPath) return;
    const result = await window.lab.parseRegion({
      path: currentPath,
      name: region.name,
      category: region.category,
      bbox: region.bbox,
    });
    if (result.ok && result.label !== undefined) {
      setRegions((prev) => prev.map((r) => r.name === region.name ? { ...r, label: result.label || "" } : r));
    }
  }, [currentPath]);

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = { kind: "none" };
    if (drag.kind === "none") return;
    const updated = regions.find((r) => r.name === drag.name);
    if (updated) void reparseRegion(updated);
  }, [regions, reparseRegion]);

  const onMouseLeave = useCallback(() => {
    mousePxRef.current = null;
    mouseFracRef.current = null;
    redraw();
  }, [redraw]);

  // ── Saving fixtures ───────────────────────────────────────────────────────
  const handleSaveFixture = useCallback(async () => {
    if (!currentPath || !fixtureName) return;
    const rows = regionsToFixtureRows(regions, screenType);
    const data = {
      screenshot_path: currentPath.replace(/\\/g, "/"),
      screen_type: screenType,
      rows,
    };
    await window.lab.saveFixture(fixtureName, data);
    void window.lab.listFixtures().then(setFixtures);
  }, [currentPath, fixtureName, regions, screenType]);

  const handleDeleteFixture = useCallback(async (name: string) => {
    const stem = name.replace(/\.json$/i, "");
    await window.lab.deleteFixture(stem);
    void window.lab.listFixtures().then(setFixtures);
  }, []);

  const handleRunPytest = useCallback(async () => {
    setPytestLog("");
    setPytestRunning(true);
    await window.lab.runFixtures();
  }, []);

  // ── Inspector actions ─────────────────────────────────────────────────────
  const updateSelectedBbox = useCallback((bbox: [number, number, number, number]) => {
    if (!selectedRegion) return;
    setRegions((prev) => prev.map((r) => r.name === selectedRegion.name ? { ...r, bbox } : r));
  }, [selectedRegion]);

  const handleResetSelected = useCallback(async () => {
    // Reload regions from backend (gets the original bboxes)
    if (!currentPath) return;
    setParsing(true);
    const result = await window.lab.parseFull({ path: currentPath });
    setParsing(false);
    if (result.ok) setRegions(result.regions || []);
  }, [currentPath]);

  const handleReparseSelected = useCallback(() => {
    if (selectedRegion) void reparseRegion(selectedRegion);
  }, [selectedRegion, reparseRegion]);

  return (
    <div className="lab-tab">
      <div className="lab-left">
        <div className="lab-section-title">Screenshots</div>
        <div className="lab-screenshot-list">
          {groups.map((g) => (
            <div key={g.label} className="lab-group">
              <div className="lab-group-label">{g.label}</div>
              {g.files.map((f) => (
                <div
                  key={f.path}
                  className={`lab-file ${currentPath === f.path ? "active" : ""}`}
                  onClick={() => void loadScreenshot(f.path)}
                  title={f.path}
                >
                  {f.name}
                </div>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="lab-empty">No screenshots found.</div>}
        </div>
      </div>

      <div className="lab-center">
        <div className="lab-toolbar">
          <span className={`lab-status ${parsing ? "busy" : ""}`}>
            {parsing
              ? "Parsing…"
              : !currentPath
                ? "no screenshot"
                : screenType !== "unknown" && regions.length > 0
                  ? screenType
                  : "unrecognised — check screen type / resolution"}
          </span>
          {imgDims && (
            <span className="lab-dim">
              {imgDims.w}×{imgDims.h}
              {imgDims.w / imgDims.h > 1.9 && " (non-16:9)"}
            </span>
          )}
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="lab-select"
          >
            <option value="all">All categories</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="lab-toggle">
            <input type="checkbox" checked={showLoupe} onChange={(e) => setShowLoupe(e.target.checked)} />
            Loupe
          </label>
          {parseError && <span className="lab-error">{parseError}</span>}
        </div>
        <div className="lab-canvas-wrap" ref={containerRef}>
          <canvas
            ref={canvasRef}
            className="lab-canvas"
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
          />
        </div>
        <div className="lab-help">
          Click a region to select. Shift- or Alt-drag to move. Drag a corner handle to resize. Re-parse fires on release.
        </div>
      </div>

      <div className="lab-right">
        <div className="lab-section-title">Inspector</div>
        {!selectedRegion && <div className="lab-empty">No region selected.</div>}
        {selectedRegion && (
          <div className="lab-inspector">
            <div className="lab-row"><span className="lab-key">name</span><span>{selectedRegion.name}</span></div>
            <div className="lab-row"><span className="lab-key">kind</span><span>{selectedRegion.kind}</span></div>
            <div className="lab-row"><span className="lab-key">category</span><span>{selectedRegion.category}</span></div>
            {selectedRegion.row_index !== null && (
              <div className="lab-row"><span className="lab-key">row</span><span>{selectedRegion.row_index}</span></div>
            )}
            <div className="lab-row"><span className="lab-key">label</span><span className="lab-label-value">{selectedRegion.label || "—"}</span></div>
            <div className="lab-bbox-grid">
              {(["x0", "y0", "x1", "y1"] as const).map((label, i) => (
                <label key={label} className="lab-bbox-input">
                  <span>{label}</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    max="1"
                    value={selectedRegion.bbox[i]}
                    onChange={(e) => {
                      const v = clamp01(parseFloat(e.target.value) || 0);
                      const next: [number, number, number, number] = [...selectedRegion.bbox] as [number, number, number, number];
                      next[i] = v;
                      updateSelectedBbox(next);
                    }}
                    onBlur={handleReparseSelected}
                  />
                </label>
              ))}
            </div>
            <div className="lab-button-row">
              <button onClick={handleReparseSelected}>Re-parse</button>
              <button onClick={handleResetSelected}>Reset all</button>
            </div>
          </div>
        )}

        <div className="lab-section-title" style={{ marginTop: 16 }}>Fixtures</div>
        <div className="lab-fixture-controls">
          <input
            type="text"
            value={fixtureName}
            onChange={(e) => setFixtureName(e.target.value)}
            placeholder="fixture name"
            className="lab-input"
          />
          <button onClick={handleSaveFixture} disabled={!currentPath}>Save</button>
        </div>
        <div className="lab-fixture-list">
          {fixtures.map((f) => (
            <div key={f.name} className="lab-fixture">
              <span title={f.screenshot_path}>{f.name}</span>
              <span className="lab-fixture-meta">{f.screen_type} ({f.row_count})</span>
              <button onClick={() => void handleDeleteFixture(f.name)}>×</button>
            </div>
          ))}
          {fixtures.length === 0 && <div className="lab-empty">No fixtures saved.</div>}
        </div>

        <div className="lab-section-title" style={{ marginTop: 16 }}>Pytest</div>
        <button onClick={handleRunPytest} disabled={pytestRunning}>
          {pytestRunning ? "Running…" : "Run all fixtures"}
        </button>
        {pytestLog && (
          <pre className="lab-pytest-log">{pytestLog}</pre>
        )}
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function regionsToFixtureRows(regions: LabRegion[], screenType: ScreenType) {
  const byRow = new Map<number, Record<string, string>>();
  for (const r of regions) {
    if (r.row_index === null || r.row_index === undefined) continue;
    if (!byRow.has(r.row_index)) byRow.set(r.row_index, {});
    const row = byRow.get(r.row_index)!;
    if (r.category.endsWith("placement") || r.name.endsWith("placement")) row.placement = r.label;
    else if (r.category.endsWith("level")) row.level = r.label;
    else if (r.category.endsWith("wl")) row.wl = r.label;
    else if (r.category === "mm_units") row.units_str = r.label;
    else if (r.category === "mm_synergies" || r.category === "go_synergies") row.synergies = r.label;
    else if (r.category === "mm_relics" || r.category === "go_relics") row.relic = r.label;
    else if (r.category === "go_player_name") row.player_name = r.label;
    else if (r.category === "mm_rank" || r.category === "go_player_rank") row.rank = r.label;
  }
  const rows = Array.from(byRow.entries())
    .sort(([a], [b]) => a - b)
    .map(([, row]) => {
      const out: Record<string, string | string[]> = { ...row };
      if (typeof row.units_str === "string") {
        out.units = row.units_str.split(",").map((u: string) => u.trim()).filter(Boolean);
        delete (out as Record<string, unknown>).units_str;
      }
      return out;
    });
  void screenType;
  return rows;
}
