-- Build review/APIs use the service role for the pending queue and writes.
-- Creating community_builds left service_role without SELECT/INSERT/UPDATE/DELETE,
-- so PostgREST failed with "permission denied for table community_builds".

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_builds TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_build_votes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_build_comments TO service_role;

GRANT SELECT ON TABLE public.community_builds TO anon, authenticated;
GRANT SELECT ON TABLE public.community_build_votes TO anon, authenticated;
GRANT SELECT ON TABLE public.community_build_comments TO anon, authenticated;
