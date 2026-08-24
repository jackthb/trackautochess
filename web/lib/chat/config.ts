export const CHAT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const CHAT_DEFAULT_GENERATION_MODEL = "alibaba/qwen3.7-flash";
export const CHAT_RETRIEVAL_TOP_K = 8;
export const CHAT_MAX_GUIDE_MATCHES = 1;
export const CHAT_MAX_ENTITY_MATCHES = 3;
export const CHAT_GUIDE_MAX_CHARS = 5000;
export const CHAT_MAX_HISTORY_MESSAGES = 6;
export const CHAT_MAX_OUTPUT_TOKENS = 400;
export const CHAT_RATE_LIMIT_PER_MINUTE = 10;
export const CHAT_DAILY_GLOBAL_CAP = 2000;

type EnvLookup = Record<string, string | undefined>;

export function chatGenerationModelId(env: EnvLookup = process.env): string {
  const override = env.CHAT_GENERATION_MODEL?.trim();
  return override || CHAT_DEFAULT_GENERATION_MODEL;
}
