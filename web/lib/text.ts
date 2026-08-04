/** Collapse whitespace runs into single spaces and trim. */
export function cleanText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

/** Truncate to maxLength characters, appending "..." when cut. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

/**
 * Normalize a free-text form field: collapse whitespace, trim, and cap length.
 * Non-strings (missing JSON fields) become "".
 */
export function cleanField(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
