-- Community build planner: drafts, moderated public list, votes, comments.
--
-- All writes go through App Router APIs with the service role after session checks.
-- Public/authenticated clients may only SELECT approved builds (and related
-- votes/comments), or an author's own builds of any status.

CREATE TABLE IF NOT EXISTS community_builds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_steam_id bigint NOT NULL REFERENCES users (steam_id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
    upvote_count integer NOT NULL DEFAULT 0 CHECK (upvote_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    reviewed_at timestamptz,
    reviewed_by bigint REFERENCES users (steam_id)
);

CREATE INDEX IF NOT EXISTS community_builds_status_upvotes_idx
    ON community_builds (status, upvote_count DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS community_builds_author_updated_idx
    ON community_builds (author_steam_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS community_build_votes (
    build_id uuid NOT NULL REFERENCES community_builds (id) ON DELETE CASCADE,
    steam_id bigint NOT NULL REFERENCES users (steam_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (build_id, steam_id)
);

CREATE TABLE IF NOT EXISTS community_build_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id uuid NOT NULL REFERENCES community_builds (id) ON DELETE CASCADE,
    author_steam_id bigint NOT NULL REFERENCES users (steam_id),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT community_build_comments_body_len
        CHECK (char_length(body) >= 1 AND char_length(body) <= 2000)
);

CREATE INDEX IF NOT EXISTS community_build_comments_build_created_idx
    ON community_build_comments (build_id, created_at ASC);

ALTER TABLE community_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_build_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_build_comments ENABLE ROW LEVEL SECURITY;

-- Approved builds are public; authors can read their own rows of any status.
DROP POLICY IF EXISTS community_builds_anon_select_approved ON community_builds;
CREATE POLICY community_builds_anon_select_approved ON community_builds
    FOR SELECT TO anon
    USING (status = 'approved');

DROP POLICY IF EXISTS community_builds_auth_select ON community_builds;
CREATE POLICY community_builds_auth_select ON community_builds
    FOR SELECT TO authenticated
    USING (
        status = 'approved'
        OR author_steam_id = NULLIF(
            auth.jwt() -> 'user_metadata' ->> 'steam_id',
            ''
        )::bigint
    );

-- Votes/comments only readable when the parent build is public.
DROP POLICY IF EXISTS community_build_votes_select ON community_build_votes;
CREATE POLICY community_build_votes_select ON community_build_votes
    FOR SELECT TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM community_builds b
            WHERE b.id = build_id
              AND b.status = 'approved'
        )
    );

DROP POLICY IF EXISTS community_build_comments_select ON community_build_comments;
CREATE POLICY community_build_comments_select ON community_build_comments
    FOR SELECT TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM community_builds b
            WHERE b.id = build_id
              AND b.status = 'approved'
        )
    );

GRANT SELECT ON community_builds TO anon, authenticated;
GRANT SELECT ON community_build_votes TO anon, authenticated;
GRANT SELECT ON community_build_comments TO anon, authenticated;
