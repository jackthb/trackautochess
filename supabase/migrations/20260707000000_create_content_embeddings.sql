-- Content embeddings for the RAG chatbot.
--
-- Split out from 20260706140000 so pgvector setup cannot block match-upload
-- repair migrations that must land first on the linked Supabase project.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS content_embeddings (
    id text PRIMARY KEY,
    doc_type text NOT NULL CHECK (
        doc_type IN ('unit', 'synergy', 'item', 'relic', 'talent', 'patch')
    ),
    title text NOT NULL,
    content text NOT NULL,
    url_path text,
    content_hash text NOT NULL,
    embedding extensions.vector(1536) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_embeddings_embedding_idx
    ON content_embeddings
    USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;

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
        1 - (ce.embedding <=> query_embedding) AS similarity
    FROM content_embeddings ce
    ORDER BY ce.embedding <=> query_embedding
    LIMIT match_count;
$$;
