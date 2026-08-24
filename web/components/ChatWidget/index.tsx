"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { createSupabaseClient } from "@/lib/supabase";
import { useAdminAccess } from "@/lib/admin";
import type { ChatSource } from "@/lib/chat/types";

interface ViewerSession {
  token: string | null;
  steamId: string | null;
}

type ChatUIMessage = UIMessage<
  never,
  {
    sources: { sources: ChatSource[] };
  }
>;

function messageText(message: ChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function messageSources(message: ChatUIMessage): ChatSource[] {
  for (const part of message.parts) {
    if (part.type === "data-sources") {
      return part.data.sources;
    }
  }
  return [];
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [viewerSession, setViewerSession] = useState<ViewerSession | null>(null);
  const chatbotAccess = useAdminAccess();

  useEffect(() => {
    const supabase = createSupabaseClient();
    if (!supabase) return;

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      const meta = data.session?.user?.user_metadata as
        | { steam_id?: unknown }
        | null
        | undefined;
      const steamId =
        meta && typeof meta.steam_id === "string" ? meta.steam_id : null;
      if (!cancelled) {
        setViewerSession({
          token: data.session?.access_token ?? null,
          steamId,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        headers: viewerSession?.token
          ? { Authorization: `Bearer ${viewerSession.token}` }
          : undefined,
      }),
    [viewerSession?.token],
  );

  const { messages, sendMessage, status, error, stop } = useChat<ChatUIMessage>({
    transport,
  });

  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0 && !busy;

  const handleSubmit = (message: PromptInputMessage) => {
    const trimmed = message.text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
  };

  if (chatbotAccess !== "enabled") return null;

  return (
    <TooltipProvider>
      <div className="fixed right-4 bottom-4 z-[60]">
        {open && (
          <section
            aria-label="Game assistant chat"
            className="absolute right-0 bottom-[calc(100%+0.75rem)] flex h-[min(32rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_16px_40px_rgb(0_0_0/0.35)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-border bg-secondary px-4 py-3">
              <div>
                <h2 className="text-[0.95rem] font-semibold">Game assistant</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Answers may be incomplete or wrong.
                </p>
              </div>
              <button
                type="button"
                className="cursor-pointer bg-transparent text-[1.1rem] leading-none text-muted-foreground"
                aria-label="Close chat"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <Conversation className="min-h-0">
              <ConversationContent
                className={cn(
                  "min-w-0 gap-3 px-4 py-3.5",
                  empty && "min-h-full justify-center",
                )}
              >
                {empty ? (
                  <ConversationEmptyState
                    title="Ask about a synergy"
                    description="How to play a class, or what to build around a unit."
                  />
                ) : (
                  <>
                    {messages.map((message, index) => {
                      const text = messageText(message);
                      const sources = messageSources(message);
                      const streamingThis =
                        busy &&
                        message.role === "assistant" &&
                        index === messages.length - 1;
                      return (
                        <Message from={message.role} key={message.id}>
                          <MessageContent>
                            {message.role === "assistant" ? (
                              text ? (
                                <MessageResponse isAnimating={streamingThis}>
                                  {text}
                                </MessageResponse>
                              ) : streamingThis ? (
                                <span className="text-muted-foreground">
                                  Thinking
                                </span>
                              ) : null
                            ) : (
                              text
                            )}
                          </MessageContent>
                          {sources.length > 0 ? (
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[0.7rem] tracking-wide text-muted-foreground uppercase">
                                Sources
                              </span>
                              {sources.map((source) =>
                                source.urlPath ? (
                                  <Link
                                    key={source.id}
                                    href={source.urlPath}
                                    className="block rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-inherit no-underline hover:border-primary/40"
                                  >
                                    {source.title}
                                    <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">
                                      {(source.similarity * 100).toFixed(0)}% match
                                    </span>
                                  </Link>
                                ) : (
                                  <span
                                    key={source.id}
                                    className="block rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
                                  >
                                    {source.title}
                                  </span>
                                ),
                              )}
                            </div>
                          ) : null}
                        </Message>
                      );
                    })}
                    {busy &&
                    messages[messages.length - 1]?.role !== "assistant" ? (
                      <Message from="assistant">
                        <MessageContent>
                          <span className="text-muted-foreground">Thinking</span>
                        </MessageContent>
                      </Message>
                    ) : null}
                  </>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {error ? (
              <p className="px-3 pt-2 text-xs text-destructive">
                {error.message || "Something went wrong. Try again."}
              </p>
            ) : null}

            <div className="border-t border-border bg-secondary p-3">
              <PromptInput maxFiles={0} onSubmit={handleSubmit}>
                <PromptInputBody>
                  <PromptInputTextarea
                    className="min-h-12 px-3.5 py-[0.7rem] text-left leading-[1.375]"
                    placeholder="How do I play Humans?"
                  />
                </PromptInputBody>
                <PromptInputFooter className="justify-end px-3.5 pt-1 pb-2.5">
                  <PromptInputSubmit onStop={stop} status={status} />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </section>
        )}

        <button
          type="button"
          className="size-[3.25rem] cursor-pointer rounded-full border border-border bg-card text-xl text-foreground shadow-[0_8px_24px_rgb(0_0_0/0.25)]"
          aria-label={open ? "Close game assistant" : "Open game assistant"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          ?
        </button>
      </div>
    </TooltipProvider>
  );
}
