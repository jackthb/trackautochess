/**
 * Plain-text Twitch chatbot endpoint using a query parameter.
 *
 * This is easier to wire into bot marketplaces/custom commands than the
 * path-based endpoint because full Steam profile URLs only need query escaping:
 * /api/twitch/mmr?steam=<Steam ID, vanity name, or Steam profile URL>
 */
import {
  twitchChatOptionsResponse,
  twitchChatTextResponse,
  twitchMmrChatResponse,
} from "@/lib/twitchStats";

export async function OPTIONS() {
  return twitchChatOptionsResponse();
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("steam")?.trim();
  if (!raw) {
    return twitchChatTextResponse(
      "Usage: !mmr <Steam ID64, Steam profile URL, or Steam vanity name>"
    );
  }
  return twitchMmrChatResponse(raw);
}
