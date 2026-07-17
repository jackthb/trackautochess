export type CommunityBuildStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected";

export interface BuildItemPick {
  pickId: string;
  slug: string;
  name: string;
  tier: number;
  iconUrl: string;
}

export interface BuildPiece {
  id: string;
  unitSlug: string;
  name: string;
  iconUrl: string;
  cost: number;
  stars: number;
  x: number;
  y: number;
  items: BuildItemPick[];
}

export interface BuildSnapshot {
  id: string;
  label: string;
  round: number;
  focusNote: string;
  pieces: BuildPiece[];
}

/** Planner document stored in community_builds.payload (and localStorage). */
export interface SavedBuild {
  id: string;
  name: string;
  description: string;
  status: CommunityBuildStatus;
  updatedAt: string;
  snapshots: BuildSnapshot[];
}

export interface CommunityBuildSummary {
  id: string;
  name: string;
  description: string;
  status: CommunityBuildStatus;
  upvoteCount: number;
  authorSteamId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  viewerHasVoted?: boolean;
}

export interface CommunityBuildDetail extends CommunityBuildSummary {
  payload: SavedBuild;
}

export interface CommunityBuildComment {
  id: string;
  body: string;
  createdAt: string;
  authorSteamId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
}

export const COMMENT_MAX_LENGTH = 2000;

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isSavedBuildPayload(value: unknown): value is SavedBuild {
  if (!value || typeof value !== "object") return false;
  const build = value as Partial<SavedBuild>;
  return (
    typeof build.id === "string" &&
    typeof build.name === "string" &&
    typeof build.description === "string" &&
    Array.isArray(build.snapshots)
  );
}
