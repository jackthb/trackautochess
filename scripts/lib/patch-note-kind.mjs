const BENEFICIAL_STATS = [
  { key: "damage", pattern: /\bdamage\b/i },
  { key: "hp", pattern: /\b(?:base\s+)?(?:hp|health)\b/i },
  { key: "duration", pattern: /\bduration\b/i },
  // Damage reduction and similar "reduction" stats help the unit that has
  // them. Decreasing the number is a nerf; increasing it is a buff. A clause
  // that assigns the stat to an enemy still flips that direction below.
  { key: "reduction", pattern: /\breduction\b/i },
  { key: "armor", pattern: /\barmor\b/i },
  { key: "attack speed", pattern: /\battack[- ]?speed\b/i },
  { key: "attack speed", pattern: /\bAS\b/ },
  { key: "movement speed", pattern: /\b(?:movement[- ]?speed|move speed|ms)\b/i },
  { key: "heal", pattern: /\bheal(?:ing)?\b/i },
  { key: "bounce count", pattern: /\bbounces?\b|\bbounce\s+count\b/i },
  { key: "radius", pattern: /\bradius\b/i },
  { key: "range", pattern: /\b(?:attack|cast)\s+range\b/i },
  { key: "slow", pattern: /\bslow\b/i },
  { key: "stun", pattern: /\bstun\b/i },
  { key: "chance", pattern: /\bchance\b/i },
];

const PENALTY_STATS = [
  { key: "cooldown", pattern: /\bcooldown\b/i },
  { key: "cast time", pattern: /\bcast[- ]?time\b/i },
  { key: "mana cost", pattern: /\bmana[- ]?cost\b/i },
  { key: "gold cost", pattern: /\bgold[- ]?cost\b/i },
  { key: "spawn delay", pattern: /\bspawn[- ]?delay\b/i },
];

export const PATCH_STAT_TERMS = [...BENEFICIAL_STATS, ...PENALTY_STATS];

function numericDirection(text) {
  const match = text.match(
    /\b(?:changed|adjusted)\s+from\s+(.+?)\s+to\s+(.+?)(?:[.;]|$)/i,
  );
  if (!match) return null;

  const before = [...match[1].matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  const after = [...match[2].matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  if (before.length === 0 || before.length !== after.length) return null;

  const deltas = after.map((value, index) => value - before[index]);
  if (deltas.some((delta) => delta > 0) && deltas.every((delta) => delta >= 0)) {
    return "up";
  }
  if (deltas.some((delta) => delta < 0) && deltas.every((delta) => delta <= 0)) {
    return "down";
  }
  return null;
}

function wordDirection(text) {
  if (/\b(?:increased?|raised?|improved?)\b/i.test(text)) return "up";
  if (/\b(?:decreased?|reduced?|lowered?)\b/i.test(text)) return "down";
  return numericDirection(text);
}

function hasDirectionLanguage(text) {
  return (
    /\b(?:increased?|raised?|improved?|decreased?|reduced?|lowered?)\b/i.test(text) ||
    /\b(?:changed|adjusted)\s+from\b/i.test(text)
  );
}

function splitDirectionalClauses(text) {
  return text.split(/\s*;\s*/).flatMap((part) => {
    const candidates = part
      .split(/\s*(?:,\s+(?=[A-Za-z])|\b(?:and|but)\b)\s*/i)
      .filter(Boolean);
    if (candidates.length <= 1) return [part];
    if (candidates.every(hasDirectionLanguage)) return candidates;

    const directionalIndexes = candidates
      .map((candidate, index) => hasDirectionLanguage(candidate) ? index : -1)
      .filter((index) => index >= 0);
    if (
      directionalIndexes.length !== 1 ||
      ![0, candidates.length - 1].includes(directionalIndexes[0])
    ) {
      return [part];
    }

    const direction = wordDirection(candidates[directionalIndexes[0]]);
    if (!direction) return [part];
    const directionWord = direction === "up" ? "increased" : "reduced";
    const appliesToEnemies =
      /^\s*(?:(?:increased?|raised?|improved?|decreased?|reduced?|lowered?)\s+)?(?:(?:all|the)\s+)?enem(?:y|ies)\b/i.test(part) ||
      /\b(?:for|of|on)\s+(?:(?:all|the)\s+)?enem(?:y|ies)\b/i.test(part);
    return candidates.map((candidate) => {
      let expanded = candidate;
      if (appliesToEnemies && !/\benem(?:y|ies)\b/i.test(expanded)) {
        expanded = `Enemy ${expanded}`;
      }
      if (!hasDirectionLanguage(expanded)) {
        expanded = `${expanded} ${directionWord}`;
      }
      return expanded;
    });
  });
}

function directionalKind(clause, { includeReduction = true } = {}) {
  const direction = wordDirection(clause);
  if (!direction) return null;

  const stats = [
    ...BENEFICIAL_STATS
      .filter((stat) => includeReduction || stat.key !== "reduction")
      .map((stat) => ({ ...stat, upHelps: true })),
    ...PENALTY_STATS.map((stat) => ({ ...stat, upHelps: false })),
  ].filter(({ pattern }) => pattern.test(clause));
  if (stats.length === 0) return null;

  const kinds = stats.map((stat) => {
    let isBuff = direction === "up" ? stat.upHelps : !stat.upHelps;
    const enemyIndex = clause.search(/\benem(?:y|ies)(?:'s)?\b/i);
    const statIndex = clause.search(stat.pattern);
    const describesEnemyStat =
      (enemyIndex >= 0 && statIndex > enemyIndex ||
        /\b(?:for|of|on)\s+(?:(?:all|the)\s+)?enem(?:y|ies)\b/i.test(clause)) &&
      !/\b(?:to|against)\s+enem(?:y|ies)\b/i.test(clause) &&
      !/\b(?:slow|stun|debuff)\b/i.test(clause);
    if (describesEnemyStat) isBuff = !isBuff;
    return isBuff ? "buff" : "nerf";
  });

  const uniqueKinds = [...new Set(kinds)];
  return uniqueKinds.length === 1 ? uniqueKinds[0] : "change";
}

// Hosting posts, ranked-mode announcements, and similar Workshop blurbs are
// notes. Balance lines are classified earlier and never reach this check.
export function isChangelogNotice(detail) {
  const lower = String(detail || "").toLowerCase();
  if (!lower.trim()) return false;
  // A stat line that also mentions ranked mode or a host is still a balance
  // change. Direction is decided before this function is consulted.
  if (/\bdrodo notice\b|^notice\b/.test(lower)) return true;
  if (/\brank(?:ed)?\s*mode\b/.test(lower) && /\b(re-?open|clos(?:e|ed)|beta|temp(?:o|ora)rarily|pledges?|ranked points|local host|finish rate)\b/.test(lower)) {
    return true;
  }
  if (/\bhosted locally\b|\bdonot leave\b|\bdo not leave early\b|\bdo not quit\b|\bpleased do not quit\b/.test(lower)) {
    return true;
  }
  if (/\bmaintenance\b/.test(lower) && /\b(?:server|arcade|dota)\b/.test(lower)) return true;
  if (/\bxiaoheihe\b|\bbattle pass\b|\bpass priorities\b|\btune in\b/.test(lower)) return true;
  if (/\bcannot register\b/.test(lower)) return true;
  if (/\brecruit panel\b/.test(lower) && /\b(?:cannot see|video settings|no model)\b/.test(lower)) return true;
  if (/\bvideo settings\b/.test(lower) && /\b(?:dota|model|recruit)\b/.test(lower)) return true;
  if (/\bdownload\b/.test(lower) && /\b(?:xiaoheihe|client)\b/.test(lower)) return true;
  if (/\bpremium hosts?\b|\bbadge for premium\b/.test(lower)) return true;
  if (/\bplease notify us\b/.test(lower)) return true;
  if (/\bkicked off\b/.test(lower) && /\b(?:season|award)\b/.test(lower)) return true;
  if (/\bpoint reward\b/.test(lower)) return true;
  if (/\blocal host\b/.test(lower) && /\bpoints?\b/.test(lower)) return true;
  return false;
}

// Labels already stored on main. The name is not joined, reduction is not a
// stat, and notice / missing rules are not applied. New Workshop posts use
// the default rules instead.
export function classifyHistoricalPatchNoteKind(detail) {
  const text = String(detail || "").trim();
  const lower = text.toLowerCase();

  if (/\bfix(?:ed|es|ing)?\b/.test(lower)) return "fix";
  if (/\b(?:temporarily\s+)?removed?\b/.test(lower)) return "removed";
  if (/\brework(?:ed)?\b/.test(lower)) return "change";
  if (/\badded?\b|\bnew\s+\w/.test(lower)) return "new";

  if (
    /\bpoint gains?\b/.test(lower) &&
    /\bloss(?:es|es remain)\b/.test(lower) &&
    /\bunaffected\b/.test(lower)
  ) {
    return "buff";
  }
  if (/\bconditions?\s+for\b/.test(lower) && /\brecruit cost\b/.test(lower) && /\bold:/.test(lower)) {
    return "buff";
  }

  const clauses = splitDirectionalClauses(text).filter(Boolean);
  const kinds = clauses.map((clause) => directionalKind(clause, { includeReduction: false }));
  if (clauses.length > 1 && kinds.some((kind) => kind === null)) return "change";

  const classified = [...new Set(kinds.filter(Boolean))];
  if (classified.length === 1) return classified[0];
  if (classified.length > 1) return "change";

  if (/\bbonus\b|\bbuffed?\b/.test(lower)) return "buff";
  if (/\bdowngrad(?:e|ed)\b|\bnerfed?\b/.test(lower)) return "nerf";
  return "change";
}

export function classifyPatchNoteKind(detail, name = "", options = {}) {
  if (options.rules === "historical") return classifyHistoricalPatchNoteKind(detail);
  const detailText = String(detail || "").trim();
  const nameText = typeof name === "string" ? name.trim() : "";
  const detailKind = classifyPatchNoteDetail(detailText);
  if (!nameText || nameText === detailText || hasDirectionLanguage(detailText)) {
    return detailKind;
  }
  // The name is not concatenated onto the detail. "Reaper's Scythe" plus
  // "missing health", or "new season" in a title, must not change the kind.
  // A fix or notice label in the name still applies when the detail itself
  // is only the explanation.
  if (detailKind === "fix" && isChangelogNotice(nameText)) return "note";
  if (detailKind === "change" && isChangelogNotice(nameText)) return "note";
  if (detailKind === "change" && /\b(?:bug-?fix(?:es)?|fix(?:ed|es|ing)?)\b/i.test(nameText)) return "fix";
  return detailKind;
}

function classifyPatchNoteDetail(detail) {
  const text = String(detail || "").trim();
  const lower = text.toLowerCase();

  const clauses = splitDirectionalClauses(text).filter(Boolean);
  const directional = [...new Set(clauses.map(directionalKind).filter(Boolean))];
  if (directional.length === 1 && clauses.every((clause) => directionalKind(clause))) return directional[0];

  if (isChangelogNotice(text)) return "note";
  if (/\bfix(?:ed|es|ing)?\b/.test(lower)) return "fix";
  const missingObject = "(?:effects?|bugs?|projectiles?|abilit(?:y|ies)|skills?|items?)";
  if (new RegExp(
    `\\b${missingObject}\\b[^.!\\n]{0,80}\\bmissing\\b|\\bmissing\\b[^.!\\n]{0,40}\\b${missingObject}\\b`,
    "i",
  ).test(lower) && !/\bmissing\s+health\b/i.test(lower)) {
    return "fix";
  }
  if (/\b(?:temporarily\s+)?removed?\b/.test(lower)) return "removed";
  if (/\brework(?:ed)?\b/.test(lower)) return "change";
  if (/\badded?\b|\bnew\s+\w/.test(lower)) return "new";

  if (
    /\bpoint gains?\b/.test(lower) &&
    /\bloss(?:es|es remain)\b/.test(lower) &&
    /\bunaffected\b/.test(lower)
  ) {
    return "buff";
  }
  if (/\bconditions?\s+for\b/.test(lower) && /\brecruit cost\b/.test(lower) && /\bold:/.test(lower)) {
    return "buff";
  }

  const kinds = clauses.map(directionalKind);
  if (clauses.length > 1 && kinds.some((kind) => kind === null)) return "change";

  const classified = [...new Set(kinds.filter(Boolean))];
  if (classified.length === 1) return classified[0];
  if (classified.length > 1) return "change";

  if (/\bbonus\b|\bbuffed?\b/.test(lower)) return "buff";
  if (/\bdowngrad(?:e|ed)\b|\bnerfed?\b/.test(lower)) return "nerf";
  return "change";
}
