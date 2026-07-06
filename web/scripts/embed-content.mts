import { embedMany } from "ai";
import { buildContentDocs } from "../lib/chat/buildDocs";
import { chatEmbeddingModel } from "../lib/chat/models";
import { createChatSupabaseClient } from "../lib/chat/supabase";
import type { ContentDoc } from "../lib/chat/types";

const EMBED_BATCH_SIZE = 32;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function estimateEmbeddingCost(docCount: number): string {
  // text-embedding-3-small: ~$0.02 / 1M tokens; rough ~200 tokens/doc here.
  const tokens = docCount * 200;
  const usd = (tokens / 1_000_000) * 0.02;
  return usd < 0.0001 ? "< $0.0001" : `$${usd.toFixed(4)}`;
}

async function loadExistingHashes(): Promise<Map<string, string>> {
  const supabase = createChatSupabaseClient();
  const map = new Map<string, string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("content_embeddings")
      .select("id, content_hash")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to read content_embeddings: ${error.message}`);
    }

    const rows = data ?? [];
    for (const row of rows) {
      map.set(row.id, row.content_hash);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return map;
}

async function upsertDocs(
  docs: ContentDoc[],
  embeddings: number[][],
): Promise<void> {
  const supabase = createChatSupabaseClient();
  const now = new Date().toISOString();
  const rows = docs.map((doc, index) => ({
    id: doc.id,
    doc_type: doc.docType,
    title: doc.title,
    content: doc.content,
    url_path: doc.urlPath,
    content_hash: doc.contentHash,
    embedding: embeddings[index],
    updated_at: now,
  }));

  for (let offset = 0; offset < rows.length; offset += 50) {
    const batch = rows.slice(offset, offset + 50);
    const { error } = await supabase.from("content_embeddings").upsert(batch);
    if (error) {
      throw new Error(`Upsert failed: ${error.message}`);
    }
  }
}

async function main() {
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  requireEnv("AI_GATEWAY_API_KEY");

  const docs = await buildContentDocs();
  const existingHashes = await loadExistingHashes();
  const toEmbed = docs.filter(
    (doc) => existingHashes.get(doc.id) !== doc.contentHash,
  );
  const skipped = docs.length - toEmbed.length;

  console.log(`Content docs: ${docs.length} total, ${toEmbed.length} to embed, ${skipped} unchanged`);

  if (toEmbed.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const model = chatEmbeddingModel();
  let embedded = 0;

  for (let offset = 0; offset < toEmbed.length; offset += EMBED_BATCH_SIZE) {
    const batch = toEmbed.slice(offset, offset + EMBED_BATCH_SIZE);
    const { embeddings } = await embedMany({
      model,
      values: batch.map((doc) => doc.content),
    });
    await upsertDocs(batch, embeddings);
    embedded += batch.length;
    console.log(`Embedded ${embedded}/${toEmbed.length}`);
  }

  console.log(
    `Done. Embedded ${embedded}, skipped ${skipped}. Estimated batch cost: ${estimateEmbeddingCost(embedded)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
