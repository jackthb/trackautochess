const PATCH_NOTE_KEY_ORDER = [
  "date",
  "title",
  "category",
  "rollup",
  "openedOn",
  "source",
  "workshopUrl",
  "workshop_url",
  "image",
  "highlight",
  "entitiesSynced",
  "entitiesSyncedAt",
  "sourceEntries",
  "flavor",
  "absorbedDates",
  "sections",
];

export function orderPatchNote(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }

  const ordered = {};
  const seen = new Set();

  for (const key of PATCH_NOTE_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      ordered[key] = patch[key];
      seen.add(key);
    }
  }

  for (const key of Object.keys(patch)) {
    if (!seen.has(key)) {
      ordered[key] = patch[key];
    }
  }

  return ordered;
}

export function patchNoteToJson(patch) {
  return `${JSON.stringify(orderPatchNote(patch), null, 2)}\n`;
}
