import type { BuildSnapshot, SavedBuild } from "./types";
import { isSavedBuildPayload } from "./types";

/** Decodes the same base64url payload web/app/builds/BuildPlanner.tsx encodes. */
export function decodeShareLink(shareLink: string): BuildSnapshot[] | null {
  try {
    const b = new URL(shareLink, "https://placeholder.invalid").searchParams.get("b");
    if (!b) return null;
    const padded = b.replaceAll("-", "+").replaceAll("_", "/");
    const json = decodeURIComponent(escape(atob(padded)));
    const payload = JSON.parse(json) as { build?: SavedBuild };
    if (!isSavedBuildPayload(payload.build)) return null;
    return payload.build.snapshots;
  } catch {
    return null;
  }
}

export function finalSnapshotFromShareLink(shareLink: string): BuildSnapshot | null {
  const snapshots = decodeShareLink(shareLink);
  if (!snapshots?.length) return null;
  return snapshots[snapshots.length - 1] ?? null;
}
