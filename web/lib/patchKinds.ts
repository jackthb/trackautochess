// Shared patch-entry "kind" vocabulary + presentation, used by the patch
// detail page and by commentary surfaced on entity pages.
export type EntryKind =
  | "added"
  | "removed"
  | "buff"
  | "nerf"
  | "change"
  | "rework"
  | "fix";

export const KIND_COLOR: Record<EntryKind, string> = {
  added: "var(--green-bright)",
  removed: "var(--red-bright)",
  buff: "var(--green-bright)",
  nerf: "var(--red-bright)",
  change: "var(--text-secondary)",
  rework: "var(--gold)",
  fix: "var(--text-secondary)",
};

export const KIND_LABEL: Record<EntryKind, string> = {
  added: "NEW",
  removed: "REMOVED",
  buff: "BUFF",
  nerf: "NERF",
  change: "CHANGE",
  rework: "REWORK",
  fix: "FIX",
};
