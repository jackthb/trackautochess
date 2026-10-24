function cleanText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

// When a detail repeats its name and then continues, keep the suffix.
// "Knight" must not strip "Knightly", and a leftover "!" is not a suffix.
function detailAfterRepeatedName(name, detail) {
  if (!name || !detail.startsWith(name) || detail.length === name.length) return null;
  const rest = detail.slice(name.length);
  if (/^[A-Za-z0-9]/.test(rest)) return null;
  return rest.replace(/^[\s:：,.;!！?？·—–-]+/, "").trim();
}

// Hide a detail that only repeats the name. Historical one-liners store the
// same sentence in both fields. If the detail continues past that sentence,
// show the remainder so the lead-in is not printed twice and the rest is kept.
export function entryDetailForDisplay(name, detail) {
  const cleanedName = cleanText(name);
  const cleanedDetail = cleanText(detail);
  if (!cleanedDetail || cleanedDetail === cleanedName) return "";
  const suffix = detailAfterRepeatedName(cleanedName, cleanedDetail);
  if (suffix !== null) return suffix;
  return cleanedDetail;
}

export function entryTextForMeta(name, detail) {
  const cleanedName = cleanText(name);
  const cleanedDetail = cleanText(detail);
  if (!cleanedDetail || cleanedDetail === cleanedName) return cleanedName;
  if (cleanedName && cleanedDetail.startsWith(cleanedName)) return cleanedDetail;
  if (!cleanedName) return cleanedDetail;
  return `${cleanedName}: ${cleanedDetail}`;
}
