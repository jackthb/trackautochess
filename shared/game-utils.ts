export function placementColor(p: number): string {
  if (p === 1) return "var(--gold)";
  if (p <= 3) return "var(--silver)";
  if (p === 4) return "var(--text-secondary)";
  return "var(--red-bright)";
}

export function placementBg(p: number): string {
  if (p === 1) return "rgba(201,168,76,0.08)";
  if (p <= 3) return "rgba(138,146,168,0.05)";
  if (p === 4) return "transparent";
  return "rgba(155,58,58,0.05)";
}

export function costBorderColor(cost: number): string {
  switch (cost) {
    case 1: return "#5c6278";
    case 2: return "#5a8fd5";
    case 3: return "#2a4a8a";
    case 4: return "#c44ea0";
    case 5: return "#c9a84c";
    default: return "#5c6278";
  }
}

export function unitStem(name: string): string {
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_").replace(/'/g, "");
}

export function relicStem(name: string): string {
  return name.toLowerCase().replace(/ /g, "_").replace(/-/g, "_");
}

export const SYN_ICON_MAP: Record<string, string> = {
  "Demon Hunter": "demonhunter",
  "Elemental": "element",
  "Faceless": "nraqi",
  "Pandaren": "pandaman",
};

export function synIconName(name: string): string {
  if (SYN_ICON_MAP[name]) return SYN_ICON_MAP[name];
  return name.toLowerCase().replace(/ /g, "");
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const SYNERGY_STEM_TO_NAME: Record<string, string> = {
  demonhunter: "Demon Hunter",
  nraqi: "Faceless",
  pandaman: "Pandaren",
  element: "Elemental",
};

export function parseLineup(
  lineup: string | null,
  unitCosts: Record<string, number>
): { name: string; stars: number }[] {
  if (!lineup) return [];
  return lineup
    .split("|")
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(.+?)(?:\((\d)\))?$/);
      if (!m) return { name: entry, stars: 1 };
      return { name: m[1], stars: m[2] ? parseInt(m[2]) : 1 };
    })
    .sort(
      (a, b) =>
        b.stars - a.stars ||
        (unitCosts[b.name] || 1) - (unitCosts[a.name] || 1)
    );
}

export function parseSynergies(
  syn: string | null
): { name: string; count: number }[] {
  if (!syn) return [];
  return syn
    .split("|")
    .filter(Boolean)
    .map((entry) => {
      const [raw, count] = entry.split(":");
      const name = SYNERGY_STEM_TO_NAME[raw.toLowerCase()] || capitalize(raw);
      return { name, count: parseInt(count) || 0 };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function parseRelics(relic: string | null): string[] {
  if (!relic) return [];
  return relic.split("|").filter(Boolean);
}

export function parseWL(
  wl: string | null
): { w: number; l: number } | null {
  if (!wl) return null;
  const parts = wl.split("-");
  if (parts.length !== 2) return null;
  return { w: parseInt(parts[0]) || 0, l: parseInt(parts[1]) || 0 };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7)
    return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`
  );
}
