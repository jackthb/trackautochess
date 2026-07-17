"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { EntityIcon } from "@/components/EntityIcon";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import { fetchMyBuilds, saveBuild, submitBuild } from "@/lib/builds/client";
import {
  isUuid,
  type BuildItemPick,
  type BuildPiece,
  type BuildSnapshot,
  type CommunityBuildStatus,
  type SavedBuild,
} from "@/lib/builds/types";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import styles from "./builds.module.css";

const STORAGE_KEY = "dac-build-planner-v1";
const BOARD_COLS = 8;
const BOARD_ROWS = 4;
const MAX_PLANNED_ITEMS = 9;
const BOARD_PREVIEW_ITEMS = 6;

export interface BuilderUnit {
  slug: string;
  name: string;
  cost: number;
  synergies: string[];
  iconUrl: string;
}

export interface BuilderItem {
  slug: string;
  name: string;
  tier: number;
  iconUrl: string;
}

interface PlannerStore {
  builds: SavedBuild[];
  activeId: string;
}

interface SharedBuildPayload {
  build: SavedBuild;
}

function statusLabel(status: CommunityBuildStatus) {
  if (status === "pending") return "Pending review";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Draft";
}

function statusChipClass(status: CommunityBuildStatus) {
  if (status === "pending") return styles.statusPending;
  if (status === "approved") return styles.statusApproved;
  if (status === "rejected") return styles.statusRejected;
  return "";
}

function normalizeLegacyStatus(status: unknown): CommunityBuildStatus {
  if (status === "published") return "draft";
  if (
    status === "draft" ||
    status === "pending" ||
    status === "approved" ||
    status === "rejected"
  ) {
    return status;
  }
  return "draft";
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyBuild(): SavedBuild {
  return {
    id: makeId("build"),
    name: "Untitled build",
    description: "",
    status: "draft",
    updatedAt: new Date().toISOString(),
    snapshots: [
      {
        id: makeId("snap"),
        label: "Main board",
        round: 20,
        focusNote: "",
        pieces: [],
      },
    ],
  };
}

function initialStore(): PlannerStore {
  const build: SavedBuild = {
    id: "build_default",
    name: "Untitled build",
    description: "",
    status: "draft",
    updatedAt: "",
    snapshots: [
      {
        id: "snap_default",
        label: "Main board",
        round: 20,
        focusNote: "",
        pieces: [],
      },
    ],
  };
  return { builds: [build], activeId: build.id };
}

function readStore(): PlannerStore {
  if (typeof window === "undefined") {
    return initialStore();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw) as PlannerStore;
    if (!Array.isArray(parsed.builds) || parsed.builds.length === 0) {
      throw new Error("empty");
    }
    return {
      ...parsed,
      builds: parsed.builds.map((build) => ({
        ...build,
        status: normalizeLegacyStatus(build.status),
      })),
    };
  } catch {
    const build = emptyBuild();
    return { builds: [build], activeId: build.id };
  }
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function itemTierSortValue(tier: number) {
  return tier > 0 ? tier : Number.MAX_SAFE_INTEGER;
}

function sortItemsByTier(items: BuilderItem[]) {
  return [...items].sort((a, b) => {
    const aTier = itemTierSortValue(a.tier);
    const bTier = itemTierSortValue(b.tier);
    if (aTier !== bTier) return aTier - bTier;
    return a.name.localeCompare(b.name);
  });
}

function itemTierLabel(tier: number) {
  return tier > 0 ? `Level ${tier}` : "Special";
}

function costColor(cost: number) {
  if (cost === 5) return "#f2bc64";
  if (cost === 4) return "#d997ff";
  if (cost === 3) return "#6aa7ff";
  if (cost === 2) return "#8ac66e";
  return "#c6ccd8";
}

function normalizeItemPick(item: BuilderItem | BuildItemPick): BuildItemPick {
  const maybePick = item as Partial<BuildItemPick>;
  return {
    ...item,
    pickId: maybePick.pickId || makeId("item"),
  };
}

function makeItemPick(item: BuilderItem): BuildItemPick {
  return { ...item, pickId: makeId("item") };
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 2h4l.5 1H14v2H2V3h3.5L6 2Zm-2.5 4h9l-.6 8H4.1l-.6-8Z" />
    </svg>
  );
}

function clonePiece(piece: BuildPiece): BuildPiece {
  return {
    ...piece,
    items: piece.items.map((item) => ({ ...normalizeItemPick(item), pickId: makeId("item") })),
  };
}

function unitDragId(slug: string) {
  return `unit:${slug}`;
}

function pieceDragId(id: string) {
  return `piece:${id}`;
}

function itemPaletteDragId(slug: string) {
  return `item-palette:${slug}`;
}

function itemPieceDragId(pieceId: string, index: number) {
  return `item-piece:${pieceId}:${index}`;
}

function cellDropId(x: number, y: number) {
  return `cell:${x}:${y}`;
}

function pieceDropId(id: string) {
  return `piece-drop:${id}`;
}

function parseCellDropId(id: string): { x: number; y: number } | null {
  const match = /^cell:(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function encodeShare(build: SavedBuild): string {
  const payload: SharedBuildPayload = { build };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeShare(value: string): SavedBuild | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const json = decodeURIComponent(escape(atob(padded)));
    const payload = JSON.parse(json) as SharedBuildPayload;
    if (!payload.build || !Array.isArray(payload.build.snapshots)) return null;
    return {
      ...payload.build,
      id: makeId("build"),
      name: payload.build.name || "Shared build",
      status: "draft",
      updatedAt: new Date().toISOString(),
      snapshots: payload.build.snapshots.length ? payload.build.snapshots : emptyBuild().snapshots,
    };
  } catch {
    return null;
  }
}

function UnitPaletteButton({
  unit,
  selected,
  onSelect,
}: {
  unit: BuilderUnit;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: unitDragId(unit.slug),
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`${styles.unitButton} ${selected ? styles.selectedUnit : ""}`}
      onClick={onSelect}
      title={unit.name}
      style={{
        borderColor: costColor(unit.cost),
        transform: CSS.Translate.toString(transform),
        visibility: isDragging ? "hidden" : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      <img src={unit.iconUrl} alt={unit.name} />
    </button>
  );
}

function ItemPaletteButton({
  item,
  onClick,
}: {
  item: BuilderItem;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: itemPaletteDragId(item.slug),
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={styles.itemButton}
      title={item.name}
      onClick={onClick}
      style={{
        transform: CSS.Translate.toString(transform),
        visibility: isDragging ? "hidden" : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      <EntityIcon
        src={item.iconUrl}
        alt={item.name}
        size="sm"
        className={styles.paletteItemIcon}
      />
    </button>
  );
}

function BoardItemIcon({
  item,
  pieceId,
  index,
}: {
  item: BuildItemPick;
  pieceId: string;
  index: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: itemPieceDragId(pieceId, index),
  });
  return (
    <span
      ref={setNodeRef}
      title={`#${index + 1} ${item.name}`}
      className={styles.boardItemIcon}
      style={{
        transform: CSS.Translate.toString(transform),
        visibility: isDragging ? "hidden" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      {...attributes}
      {...listeners}
    >
      <EntityIcon
        src={item.iconUrl}
        alt=""
        size="sm"
        className={styles.boardItemImage}
      />
    </span>
  );
}

function SelectedItemRow({
  item,
  pieceId,
  index,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: BuildItemPick;
  pieceId: string;
  index: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: itemPieceDragId(pieceId, index),
  });
  return (
    <div
      ref={setNodeRef}
      className={styles.selectedItemRow}
      style={{
        transform: CSS.Translate.toString(transform),
        visibility: isDragging ? "hidden" : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      <EntityIcon
        src={item.iconUrl}
        alt=""
        size="sm"
        className={styles.selectedItemIcon}
      />
      <span className={styles.itemRankBadge}>{index + 1}</span>
      <span className={styles.selectedItemName}>{item.name}</span>
      <div className={styles.itemRankControls}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Move item up"
        >
          Up
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Move item down"
        >
          Down
        </button>
        <button
          type="button"
          className={styles.removeItemButton}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Remove item"
          aria-label="Remove item"
        >
          <RemoveIcon />
        </button>
      </div>
    </div>
  );
}

function BoardPieceView({
  piece,
  selected,
  onSelect,
}: {
  piece: BuildPiece;
  selected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: pieceDragId(piece.id) });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: pieceDropId(piece.id),
  });

  return (
    <span
      ref={setDropRef}
      className={`${styles.pieceDropTarget} ${isOver ? styles.pieceDropOver : ""}`}
    >
      <span
        ref={setDragRef}
        className={`${styles.piece} ${selected ? styles.selectedPiece : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        style={{
          borderColor: costColor(piece.cost),
          transform: CSS.Translate.toString(transform),
          visibility: isDragging ? "hidden" : undefined,
        }}
        {...attributes}
        {...listeners}
      >
        <img src={piece.iconUrl} alt={piece.name} />
        {piece.stars > 1 && (
          <span className={styles.stars}>{"*".repeat(piece.stars)}</span>
        )}
        {piece.items.length > 0 && (
          <span className={styles.itemStrip}>
            {piece.items.slice(0, BOARD_PREVIEW_ITEMS).map((item, index) => (
              <BoardItemIcon
                key={`${item.slug}-${index}`}
                item={item}
                pieceId={piece.id}
                index={index}
              />
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

function BoardCell({
  x,
  y,
  piece,
  selected,
  onPress,
  onSelectPiece,
}: {
  x: number;
  y: number;
  piece: BuildPiece | null;
  selected: boolean;
  onPress: () => void;
  onSelectPiece: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cellDropId(x, y) });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className={`${styles.cell} ${piece ? styles.occupiedCell : ""} ${
        isOver ? styles.cellOver : ""
      }`}
      onClick={onPress}
      aria-label={`Board ${x}, ${y}`}
    >
      {piece && (
        <BoardPieceView
          piece={piece}
          selected={selected}
          onSelect={onSelectPiece}
        />
      )}
    </button>
  );
}

export function BuildPlanner({
  units,
  items,
}: {
  units: BuilderUnit[];
  items: BuilderItem[];
}) {
  const { steamId, accessToken, ready: sessionReady } = useSupabaseSession();
  const [store, setStore] = useState<PlannerStore>(() => initialStore());
  const [hydrated, setHydrated] = useState(false);
  const [unitQuery, setUnitQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [selectedUnitSlug, setSelectedUnitSlug] = useState<string | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [busyAction, setBusyAction] = useState<"save" | "submit" | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("b");
    const sharedBuild = shared ? decodeShare(shared) : null;
    if (sharedBuild) {
      setStore((current) => ({
        builds: [sharedBuild, ...current.builds],
        activeId: sharedBuild.id,
      }));
      setActiveSnapshotId(sharedBuild.snapshots[0]?.id ?? null);
      setHydrated(true);
      return;
    }
    const loaded = readStore();
    setStore(loaded);
    setActiveSnapshotId(
      loaded.builds.find((build) => build.id === loaded.activeId)?.snapshots[0]?.id ??
        loaded.builds[0]?.snapshots[0]?.id ??
        null,
    );
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !sessionReady || !accessToken || !steamId) return;
    let cancelled = false;
    void fetchMyBuilds(accessToken)
      .then((remoteBuilds) => {
        if (cancelled || remoteBuilds.length === 0) return;
        setStore((current) => {
          const byId = new Map(current.builds.map((build) => [build.id, build]));
          for (const remote of remoteBuilds) {
            byId.set(remote.payload.id, {
              ...remote.payload,
              id: remote.id,
              status: remote.status,
              updatedAt: remote.updatedAt,
            });
          }
          const builds = [...byId.values()].sort((a, b) =>
            (b.updatedAt || "").localeCompare(a.updatedAt || ""),
          );
          const activeId = builds.some((build) => build.id === current.activeId)
            ? current.activeId
            : builds[0]?.id ?? current.activeId;
          return { builds, activeId };
        });
      })
      .catch(() => {
        // Keep local drafts if sync fails.
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, sessionReady, accessToken, steamId]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [hydrated, store]);

  const activeBuild =
    store.builds.find((build) => build.id === store.activeId) ?? store.builds[0];
  const snapshot =
    activeBuild.snapshots.find((snap) => snap.id === activeSnapshotId) ??
    activeBuild.snapshots[0] ??
    emptyBuild().snapshots[0];
  const selectedPiece =
    snapshot.pieces.find((piece) => piece.id === selectedPieceId) ?? null;
  const selectedUnit =
    units.find((unit) => unit.slug === selectedUnitSlug) ?? null;

  const sidebarBuilds = store.builds.slice(0, 12);
  const canEditServer =
    activeBuild.status === "draft" || activeBuild.status === "rejected";
  const unitsByCost = useMemo(() => {
    const query = unitQuery.trim().toLowerCase();
    const buckets: BuilderUnit[][] = [[], [], [], [], []];
    for (const unit of units) {
      if (
        query &&
        !unit.name.toLowerCase().includes(query) &&
        !unit.synergies.some((synergy) => synergy.toLowerCase().includes(query))
      ) {
        continue;
      }
      const bucket = buckets[Math.max(0, Math.min(4, unit.cost - 1))];
      bucket.push(unit);
    }
    return buckets.map(sortByName);
  }, [unitQuery, units]);
  const visibleItemGroups = useMemo(() => {
    const query = itemQuery.trim().toLowerCase();
    const sortedItems = sortItemsByTier(
      items.filter(
        (item) =>
          item.tier > 0 && (!query || item.name.toLowerCase().includes(query)),
      ),
    ).slice(0, 80);
    const tiers = [...new Set(sortedItems.map((item) => item.tier))].sort(
      (a, b) => itemTierSortValue(a) - itemTierSortValue(b),
    );
    return tiers.map((tier) => ({
      tier,
      items: sortedItems.filter((item) => item.tier === tier),
    }));
  }, [itemQuery, items]);

  const updateActiveBuild = (updater: (build: SavedBuild) => SavedBuild) => {
    setStore((current) => ({
      ...current,
      builds: current.builds.map((build) =>
        build.id === activeBuild.id
          ? { ...updater(build), updatedAt: new Date().toISOString() }
          : build,
      ),
    }));
  };

  const updateSnapshot = (updater: (snapshot: BuildSnapshot) => BuildSnapshot) => {
    updateActiveBuild((build) => ({
      ...build,
      snapshots: build.snapshots.map((snap) =>
        snap.id === snapshot.id ? updater(snap) : snap,
      ),
    }));
  };

  const occupiedPiece = (x: number, y: number) =>
    snapshot.pieces.find((piece) => piece.x === x && piece.y === y) ?? null;

  const addUnitToCell = (unit: BuilderUnit, x: number, y: number) => {
    const occupant = occupiedPiece(x, y);
    if (occupant) return;
    const piece: BuildPiece = {
      id: makeId("piece"),
      unitSlug: unit.slug,
      name: unit.name,
      iconUrl: unit.iconUrl,
      cost: unit.cost,
      stars: 1,
      x,
      y,
      items: [],
    };
    updateSnapshot((snap) => ({ ...snap, pieces: [...snap.pieces, piece] }));
    setSelectedPieceId(piece.id);
    setSelectedUnitSlug(null);
  };

  const movePieceToCell = (pieceId: string, x: number, y: number) => {
    const occupant = occupiedPiece(x, y);
    if (occupant && occupant.id !== pieceId) return;
    updateSnapshot((snap) => ({
      ...snap,
      pieces: snap.pieces.map((piece) =>
        piece.id === pieceId ? { ...piece, x, y } : piece,
      ),
    }));
    setSelectedPieceId(pieceId);
  };

  const placeSelected = (x: number, y: number) => {
    const occupant = occupiedPiece(x, y);
    if (selectedPieceId) {
      movePieceToCell(selectedPieceId, x, y);
      return;
    }
    if (!selectedUnit || occupant) {
      if (occupant) setSelectedPieceId(occupant.id);
      return;
    }
    addUnitToCell(selectedUnit, x, y);
  };

  const updateSelectedPiece = (updater: (piece: BuildPiece) => BuildPiece) => {
    if (!selectedPieceId) return;
    updateSnapshot((snap) => ({
      ...snap,
      pieces: snap.pieces.map((piece) =>
        piece.id === selectedPieceId ? updater(piece) : piece,
      ),
    }));
  };

  const removeSelectedPiece = () => {
    if (!selectedPieceId) return;
    updateSnapshot((snap) => ({
      ...snap,
      pieces: snap.pieces.filter((piece) => piece.id !== selectedPieceId),
    }));
    setSelectedPieceId(null);
  };

  const duplicateBuild = () => {
    const copy: SavedBuild = {
      ...activeBuild,
      id: makeId("build"),
      name: `${activeBuild.name} copy`,
      status: "draft",
      updatedAt: new Date().toISOString(),
      snapshots: activeBuild.snapshots.map((snap) => ({
        ...snap,
        id: makeId("snap"),
        pieces: snap.pieces.map((piece) => ({ ...clonePiece(piece), id: makeId("piece") })),
      })),
    };
    setStore((current) => ({
      builds: [copy, ...current.builds],
      activeId: copy.id,
    }));
    setSelectedPieceId(null);
    setActiveSnapshotId(copy.snapshots[0]?.id ?? null);
  };

  const newBuild = () => {
    const build = emptyBuild();
    setStore((current) => ({
      builds: [build, ...current.builds],
      activeId: build.id,
    }));
    setSelectedPieceId(null);
    setActiveSnapshotId(build.snapshots[0]?.id ?? null);
  };

  const addRoundSnapshot = () => {
    const nextRound = Math.min(50, Math.max(1, snapshot.round + 5));
    const snap: BuildSnapshot = {
      id: makeId("snap"),
      label: `Round ${nextRound}`,
      round: nextRound,
      focusNote: "",
      pieces: [],
    };
    updateActiveBuild((build) => ({
      ...build,
      snapshots: [...build.snapshots, snap].sort((a, b) => a.round - b.round),
    }));
    setActiveSnapshotId(snap.id);
    setSelectedPieceId(null);
  };

  const cloneRoundSnapshot = () => {
    const snap: BuildSnapshot = {
      ...snapshot,
      id: makeId("snap"),
      label: `Round ${Math.min(50, snapshot.round + 5)}`,
      round: Math.min(50, snapshot.round + 5),
      pieces: snapshot.pieces.map((piece) => ({ ...clonePiece(piece), id: makeId("piece") })),
    };
    updateActiveBuild((build) => ({
      ...build,
      snapshots: [...build.snapshots, snap].sort((a, b) => a.round - b.round),
    }));
    setActiveSnapshotId(snap.id);
    setSelectedPieceId(null);
  };

  const deleteRoundSnapshot = () => {
    if (activeBuild.snapshots.length <= 1) return;
    const remaining = activeBuild.snapshots.filter((snap) => snap.id !== snapshot.id);
    updateActiveBuild((build) => ({ ...build, snapshots: remaining }));
    setActiveSnapshotId(remaining[0]?.id ?? null);
    setSelectedPieceId(null);
  };

  const shareBuild = async () => {
    const url = new URL(window.location.href);
    url.pathname = "/builds";
    url.search = `?b=${encodeShare(activeBuild)}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus("Copied");
    } catch {
      window.history.replaceState(null, "", url.toString());
      setShareStatus("URL updated");
    }
    window.setTimeout(() => setShareStatus(""), 1800);
  };

  const applyServerBuild = (next: SavedBuild, previousId: string) => {
    setStore((current) => ({
      builds: [
        next,
        ...current.builds.filter(
          (build) => build.id !== previousId && build.id !== next.id,
        ),
      ],
      activeId: next.id,
    }));
  };

  const handleSave = async () => {
    if (!accessToken) {
      setSaveStatus("Sign in to save");
      window.setTimeout(() => setSaveStatus(""), 2200);
      return;
    }
    if (!canEditServer) {
      setSaveStatus("Copy the build to edit");
      window.setTimeout(() => setSaveStatus(""), 2200);
      return;
    }
    setBusyAction("save");
    setSaveStatus("Saving…");
    try {
      const result = await saveBuild(
        { ...activeBuild, status: "draft" },
        accessToken,
      );
      applyServerBuild(result.payload, activeBuild.id);
      setSaveStatus("Saved");
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusyAction(null);
      window.setTimeout(() => setSaveStatus(""), 2200);
    }
  };

  const handleSubmit = async () => {
    if (!accessToken) {
      setSaveStatus("Sign in to submit");
      window.setTimeout(() => setSaveStatus(""), 2200);
      return;
    }
    setBusyAction("submit");
    setSaveStatus("Submitting…");
    try {
      let buildId = activeBuild.id;
      if (!isUuid(buildId) || canEditServer) {
        const saved = await saveBuild(
          { ...activeBuild, status: "draft" },
          accessToken,
        );
        applyServerBuild(saved.payload, activeBuild.id);
        buildId = saved.id;
      }
      const submitted = await submitBuild(buildId, accessToken);
      applyServerBuild(submitted.payload, buildId);
      setSaveStatus("Submitted for review");
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusyAction(null);
      window.setTimeout(() => setSaveStatus(""), 2800);
    }
  };

  const addItemToSelectedPiece = (item: BuilderItem) => {
    if (!selectedPieceId) return;
    addItemToPiece(selectedPieceId, item);
  };

  const addItemToPiece = (pieceId: string, item: BuilderItem) => {
    updateSnapshot((snap) => ({
      ...snap,
      pieces: snap.pieces.map((piece) =>
        piece.id === pieceId
          ? {
              ...piece,
              items: piece.items.some((x) => x.slug === item.slug)
                ? piece.items
                : [...piece.items.map(normalizeItemPick), makeItemPick(item)].slice(0, MAX_PLANNED_ITEMS),
            }
          : piece,
      ),
    }));
  };

  const movePieceItemRank = (pieceId: string, index: number, direction: -1 | 1) => {
    updateSnapshot((snap) => ({
      ...snap,
      pieces: snap.pieces.map((piece) => {
        if (piece.id !== pieceId) return piece;
        const next = piece.items.map(normalizeItemPick);
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= next.length) return { ...piece, items: next };
        const [item] = next.splice(index, 1);
        next.splice(targetIndex, 0, item);
        return { ...piece, items: next };
      }),
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    setActiveDragId(null);
    if (!overId) return;

    const cell = parseCellDropId(overId);
    if (cell) {
      if (activeId.startsWith("unit:")) {
        const slug = activeId.slice("unit:".length);
        const unit = units.find((entry) => entry.slug === slug);
        if (unit) addUnitToCell(unit, cell.x, cell.y);
        return;
      }
      if (activeId.startsWith("piece:")) {
        movePieceToCell(activeId.slice("piece:".length), cell.x, cell.y);
        return;
      }
    }

    if (overId.startsWith("piece-drop:")) {
      const targetPieceId = overId.slice("piece-drop:".length);
      if (activeId.startsWith("item-palette:")) {
        const slug = activeId.slice("item-palette:".length);
        const item = items.find((entry) => entry.slug === slug);
        if (item) addItemToPiece(targetPieceId, item);
        return;
      }
      if (activeId.startsWith("item-piece:")) {
        const [, sourcePieceId, indexText] = activeId.split(":");
        const sourceIndex = Number(indexText);
        const sourcePiece = snapshot.pieces.find((piece) => piece.id === sourcePieceId);
        const item = sourcePiece?.items[sourceIndex];
        if (item) {
          moveItemToPiece({
            item,
            sourcePieceId,
            sourceIndex,
            targetPieceId,
          });
        }
      }
    }
  };

  const moveItemToPiece = ({
    item,
    sourcePieceId,
    sourceIndex,
    targetPieceId,
  }: {
    item: BuilderItem;
    sourcePieceId: string | null;
    sourceIndex: number | null;
    targetPieceId: string;
  }) => {
    updateSnapshot((snap) => {
      const target = snap.pieces.find((piece) => piece.id === targetPieceId);
      if (!target) return snap;
      const isMovingExisting = sourcePieceId !== null;
      if (sourcePieceId === targetPieceId) return snap;
      const targetAlreadyHasItem =
        isMovingExisting &&
        targetPieceId !== sourcePieceId &&
        target.items.some((entry) => entry.slug === item.slug);
      const targetIsFull = targetPieceId !== sourcePieceId && target.items.length >= MAX_PLANNED_ITEMS;
      if (targetAlreadyHasItem || targetIsFull) return snap;

      return {
        ...snap,
        pieces: snap.pieces.map((piece) => {
          if (piece.id === sourcePieceId && sourceIndex !== null) {
            return {
              ...piece,
              items: piece.items.filter((_, index) => index !== sourceIndex),
            };
          }
          if (piece.id === targetPieceId) {
            if (piece.id === sourcePieceId) return piece;
            return { ...piece, items: [...piece.items.map(normalizeItemPick), normalizeItemPick(item)].slice(0, MAX_PLANNED_ITEMS) };
          }
          return piece;
        }),
      };
    });
    setSelectedPieceId(targetPieceId);
  };

  const boardCells = [];
  for (let y = BOARD_ROWS; y >= 1; y -= 1) {
    for (let x = 1; x <= BOARD_COLS; x += 1) {
      boardCells.push({ x, y });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={styles.planner}>
      <aside className={styles.library}>
        <div className={styles.panelHeader}>
          <h2>My builds</h2>
          <button type="button" className={styles.smallButton} onClick={newBuild}>
            New
          </button>
        </div>
        <div className={styles.buildList}>
          {sidebarBuilds.map((build) => (
              <button
                type="button"
                key={build.id}
                className={`${styles.buildListItem} ${
                  build.id === activeBuild.id ? styles.activeListItem : ""
                }`}
                onClick={() => {
                  setStore((current) => ({ ...current, activeId: build.id }));
                  setSelectedPieceId(null);
                  setActiveSnapshotId(build.snapshots[0]?.id ?? null);
                }}
              >
                <span>{build.name || "Untitled build"}</span>
                <small>{statusLabel(build.status)}</small>
              </button>
            ))}
        </div>
      </aside>

      <section className={styles.editor}>
        {!steamId && sessionReady && (
          <div className={styles.signInHint}>
            <span>Sign in with Steam to save drafts and submit for the public list.</span>
            <SteamSignInButton source="builds" size="sm" />
          </div>
        )}
        <div className={styles.editorHeader}>
          <div className={styles.titleFields}>
            <input
              className={styles.nameInput}
              value={activeBuild.name}
              onChange={(e) =>
                updateActiveBuild((build) => ({ ...build, name: e.target.value }))
              }
              aria-label="Build name"
              disabled={!canEditServer && isUuid(activeBuild.id)}
            />
            <textarea
              className={styles.descriptionInput}
              value={activeBuild.description}
              onChange={(e) =>
                updateActiveBuild((build) => ({
                  ...build,
                  description: e.target.value,
                }))
              }
              aria-label="Build description"
              rows={2}
              disabled={!canEditServer && isUuid(activeBuild.id)}
            />
          </div>
          <div className={styles.statusControls}>
            <span className={`${styles.statusChip} ${statusChipClass(activeBuild.status)}`}>
              {statusLabel(activeBuild.status)}
            </span>
            <button
              type="button"
              className={styles.smallButton}
              onClick={handleSave}
              disabled={busyAction !== null || (!!steamId && !canEditServer)}
            >
              Save
            </button>
            <button
              type="button"
              className={styles.statusButton}
              onClick={handleSubmit}
              disabled={
                busyAction !== null ||
                !steamId ||
                activeBuild.status === "pending" ||
                activeBuild.status === "approved"
              }
            >
              Submit for public list
            </button>
            <button type="button" className={styles.smallButton} onClick={duplicateBuild}>
              Copy
            </button>
            <button type="button" className={styles.smallButton} onClick={shareBuild}>
              Share
            </button>
            {(shareStatus || saveStatus) && (
              <span className={styles.shareStatus}>{saveStatus || shareStatus}</span>
            )}
          </div>
        </div>

        <div className={styles.roundPlanner}>
          <div className={styles.roundTabs}>
            {activeBuild.snapshots.map((snap) => (
              <button
                type="button"
                key={snap.id}
                className={`${styles.roundTab} ${
                  snap.id === snapshot.id ? styles.activeRoundTab : ""
                }`}
                onClick={() => {
                  setActiveSnapshotId(snap.id);
                  setSelectedPieceId(null);
                }}
              >
                R{snap.round}
              </button>
            ))}
            <button type="button" className={styles.roundAction} onClick={addRoundSnapshot}>
              Add
            </button>
            <button type="button" className={styles.roundAction} onClick={cloneRoundSnapshot}>
              Clone
            </button>
            <button
              type="button"
              className={styles.roundAction}
              disabled={activeBuild.snapshots.length <= 1}
              onClick={deleteRoundSnapshot}
            >
              Delete
            </button>
          </div>
          <div className={styles.roundFields}>
            <label>
              <span>Round</span>
              <input
                type="number"
                min={1}
                max={50}
                value={snapshot.round}
                onChange={(e) =>
                  updateSnapshot((snap) => ({
                    ...snap,
                    round: Number(e.target.value) || snap.round,
                    label: `Round ${Number(e.target.value) || snap.round}`,
                  }))
                }
              />
            </label>
            <label>
              <span>Round plan</span>
              <input
                value={snapshot.focusNote}
                onChange={(e) =>
                  updateSnapshot((snap) => ({ ...snap, focusNote: e.target.value }))
                }
                placeholder="Example: roll for 2-star carries, hold economy"
              />
            </label>
          </div>
        </div>

        <div className={styles.workbench}>
          <div className={styles.boardPanel}>
            <div className={styles.board}>
              {boardCells.map((cell) => {
                const piece = occupiedPiece(cell.x, cell.y);
                return (
                  <BoardCell
                    key={`${cell.x}-${cell.y}`}
                    x={cell.x}
                    y={cell.y}
                    piece={piece}
                    selected={piece?.id === selectedPieceId}
                    onPress={() => placeSelected(cell.x, cell.y)}
                    onSelectPiece={() => {
                      if (!piece) return;
                      setSelectedPieceId(piece.id);
                      setSelectedUnitSlug(null);
                    }}
                  />
                );
              })}
            </div>
            <aside className={styles.inspector}>
              <div className={styles.panelHeader}>
                <h2>{selectedPiece ? selectedPiece.name : "Selection"}</h2>
                {selectedPiece && (
                  <button type="button" className={styles.dangerButton} onClick={removeSelectedPiece}>
                    Remove
                  </button>
                )}
              </div>
              {selectedPiece ? (
                <>
                  <div className={styles.stepper}>
                    <span>Stars</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedPiece((piece) => ({
                          ...piece,
                          stars: Math.max(1, piece.stars - 1),
                        }))
                      }
                    >
                      -
                    </button>
                    <strong>{selectedPiece.stars}</strong>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedPiece((piece) => ({
                          ...piece,
                          stars: Math.min(3, piece.stars + 1),
                        }))
                      }
                    >
                      +
                    </button>
                  </div>
                  <div className={styles.selectedItems}>
                    {selectedPiece.items.map((item, index) => (
                      <SelectedItemRow
                        key={`${item.slug}-${index}`}
                        item={normalizeItemPick(item)}
                        pieceId={selectedPiece.id}
                        index={index}
                        onRemove={() =>
                          updateSelectedPiece((piece) => ({
                            ...piece,
                            items: piece.items.filter((x) => x.slug !== item.slug),
                          }))
                        }
                        onMoveUp={() => movePieceItemRank(selectedPiece.id, index, -1)}
                        onMoveDown={() => movePieceItemRank(selectedPiece.id, index, 1)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.emptyInspector}>
                  {selectedUnit ? selectedUnit.name : "No piece selected"}
                </div>
              )}
            </aside>
          </div>

          <div className={styles.builderRail}>
            <section className={`${styles.palette} ${styles.piecePalette}`}>
              <div className={styles.paletteSection}>
                <div className={styles.panelHeader}>
                  <h2>Pieces</h2>
                  <input
                    className={styles.searchInput}
                    value={unitQuery}
                    onChange={(e) => setUnitQuery(e.target.value)}
                    placeholder="Search"
                    aria-label="Search pieces"
                  />
                </div>
                <div className={styles.unitBuckets}>
                  {unitsByCost.map((bucket, index) => (
                    <div className={styles.unitBucket} key={index}>
                      <div className={styles.bucketLabel}>${index + 1}</div>
                      <div className={styles.unitGrid}>
                        {bucket.slice(0, 24).map((unit) => (
                          <UnitPaletteButton
                            key={unit.slug}
                            unit={unit}
                            selected={selectedUnitSlug === unit.slug}
                            onSelect={() => {
                              setSelectedUnitSlug(unit.slug);
                              setSelectedPieceId(null);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>

        <section className={`${styles.palette} ${styles.itemPalette}`}>
          <div className={styles.paletteSection}>
            <div className={styles.panelHeader}>
              <h2>Items</h2>
              <input
                className={styles.searchInput}
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search items"
              />
            </div>
            <div className={styles.itemTierGroups}>
              {visibleItemGroups.map((group) => (
                <div className={styles.itemTierGroup} key={group.tier}>
                  <div className={styles.itemTierLabel}>{itemTierLabel(group.tier)}</div>
                  <div className={styles.itemGrid}>
                    {group.items.map((item) => (
                      <ItemPaletteButton
                        key={item.slug}
                        item={item}
                        onClick={() => addItemToSelectedPiece(item)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragId?.startsWith("unit:") &&
          (() => {
            const unit = units.find((entry) => entry.slug === activeDragId.slice("unit:".length));
            return unit ? (
              <div className={styles.dragOverlay}>
                <img src={unit.iconUrl} alt="" />
              </div>
            ) : null;
          })()}
        {activeDragId?.startsWith("item-palette:") &&
          (() => {
            const item = items.find((entry) => entry.slug === activeDragId.slice("item-palette:".length));
            return item ? (
              <div className={styles.dragOverlay}>
                <EntityIcon src={item.iconUrl} alt="" size="sm" className={styles.dragItemIcon} />
              </div>
            ) : null;
          })()}
      </DragOverlay>
    </DndContext>
  );
}
