"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { createSupabaseClient } from "@/lib/supabase";
import { useChatbotAccess } from "@/lib/betaFeatures";
import type { ChatSource } from "@/lib/chat/types";
import styles from "./ChatWidget.module.css";

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
  const [input, setInput] = useState("");
  const [viewerSession, setViewerSession] = useState<ViewerSession | null>(null);
  const chatbotAccess = useChatbotAccess(viewerSession?.steamId ?? null);

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

  const { messages, sendMessage, status, error } = useChat<ChatUIMessage>({
    transport,
  });

  if (chatbotAccess !== "enabled") return null;

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className={styles.chatRoot}>
      {open && (
        <section className={styles.panel} aria-label="Game assistant chat">
          <header className={styles.header}>
            <div>
              <h2 className={styles.title}>Game assistant</h2>
              <p className={styles.subtitle}>
                Answers from units, synergies, items, relics, and patch notes.
              </p>
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className={styles.messages}>
            {messages.length === 0 ? (
              <p className={styles.empty}>
                Ask about a synergy, relic, or recent patch change.
              </p>
            ) : (
              messages.map((message) => {
                const text = messageText(message);
                const sources = messageSources(message);
                return (
                  <article
                    key={message.id}
                    className={`${styles.message} ${
                      message.role === "user" ? styles.user : styles.assistant
                    }`}
                  >
                    {text ? (
                      <div className={styles.bubble}>
                        {message.role === "assistant" ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {text}
                          </ReactMarkdown>
                        ) : (
                          text
                        )}
                      </div>
                    ) : null}
                    {sources.length > 0 ? (
                      <div className={styles.sources}>
                        <span className={styles.sourcesLabel}>Sources</span>
                        {sources.map((source) =>
                          source.urlPath ? (
                            <Link
                              key={source.id}
                              href={source.urlPath}
                              className={styles.sourceCard}
                            >
                              {source.title}
                              <span className={styles.sourceMeta}>
                                {(source.similarity * 100).toFixed(0)}% match
                              </span>
                            </Link>
                          ) : (
                            <span key={source.id} className={styles.sourceCard}>
                              {source.title}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>

          {error ? (
            <p className={styles.error}>
              {error.message || "Something went wrong. Try again."}
            </p>
          ) : null}

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = input.trim();
              if (!trimmed || busy) return;
              void sendMessage({ text: trimmed });
              setInput("");
            }}
          >
            <input
              className={styles.input}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="How do I play Humans?"
              disabled={busy}
              aria-label="Chat message"
            />
            <button className={styles.send} type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className={styles.toggle}
        aria-label={open ? "Close game assistant" : "Open game assistant"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
    </div>
  );
}
