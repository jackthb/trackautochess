/**
 * Parse a synergy description into a structured shape so the page and
 * tooltip can render it consistently regardless of where the source text
 * happens to put the "Class Perk: X" line.
 *
 * VPK descriptions are inconsistent. Most classes are:
 *   "<flavor intro>\n\nClass Perk: <Name>\n\nActive when ...\n\n(N) ... : ..."
 * Monk skips the intro:
 *   "Class Perk: <Name>\n\nActive when ...\n\n(N) ... : ..."
 * Species traits always start with the trait header:
 *   "Species Trait: <Name>\n\nActive when ...\n\n(N) ... : ..."
 *
 * We always render: perk header → intro (if any) → activation → tier
 * rows. The page wraps tier rows so the "(N)" gets the chip treatment.
 */
export interface SynergyTierRow {
  count: number;
  text: string;
}

export interface SynergyDescriptionParts {
  /** "Class Perk" / "Species Trait" / null when the line is absent. */
  perkLabel: string | null;
  /** Bare perk name, e.g. "Drunken Stagger". */
  perkName: string | null;
  /** Free-form intro paragraph that appears before the perk header, if any. */
  intro: string;
  /** "Active when you have at least (N) different ..." line. */
  activation: string;
  /** One row per (N) tier line in the description. */
  tiers: SynergyTierRow[];
  /** Anything else that didn't fit a known shape. */
  trailing: string;
}

const PERK_HEADER = /^(Class Perk|Species Trait|Species Perk)\s*:\s*(.+?)\s*$/im;
const ACTIVATION = /^Active when[^\n]*$/im;
const TIER_LINE = /^\((\d+)\)\s*([^\n]+)$/gm;

export function parseSynergyDescription(raw: string): SynergyDescriptionParts {
  const empty: SynergyDescriptionParts = {
    perkLabel: null,
    perkName: null,
    intro: "",
    activation: "",
    tiers: [],
    trailing: "",
  };
  if (!raw) return empty;

  let text = raw;

  const tiers: SynergyTierRow[] = [];
  text = text.replace(TIER_LINE, (_, n, body) => {
    tiers.push({ count: Number(n), text: body.trim() });
    return "";
  });

  let perkLabel: string | null = null;
  let perkName: string | null = null;
  let intro = "";
  let perkMatch = text.match(PERK_HEADER);
  if (perkMatch) {
    // The synergies lib uppercases "class perk"/"species trait" before
    // it reaches us. Normalise back to Title Case so the page chrome
    // stays readable.
    const rawLabel = perkMatch[1].toLowerCase();
    perkLabel =
      rawLabel === "class perk" ? "Class Perk" :
      rawLabel === "species trait" ? "Species Trait" :
      rawLabel === "species perk" ? "Species Trait" :
      perkMatch[1];
    perkName = perkMatch[2];
    const before = text.slice(0, perkMatch.index).trim();
    intro = before;
    text = text.slice((perkMatch.index ?? 0) + perkMatch[0].length);
  }

  let activation = "";
  const actMatch = text.match(ACTIVATION);
  if (actMatch) {
    activation = actMatch[0].trim();
    text =
      text.slice(0, actMatch.index ?? 0) +
      text.slice((actMatch.index ?? 0) + actMatch[0].length);
  }

  const trailing = text.replace(/\n{2,}/g, "\n").trim();

  return {
    perkLabel,
    perkName,
    intro,
    activation,
    tiers: tiers.sort((a, b) => a.count - b.count),
    trailing,
  };
}
