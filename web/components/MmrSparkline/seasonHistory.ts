export interface MmrSnapshot {
  mmr: number | null;
  snapshotted_at: string;
  season?: string | null;
}

export interface MmrSeasonTab {
  key: string;
  label: string;
  latest: number;
}

function normalizedSeason(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

export function seasonLabel(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^s(?:eason)?\s*(\d+)$/i);
  return match ? `S${match[1]}` : trimmed.toUpperCase();
}

function seasonSortValue(value: string): number {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function utcDayKey(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function snapshotsForSeason(
  snapshots: MmrSnapshot[],
  seasonKey: string | null | undefined
): MmrSnapshot[] {
  if (!seasonKey) return snapshots;
  return snapshots.filter(
    (snapshot) => normalizedSeason(snapshot.season) === seasonKey
  );
}

export function buildMmrPoints(
  snapshots: MmrSnapshot[],
  seasonKey?: string | null
) {
  const byDay = new Map<string, MmrSnapshot & { mmr: number }>();
  for (const snapshot of snapshotsForSeason(snapshots, seasonKey)
    .filter((s): s is MmrSnapshot & { mmr: number } => typeof s.mmr === "number")
    .slice()
    .sort(
      (a, b) =>
        new Date(a.snapshotted_at).getTime() -
        new Date(b.snapshotted_at).getTime()
    )) {
    const key = utcDayKey(snapshot.snapshotted_at);
    if (key) byDay.set(key, snapshot);
  }
  return byDay;
}

function hasTwoPointsForSeason(
  snapshots: MmrSnapshot[],
  seasonKey: string | null | undefined
): boolean {
  return buildMmrPoints(snapshots, seasonKey).size >= 2;
}

export function buildMmrSeasonTabs(
  snapshots: MmrSnapshot[],
  currentSeason: string | null | undefined
): MmrSeasonTab[] {
  const tabs = new Map<string, MmrSeasonTab>();

  for (const snapshot of snapshots) {
    const key = normalizedSeason(snapshot.season);
    if (!key || typeof snapshot.mmr !== "number") continue;

    const snapshottedMs = new Date(snapshot.snapshotted_at).getTime();
    const latest = Number.isFinite(snapshottedMs) ? snapshottedMs : 0;
    const current = tabs.get(key);

    if (!current || latest > current.latest) {
      tabs.set(key, {
        key,
        label: seasonLabel(snapshot.season ?? key),
        latest: Math.max(latest, seasonSortValue(key)),
      });
    }
  }

  const currentKey = normalizedSeason(currentSeason);
  return [...tabs.values()]
    .filter((tab) => hasTwoPointsForSeason(snapshots, tab.key))
    .sort((a, b) => {
      if (currentKey) {
        if (a.key === currentKey) return -1;
        if (b.key === currentKey) return 1;
      }
      return b.latest - a.latest;
    });
}

export function preferredMmrSeasonKey(
  seasonTabs: MmrSeasonTab[],
  snapshots: MmrSnapshot[],
  currentSeason: string | null | undefined
): string | null {
  const currentKey = normalizedSeason(currentSeason);
  if (currentKey && hasTwoPointsForSeason(snapshots, currentKey)) {
    return currentKey;
  }
  return seasonTabs[0]?.key ?? null;
}
