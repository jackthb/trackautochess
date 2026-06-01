// Pure types shared by the server-side commentary index (patchCommentary.ts)
// and the client component (PatchCommentary.tsx). Kept fs-free so it can be
// imported from either context without dragging Node built-ins into the bundle.
import type { EntryKind } from "./patchKinds";

export type EvidenceSource =
  | "vpk"
  | "testing"
  | "dev"
  | "community"
  | "other";

export interface PatchEvidence {
  source: EvidenceSource | string;
  detail?: string;
  url?: string;
}

export const EVIDENCE_SOURCE_LABEL: Record<string, string> = {
  vpk: "VPK",
  testing: "In-game test",
  dev: "Dev post",
  community: "Community",
  other: "Source",
};

// One commentary record as surfaced on an entity page: it carries enough
// context (which patch, what changed) to stand on its own away from the
// patch notes page.
export interface EntityCommentary {
  patchSlug: string;
  patchTitle: string;
  date: string;
  kind: EntryKind;
  name: string;
  detail: string;
  commentary: string;
  evidence: PatchEvidence[];
}

export type EntityCommentaryType =
  | "item"
  | "relic"
  | "talent"
  | "unit"
  | "synergy";
