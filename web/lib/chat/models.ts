import { gateway } from "@ai-sdk/gateway";
import {
  CHAT_EMBEDDING_MODEL,
  chatGenerationModelId,
} from "@/lib/chat/config";

export function chatEmbeddingModel() {
  return gateway.embeddingModel(CHAT_EMBEDDING_MODEL);
}

export function chatGenerationModel() {
  return gateway(chatGenerationModelId());
}
