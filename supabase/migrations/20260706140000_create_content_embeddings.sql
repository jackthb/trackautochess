-- Content embeddings for the RAG chatbot.
--
-- One row per knowledge document: a game entity (unit/synergy/item/relic/
-- talent) or a patch-note section. Rows are written by the manual ingestion
-- script (web/scripts/embed-content.mts) using the service role, and read by
-- the chat API route via the match_content_docs() function below. Nothing here
-- is exposed to anon/authenticated clients.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS content_embeddings (
    -- Stable doc id, e.g. 'synergy:human', 'unit:lina',
    -- 'patch:2026-06-29-hidden-serendipity:2'.
    id text PRIMARY KEY,
    doc_type text NOT NULL CHECK (
        doc_type IN ('unit', 'synergy', 'item', 'relic', 'talent', 'patch')
    ),
    title text NOT NULL,
    -- The exact chunk of text that was embedded and that gets stuffed into
    -- the LLM prompt when this doc is retrieved.
    content text NOT NULL,
    -- Site path for linking answers back to the source, e.g. '/synergies/human'.
    url_path text,
    -- SHA-256 of content; lets the ingestion script skip unchanged docs.
    content_hash text NOT NULL,
    -- text-embedding-3-small output dimension.
    embedding extensions.vector(1536) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- HNSW beats IVFFlat at this corpus size (~hundreds of rows) because it needs
-- no training step and stays accurate as rows are upserted.
CREATE INDEX IF NOT EXISTS content_embeddings_embedding_idx
    ON content_embeddings
    USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: only the service role (which bypasses RLS) can
-- read or write. The chat route and ingestion script both run server-side.

-- Top-K cosine similarity search. SECURITY DEFINER isn't needed: the chat
-- route calls this with the service role client.
CREATE OR REPLACE FUNCTION match_content_docs(
    query_embedding extensions.vector(1536),
    match_count int DEFAULT 8
)
RETURNS TABLE (
    id text,
    doc_type text,
    title text,
    content text,
    url_path text,
    similarity double precision
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        ce.id,
        ce.doc_type,
        ce.title,
        ce.content,
        ce.url_path,
        -- pgvector's <=> operator returns cosine distance; similarity = 1 - distance.
        1 - (ce.embedding <=> query_embedding) AS similarity
    FROM content_embeddings ce
    ORDER BY ce.embedding <=> query_embedding
    LIMIT match_count;
$$;
