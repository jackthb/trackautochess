import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { KIND_COLOR, KIND_LABEL } from "@/lib/patchKinds";
import {
  EVIDENCE_SOURCE_LABEL,
  type EntityCommentary,
  type PatchEvidence,
} from "@/lib/patchCommentaryTypes";
import styles from "./PatchCommentary.module.css";

/**
 * Attribution byline for editorial commentary. Signals the text is the
 * author's own analysis, not the official (often machine-translated) notes.
 * Rendered per-entry inline on the patch detail page, or once at the top of
 * an entity page's Commentary section.
 */
export function CommentaryByline() {
  return (
    <div className={styles.label}>
      TAC Explained
      <CommentaryInfo />
    </div>
  );
}

/**
 * The bare ⓘ affordance and its popover, without the "TAC Explained" text.
 * Entity pages already head the block with a "Commentary" section title, so
 * they hang this off that heading rather than stacking a second label under it.
 */
export function CommentaryInfo() {
  return (
    <span
      className={styles.info}
      tabIndex={0}
      role="note"
      aria-label="TAC Explained — my own analysis"
    >
      ⓘ
      <span className={styles.tooltip}>
        <span className={styles.tooltipTitle}>TAC Explained</span>
        My own analysis. The official text is often machine-translated; so the
        above is my understanding of the change, usually backed via data
        obtained from the VPK itself.
      </span>
    </span>
  );
}

interface EntryCommentaryProps {
  commentary?: string;
  evidence?: PatchEvidence[];
  /** Show the "TAC Explained" byline above the commentary. Off when a
   *  section-level byline already attributes the whole block (entity pages);
   *  on for standalone inline entries (patch detail page). */
  showByline?: boolean;
}

/**
 * One commentary callout: your take on a change, plus the evidence behind it.
 * Renders nothing when there's neither commentary nor evidence. Used inline on
 * the patch detail page and reused inside the entity-page list below.
 */
export function EntryCommentary({
  commentary,
  evidence,
  showByline = true,
}: EntryCommentaryProps) {
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  if (!commentary && !hasEvidence) return null;

  return (
    <div className={styles.commentary}>
      {commentary && (
        <>
          {showByline && <CommentaryByline />}
          <Markdown className={styles.body}>{commentary}</Markdown>
        </>
      )}
      {hasEvidence && (
        <div className={styles.evidence}>
          <div className={styles.evidenceLabel}>Evidence</div>
          <ul className={styles.evidenceList}>
            {evidence!.map((ev, i) => (
              <li key={i} className={styles.evidenceItem}>
                <span className={styles.evidenceSource}>
                  {EVIDENCE_SOURCE_LABEL[ev.source] ?? ev.source}
                </span>
                {ev.detail && (
                  <Markdown className={styles.evidenceDetail}>
                    {ev.detail}
                  </Markdown>
                )}
                {ev.url && (
                  <a
                    className={styles.evidenceLink}
                    href={ev.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    source
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface EntityCommentaryListProps {
  entries: EntityCommentary[];
}

/**
 * Commentary attached to an entity across patches. Each record links back to
 * the patch it came from and carries the original change line for context.
 */
export function EntityCommentaryList({ entries }: EntityCommentaryListProps) {
  if (entries.length === 0) return null;

  return (
    <div className={styles.list}>
      {entries.map((e) => (
        <div key={`${e.patchSlug}-${e.name}`} className={styles.item}>
          <div className={styles.head}>
            <span className={styles.kind} style={{ color: KIND_COLOR[e.kind] }}>
              {KIND_LABEL[e.kind]}
            </span>
            <Link
              href={`/patch-notes/${e.patchSlug}`}
              prefetch={false}
              className={styles.patchLink}
            >
              {e.patchTitle}
            </Link>
            {e.date && <span className={styles.date}>{e.date}</span>}
          </div>
          {e.detail && <div className={styles.detail}>{e.detail}</div>}
          <EntryCommentary
            commentary={e.commentary}
            evidence={e.evidence}
            showByline={false}
          />
        </div>
      ))}
    </div>
  );
}
