import type { MatchedContentDoc } from "@/lib/chat/types";

export function buildChatSystemPrompt(docs: MatchedContentDoc[]): string {
  const context =
    docs.length === 0
      ? "No relevant documents were retrieved."
      : docs
          .map((doc, index) => {
            const link = doc.urlPath ? `Link: ${doc.urlPath}` : "Link: (none)";
            return [
              `--- Document ${index + 1} ---`,
              `Title: ${doc.title}`,
              link,
              doc.content,
            ].join("\n");
          })
          .join("\n\n");

  return [
    "You are a helpful assistant for Track Auto Chess (Dota Auto Chess).",
    "Answer questions using ONLY the retrieved documents below.",
    "If the documents do not contain enough information, say you do not know.",
    "Do not invent game mechanics, units, items, or patch changes.",
    "When referencing an entity that has a link path, include a markdown link using that exact path, e.g. [Human](/synergies/human).",
    "Keep answers concise and practical. Prefer bullet points for lists of units or changes.",
    "",
    "Retrieved documents:",
    context,
  ].join("\n");
}
