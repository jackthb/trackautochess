import { embed } from "ai";
import { CHAT_RETRIEVAL_TOP_K } from "@/lib/chat/config";
import { chatEmbeddingModel } from "@/lib/chat/models";
import { createChatSupabaseClient } from "@/lib/chat/supabase";
import type { ContentDocType, MatchedContentDoc } from "@/lib/chat/types";

function asDocType(value: string): ContentDocType {
  if (
    value === "unit" ||
    value === "synergy" ||
    value === "item" ||
    value === "relic" ||
    value === "talent" ||
    value === "patch"
  ) {
    return value;
  }
  throw new Error(`Unknown doc_type from match_content_docs: ${value}`);
}

export async function retrieveContentDocs(
  query: string,
  matchCount = CHAT_RETRIEVAL_TOP_K,
): Promise<MatchedContentDoc[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { embedding } = await embed({
    model: chatEmbeddingModel(),
    value: trimmed,
  });

  const supabase = createChatSupabaseClient();
  const { data, error } = await supabase.rpc("match_content_docs", {
    query_embedding: [...embedding],
    match_count: matchCount,
  });

  if (error) {
    throw new Error(`match_content_docs failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    docType: asDocType(row.doc_type),
    title: row.title,
    content: row.content,
    urlPath: row.url_path,
    similarity: row.similarity,
  }));
}
