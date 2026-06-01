import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import styles from "./Markdown.module.css";

interface MarkdownProps {
  children: string;
  /** Extra class on the wrapper, e.g. to inherit font size from the caller. */
  className?: string;
}

// Author-facing markdown — used for editorial copy we control (patch
// commentary), not untrusted input. react-markdown escapes raw HTML by default,
// so we keep that default rather than enabling rehype-raw. remark-gfm adds
// tables/strikethrough/autolinks; remark-breaks turns a single newline into a
// line break so prose reads the way it's typed.
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={className ? `${styles.markdown} ${className}` : styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
