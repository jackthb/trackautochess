import type { UIMessage } from "ai";

export function latestUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }
  return "";
}

export function trimHistory(messages: UIMessage[], maxMessages: number): UIMessage[] {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
}
