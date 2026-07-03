/** S44 Crimson Monk Season — update when the next season starts. */
export const QUEENS_SEASON_START = new Date("2026-07-01T00:00:00.000Z");

/** Days after season start before the Queen ladder is shown. */
export const QUEENS_NORMALIZATION_DAYS = 7;

function normalizationEndsAt(): Date {
  const end = new Date(QUEENS_SEASON_START);
  end.setUTCDate(end.getUTCDate() + QUEENS_NORMALIZATION_DAYS);
  return end;
}

export function queensSeasonNormalizing(now = new Date()): boolean {
  const end = normalizationEndsAt();
  return now >= QUEENS_SEASON_START && now < end;
}

export function queensLeaderboardAvailableOn(now = new Date()): Date | null {
  return queensSeasonNormalizing(now) ? normalizationEndsAt() : null;
}

export function formatQueensAvailableDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
