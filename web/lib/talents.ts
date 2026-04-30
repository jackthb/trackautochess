import talentsData from "@data/talents.json";

export interface DisplayTalent {
  key: string;
  name: string;
  description: string;
  tier: number;
  branch: "A" | "B";
}

interface RawTalent {
  title: string;
  description: string;
}

const TIER_LABELS: Record<number, string> = {
  1: "Round 5",
  2: "Round 15",
  3: "Round 25",
  4: "Round 35",
};

export function getTierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `Tier ${tier}`;
}

const ALL_TALENTS: DisplayTalent[] = Object.entries(
  talentsData as Record<string, RawTalent>
)
  .map(([key, value]) => {
    const tier = Number(key[0] || "0");
    const branch: "A" | "B" = key.slice(1).toUpperCase() === "B" ? "B" : "A";
    return {
      key: key.toUpperCase(),
      name: value.title,
      description: value.description,
      tier,
      branch,
    };
  })
  .sort((a, b) => a.tier - b.tier || a.branch.localeCompare(b.branch));

const TALENT_BY_NAME = new Map(
  ALL_TALENTS.map((talent) => [talent.name.toLowerCase(), talent])
);

export function getAllTalents(): DisplayTalent[] {
  return ALL_TALENTS;
}

export function getTalentByName(name: string): DisplayTalent | null {
  return TALENT_BY_NAME.get(name.toLowerCase()) ?? null;
}
