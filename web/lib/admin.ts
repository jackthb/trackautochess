/**
 * Admin Steam IDs. Set NEXT_PUBLIC_ADMIN_STEAM_IDS to a comma-separated
 * list of 64-bit Steam IDs in the deployment env. Admins bypass the
 * manual refresh quota and may refresh any profile. The list is public
 * because the client uses it to decide whether to render the refresh
 * button on other people's profiles.
 */
function adminAllowlist(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_ADMIN_STEAM_IDS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isAdminSteamId(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return adminAllowlist().has(String(steamId));
}
