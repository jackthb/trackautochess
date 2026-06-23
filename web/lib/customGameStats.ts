const DOTA_AUTO_CHESS_WORKSHOP_ID = "1613886175";
const METRICS_URL = `https://www.customgamestats.com/custom-games/QueryMetrics/${DOTA_AUTO_CHESS_WORKSHOP_ID}`;

export interface CustomGameMetrics {
  id: string;
  playerCount: number;
  spectatorCount: number;
  dailyPeak: number;
  subscriptions: number;
  favorites: number;
  lastUpdate: string | null;
}

interface CustomGameMetricsPayload {
  id?: string;
  player_count?: number;
  spectator_count?: number;
  dailyPeak?: number;
  subscriptions?: number;
  favorites?: number;
  last_update?: number;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function fetchDotaAutoChessMetrics(): Promise<CustomGameMetrics | null> {
  try {
    const response = await fetch(METRICS_URL, {
      next: { revalidate: 300 },
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: `https://www.customgamestats.com/games/${DOTA_AUTO_CHESS_WORKSHOP_ID}`,
        "user-agent": "Track Auto Chess live metrics",
      },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as CustomGameMetricsPayload;
    return {
      id: payload.id ?? DOTA_AUTO_CHESS_WORKSHOP_ID,
      playerCount: numeric(payload.player_count),
      spectatorCount: numeric(payload.spectator_count),
      dailyPeak: numeric(payload.dailyPeak),
      subscriptions: numeric(payload.subscriptions),
      favorites: numeric(payload.favorites),
      lastUpdate: payload.last_update
        ? new Date(payload.last_update * 1000).toISOString()
        : null,
    };
  } catch {
    return null;
  }
}
