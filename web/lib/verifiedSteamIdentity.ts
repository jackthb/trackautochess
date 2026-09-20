import { normalizeSteamId64 } from "../../shared/steam";

/** Only the server-verified synthetic email establishes Steam ownership.
 * Supabase users can edit user_metadata, including its steam_id field.
 * auth.getUser() must validate the access token before calling this helper.
 */
export function verifiedSteamIdentity(user: {
  email?: string;
  email_confirmed_at?: string;
}): string | null {
  if (!user.email_confirmed_at) return null;
  const match = /^([0-9]{17})@steam\.local$/.exec(user.email ?? "");
  return match ? normalizeSteamId64(match[1]) : null;
}
