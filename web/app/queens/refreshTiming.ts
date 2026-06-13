export function nextQueensRefreshDelayMs(
  latestFetchedAt: string | null,
  cooldownMs: number,
  nowMs = Date.now()
): number {
  const latestFetchedMs = latestFetchedAt
    ? new Date(latestFetchedAt).getTime()
    : NaN;
  if (!Number.isFinite(latestFetchedMs)) return 0;
  return Math.max(0, latestFetchedMs + cooldownMs - nowMs);
}
