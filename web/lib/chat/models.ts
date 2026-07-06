import { gateway } from "@ai-sdk/gateway";
import {
  CHAT_EMBEDDING_MODEL,
  CHAT_GENERATION_MODEL,
} from "@/lib/chat/config";

export function chatEmbeddingModel() {
  return gateway.embeddingModel(CHAT_EMBEDDING_MODEL);
}

export function chatGenerationModel() {
  return gateway(CHAT_GENERATION_MODEL);
}
