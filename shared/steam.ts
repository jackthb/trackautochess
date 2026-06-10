const steamId64Brand: unique symbol = Symbol("SteamId64");

export type SteamId64 = string & { readonly [steamId64Brand]: true };

// BigInt(...) instead of n-literals so ES2017 consumers accept this module.
const STEAM_ID64_MIN = BigInt("76561197960265728");
const STEAM_ID64_MAX = BigInt("76561202255233023");

export function isSteamId64(input: string): input is SteamId64 {
  if (!/^\d+$/.test(input)) return false;
  try {
    const value = BigInt(input);
    return value >= STEAM_ID64_MIN && value <= STEAM_ID64_MAX;
  } catch {
    return false;
  }
}

export function parseSteamId64(input: string): SteamId64 | null {
  return isSteamId64(input) ? input : null;
}

export function steamId64ToString(steamId: SteamId64): string {
  return steamId;
}
