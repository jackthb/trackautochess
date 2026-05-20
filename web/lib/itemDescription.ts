/**
 * Split an item description into its "active ability" block and its
 * passive/stats block. VPK descriptions interleave the two as one
 * paragraph; the items page renders them as separate sections so the
 * active ability — the most game-relevant part — reads at the top.
 *
 * Pattern in the data is consistently:
 *   "<stats sentence(s)>\n\nActive ability: <trigger>\n<effect>\n\n<meta>"
 * with the leading stats sometimes empty (Blink Dagger, Mekansm, etc.).
 */
export interface ItemDescriptionParts {
  /** The "Active ability: ..." block, or "" if the item has no active. */
  active: string;
  /** The passive stats / non-active body, or "" if there is none. */
  stats: string;
}

const ACTIVE_HEADER = /\bActive(?:\s+ability|\s+Ability):/;

export function parseItemDescription(raw: string): ItemDescriptionParts {
  if (!raw) return { active: "", stats: "" };
  const match = ACTIVE_HEADER.exec(raw);
  if (!match) {
    return { active: "", stats: raw.trim() };
  }
  const stats = raw.slice(0, match.index).trim();
  const active = raw.slice(match.index).trim();
  return { active, stats };
}
