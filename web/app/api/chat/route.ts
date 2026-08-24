import {
  APICallError,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { logAbuse } from "@/lib/abuseLog";
import { openApiRoute } from "@/lib/apiGuard";
import { isAdminSteamId } from "@/lib/adminServer";
import {
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_RATE_LIMIT_PER_MINUTE,
} from "@/lib/chat/config";
import { tryConsumeDailyChatSlot } from "@/lib/chat/dailyCap";
import { latestUserText, trimHistory } from "@/lib/chat/messages";
import { chatGenerationModel } from "@/lib/chat/models";
import { buildChatSystemPrompt } from "@/lib/chat/prompt";
import { matchContentDocs } from "@/lib/chat/matchContent";
import type { ChatSource } from "@/lib/chat/types";
import { getSessionUser } from "@/lib/sessionUser";
import { createSupabaseAnonClient } from "@/lib/supabase";

const rateLimiter = new RateLimiterMemory({
  points: CHAT_RATE_LIMIT_PER_MINUTE,
  duration: 60,
});

export const maxDuration = 30;

function toSources(docs: ReturnType<typeof matchContentDocs>): ChatSource[] {
  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    urlPath: doc.urlPath,
    similarity: doc.similarity,
  }));
}

function chatErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "GatewayAuthenticationError") {
    return process.env.NODE_ENV === "development"
      ? "AI Gateway auth expired. Refresh the local OIDC token and restart the app."
      : "The assistant is temporarily unavailable.";
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 402) {
      return "The assistant is over budget. Try again later.";
    }
    if (error.statusCode === 429) {
      return "Too many requests. Please slow down.";
    }
    if (error.statusCode === 503) {
      return "The assistant is temporarily unavailable.";
    }
  }
  return "Something went wrong. Try again.";
}

export async function POST(req: Request) {
  const path = "/api/chat";
  const gate = await openApiRoute(req, { path, limiter: rateLimiter });
  if (!gate.ok) return gate.response;
  const { apiReq, ip, ua } = gate.ctx;

  if (!tryConsumeDailyChatSlot()) {
    logAbuse("rate_limit_exceeded", { path, ip, ua, reason: "daily_cap" });
    return Response.json(
      { error: "The assistant is busy right now. Try again tomorrow." },
      { status: 503 },
    );
  }

  const supabase = createSupabaseAnonClient();
  const session = await getSessionUser(apiReq, supabase);
  if (!session.steamId) {
    logAbuse("bot_blocked", { path, ip, ua, reason: "missing_session" });
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isAdminSteamId(session.steamId))) {
    logAbuse("bot_blocked", {
      path,
      ip,
      ua,
      steam_id: session.steamId,
      reason: "not_admin",
    });
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { messages?: UIMessage[] };
  try {
    body = (await req.json()) as { messages?: UIMessage[] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = trimHistory(body.messages ?? [], CHAT_MAX_HISTORY_MESSAGES);
  const query = latestUserText(messages);
  if (!query) {
    return Response.json({ error: "Missing user message" }, { status: 400 });
  }

  const retrievedDocs = matchContentDocs(query);
  const sources = toSources(retrievedDocs);
  const system = buildChatSystemPrompt({ docs: retrievedDocs });
  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    originalMessages: messages,
    onError: chatErrorMessage,
    execute: async ({ writer }) => {
      if (sources.length > 0) {
        writer.write({
          type: "data-sources",
          id: "chat-sources",
          data: { sources },
        });
      }

      const result = streamText({
        model: chatGenerationModel(),
        system,
        messages: modelMessages,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        telemetry: {
          isEnabled: true,
          functionId:
            retrievedDocs.some((doc) => doc.docType === "guide")
              ? "chat-guide"
              : retrievedDocs.length > 0
                ? "chat-grounded"
                : "chat-generic",
        },
      });

      writer.merge(result.toUIMessageStream({ onError: chatErrorMessage }));
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
