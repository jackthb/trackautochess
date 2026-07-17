"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SteamSignInButton } from "@/components/SteamSignInButton";
import {
  fetchBuildComments,
  fetchBuildDetail,
  postBuildComment,
  toggleBuildVote,
} from "@/lib/builds/client";
import type {
  CommunityBuildComment,
  CommunityBuildDetail,
} from "@/lib/builds/types";
import { useSupabaseSession } from "@/lib/useSupabaseSession";
import { BuildBoardPreview, BuildSnapshotTabs } from "../BuildBoardPreview";
import styles from "../builds.module.css";

export function BuildDetailClient({ buildId }: { buildId: string }) {
  const { steamId, accessToken, ready } = useSupabaseSession();
  const [build, setBuild] = useState<CommunityBuildDetail | null>(null);
  const [comments, setComments] = useState<CommunityBuildComment[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setError("");
    void Promise.all([
      fetchBuildDetail(buildId, accessToken),
      fetchBuildComments(buildId),
    ])
      .then(([detail, nextComments]) => {
        if (cancelled) return;
        setBuild(detail);
        setComments(nextComments);
        setActiveSnapshotId(detail.payload.snapshots[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load build");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildId, ready, accessToken]);

  const snapshot =
    build?.payload.snapshots.find((snap) => snap.id === activeSnapshotId) ??
    build?.payload.snapshots[0] ??
    null;

  const handleVote = async () => {
    if (!accessToken || !build) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await toggleBuildVote(build.id, accessToken);
      setBuild({
        ...build,
        upvoteCount: result.upvoteCount,
        viewerHasVoted: result.viewerHasVoted,
      });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  };

  const handleComment = async () => {
    if (!accessToken || !build) return;
    setBusy(true);
    setStatus("");
    try {
      const comment = await postBuildComment(build.id, commentBody, accessToken);
      setComments((current) => [...current, comment]);
      setCommentBody("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Comment failed");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className={styles.detailLayout}>
        <p>{error}</p>
        <Link href="/builds" className={styles.pageTab}>
          Back to builds
        </Link>
      </div>
    );
  }

  if (!build || !snapshot) {
    return <p className={styles.signInHint}>Loading build…</p>;
  }

  return (
    <div className={styles.detailLayout}>
      <div className={styles.detailHeader}>
        <Link href="/builds" className={styles.pageTab}>
          ← Public builds
        </Link>
        <h2 style={{ margin: 0 }}>{build.name}</h2>
        {build.description && <p style={{ margin: 0 }}>{build.description}</p>}
        <div className={styles.publicMeta}>
          <span>By {build.authorName || build.authorSteamId}</span>
          <span>{build.upvoteCount} upvotes</span>
        </div>
        <div className={styles.detailActions}>
          {steamId ? (
            <button
              type="button"
              className={`${styles.upvoteButton} ${
                build.viewerHasVoted ? styles.upvoteButtonActive : ""
              }`}
              onClick={handleVote}
              disabled={busy}
            >
              {build.viewerHasVoted ? "Remove upvote" : "Upvote"}
            </button>
          ) : (
            <div className={styles.signInHint}>
              <span>Sign in to upvote or comment.</span>
              <SteamSignInButton source="build_detail" size="sm" />
            </div>
          )}
          {status && <span className={styles.shareStatus}>{status}</span>}
        </div>
      </div>

      <BuildSnapshotTabs
        build={build.payload}
        activeSnapshotId={snapshot.id}
        onSelect={setActiveSnapshotId}
      />
      {snapshot.focusNote && <p className={styles.publicMeta}>{snapshot.focusNote}</p>}
      <BuildBoardPreview snapshot={snapshot} />

      <section className={styles.commentsSection}>
        <h3 style={{ margin: 0 }}>Comments</h3>
        <div className={styles.commentList}>
          {comments.length === 0 && (
            <p className={styles.publicMeta}>No comments yet.</p>
          )}
          {comments.map((comment) => (
            <div key={comment.id} className={styles.commentItem}>
              <div className={styles.commentMeta}>
                {comment.authorName || comment.authorSteamId} ·{" "}
                {new Date(comment.createdAt).toLocaleString()}
              </div>
              <div>{comment.body}</div>
            </div>
          ))}
        </div>
        {steamId && (
          <div className={styles.commentForm}>
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Share a tip or ask a question"
              maxLength={2000}
            />
            <button
              type="button"
              className={styles.smallButton}
              onClick={handleComment}
              disabled={busy || !commentBody.trim()}
            >
              Post comment
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
