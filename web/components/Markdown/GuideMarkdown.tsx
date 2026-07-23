"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveEntityFromHref } from "@/lib/entityFromHref";
import styles from "./GuideMarkdown.module.css";

interface GuideMarkdownProps {
  children: string;
  className?: string;
}

/** Drop a leading H1 — the page already renders the guide title. */
function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^#\s+[^\n]+\n+/, "");
}

export function GuideMarkdown({ children, className }: GuideMarkdownProps) {
  return (
    <div className={className ? `${styles.prose} ${className}` : styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => {
            const entity = resolveEntityFromHref(href);
            if (entity) {
              return (
                <span className={styles.entityMention}>
                  <span className={styles.entityLinkText}>{label}</span>
                  <Link
                    href={entity.href}
                    className={styles.entityIconLink}
                    title={entity.name}
                    prefetch={false}
                    aria-label={entity.name}
                  >
                    <img
                      src={entity.iconUrl}
                      alt=""
                      className={styles.entityLinkIcon}
                      aria-hidden
                    />
                  </Link>
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            );
          },
        }}
      >
        {stripLeadingTitle(children)}
      </ReactMarkdown>
    </div>
  );
}
