export function mostRecentTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  let latestValue: string | null = null;
  let latestTime = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time <= latestTime) continue;
    latestTime = time;
    latestValue = value;
  }
  return latestValue;
}
