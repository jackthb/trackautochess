import Link from "next/link";
import { Markdown } from "./Markdown";
import { KIND_COLOR, KIND_LABEL } from "@/lib/patchKinds";
import {
  EVIDENCE_SOURCE_LABEL,
  type EntityCommentary,
  type PatchEvidence,
} from "@/lib/patchCommentaryTypes";
import styles from "./PatchCommentary.module.css";

interface EntryCommentaryProps {
  commentary?: string;
  evidence?: PatchEvidence[];
}

/**
 * One commentary callout: your take on a change, plus the evidence behind it.
 * Renders nothing when there's neither commentary nor evidence. Used inline on
 * the patch detail page and reused inside the entity-page list below.
 */
export function EntryCommentary({ commentary, evidence }: EntryCommentaryProps) {
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  if (!commentary && !hasEvidence) return null;

  return (
    <div className={styles.commentary}>
      {commentary && (
        <>
          <div className={styles.label}>Commentary</div>
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
                  <Markdown className={styles.evidenceDetail}>{ev.detail}</Markdown>
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
            <Link href={`/patch-notes/${e.patchSlug}`} className={styles.patchLink}>
              {e.patchTitle}
            </Link>
            {e.date && <span className={styles.date}>{e.date}</span>}
          </div>
          {e.detail && <div className={styles.detail}>{e.detail}</div>}
          <EntryCommentary commentary={e.commentary} evidence={e.evidence} />
        </div>
      ))}
    </div>
  );
}
