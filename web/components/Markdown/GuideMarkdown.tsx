"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { resolveEntityFromHref } from "@/lib/entityFromHref";
import styles from "./GuideMarkdown.module.css";
import baseStyles from "./Markdown.module.css";

interface GuideMarkdownProps {
  children: string;
  className?: string;
}

export function GuideMarkdown({ children, className }: GuideMarkdownProps) {
  return (
    <div
      className={
        className ? `${baseStyles.markdown} ${className}` : baseStyles.markdown
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
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
        {children}
      </ReactMarkdown>
    </div>
  );
}
