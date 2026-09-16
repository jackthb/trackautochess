const BENEFICIAL_STATS = [
  { key: "damage", pattern: /\bdamage\b/i },
  { key: "hp", pattern: /\b(?:base\s+)?(?:hp|health)\b/i },
  { key: "duration", pattern: /\bduration\b/i },
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

function directionalKind(clause) {
  const direction = wordDirection(clause);
  if (!direction) return null;

  const stats = [
    ...BENEFICIAL_STATS.map((stat) => ({ ...stat, upHelps: true })),
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

export function classifyPatchNoteKind(detail) {
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
  const kinds = clauses.map(directionalKind);
  if (clauses.length > 1 && kinds.some((kind) => kind === null)) return "change";

  const classified = [...new Set(kinds.filter(Boolean))];
  if (classified.length === 1) return classified[0];
  if (classified.length > 1) return "change";

  if (/\bbonus\b|\bbuffed?\b/.test(lower)) return "buff";
  if (/\bdowngrad(?:e|ed)\b|\bnerfed?\b/.test(lower)) return "nerf";
  return "change";
}
