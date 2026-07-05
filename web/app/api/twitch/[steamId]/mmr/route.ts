/**
 * Plain-text Twitch chatbot endpoint using a path parameter.
 *
 * Add the URL to a Twitch bot custom command such as Nightbot or
 * StreamElements. For example, an `!mmr` command can urlfetch this endpoint and
 * print the returned one-line Steam ID/profile/MMR summary directly in chat.
 */
import {
  twitchChatOptionsResponse,
  twitchChatTextResponse,
  twitchMmrChatResponse,
} from "@/lib/twitchStats";

export async function OPTIONS() {
  return twitchChatOptionsResponse();
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ steamId: string }> }
) {
  const { steamId: raw } = await ctx.params;
  if (!raw) {
    return twitchChatTextResponse("Steam ID required.");
  }
  return twitchMmrChatResponse(raw);
}
