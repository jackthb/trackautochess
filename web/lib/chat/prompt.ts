import type { MatchedContentDoc } from "@/lib/chat/types";

const CHAT_IDENTITY = [
  "You are a helpful assistant for Track Auto Chess (trackautochess.com).",
  "Track Auto Chess is a companion site for Dota Auto Chess, the Dota 2 Auto Chess mod by Drodo Studio.",
  "Help players with synergies, units, items, relics, talents, and how to play a given lineup.",
  "Use markdown. Do not use emoji.",
].join("\n");

function formatDocs(docs: MatchedContentDoc[]): string {
  if (docs.length === 0) return "No relevant documents were retrieved.";
  return docs
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
}

export function buildGenericChatSystemPrompt(): string {
  return [
    CHAT_IDENTITY,
    "When you do not have retrieved game documents, answer from general knowledge of Dota Auto Chess.",
    "Keep answers concise and practical. Prefer bullet points for lists of units or build ideas.",
    "If you are unsure, say so. Do not invent patch dates, exact numbers, or claim official sources you do not have.",
    "Do not present guesses as facts. When a detail may be outdated, say that it might have changed.",
  ].join("\n");
}

export function buildRagChatSystemPrompt(docs: MatchedContentDoc[]): string {
  return [
    CHAT_IDENTITY,
    "Answer questions using ONLY the retrieved documents below.",
    "If the documents do not contain enough information, say you do not know.",
    "Do not invent game mechanics, units, items, or patch changes.",
    "When referencing an entity that has a link path, include a markdown link using that exact path, e.g. [Human](/synergies/human).",
    "Keep answers concise and practical. Prefer bullet points for lists of units or changes.",
    "",
    "Retrieved documents:",
    formatDocs(docs),
  ].join("\n");
}

export function buildGroundedChatSystemPrompt(docs: MatchedContentDoc[]): string {
  return [
    CHAT_IDENTITY,
    "Documents below are ordered: build guides, then synergies, then entities (units, items, relics, talents).",
    "Build the answer from all of them. Prefer a matched guide for how to play the lineup.",
    "Use synergy documents for trait mechanics, tiers, and which units belong to them.",
    "Use entity documents for a named unit, item, relic, or talent.",
    "Do not invent units, synergy tiers, bonus numbers, or guide advice that is not in the documents.",
    "When referencing an entity that has a link path, include a markdown link using that exact path, e.g. [Human](/synergies/human) or [9 Hunters](/guides/9-hunters).",
    "Keep answers concise and practical. Prefer bullet points for lists of units or build ideas.",
    "",
    "Retrieved documents:",
    formatDocs(docs),
  ].join("\n");
}

export function buildChatSystemPrompt(options: {
  ragEnabled?: boolean;
  docs?: MatchedContentDoc[];
}): string {
  if (options.docs && options.docs.length > 0) {
    return buildGroundedChatSystemPrompt(options.docs);
  }
  if (options.ragEnabled) {
    return buildRagChatSystemPrompt(options.docs ?? []);
  }
  return buildGenericChatSystemPrompt();
}
