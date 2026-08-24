"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, HTMLAttributes, JSX, ReactElement } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Streamdown } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

function isInternalHref(href: string | undefined): href is string {
  return Boolean(href?.startsWith("/") && !href.startsWith("//"));
}

type MarkdownProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & {
  node?: unknown;
};

function MarkdownLink({
  href,
  children,
  className,
  node: _node,
  ...props
}: MarkdownProps<"a">) {
  const classes = cn(
    "wrap-anywhere font-medium text-primary underline underline-offset-2",
    className
  );
  if (isInternalHref(href)) {
    return (
      <Link className={classes} href={href}>
        {children}
      </Link>
    );
  }
  return (
    <a
      className={classes}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  );
}

const headingClass =
  "mt-[1em] mb-[0.45em] font-heading font-semibold leading-tight text-foreground first:mt-0";

const markdownComponents = {
  a: MarkdownLink,
  p: ({ node: _node, className, ...props }: MarkdownProps<"p">) => (
    <p className={cn("mb-[0.7em] last:mb-0", className)} {...props} />
  ),
  strong: ({ node: _node, className, ...props }: MarkdownProps<"strong">) => (
    <strong className={cn("font-semibold text-foreground", className)} {...props} />
  ),
  em: ({ node: _node, className, ...props }: MarkdownProps<"em">) => (
    <em className={cn("italic", className)} {...props} />
  ),
  h1: ({ node: _node, className, ...props }: MarkdownProps<"h1">) => (
    <h1 className={cn(headingClass, "text-[1.05rem]", className)} {...props} />
  ),
  h2: ({ node: _node, className, ...props }: MarkdownProps<"h2">) => (
    <h2 className={cn(headingClass, "text-base", className)} {...props} />
  ),
  h3: ({ node: _node, className, ...props }: MarkdownProps<"h3">) => (
    <h3 className={cn(headingClass, "text-[0.95rem]", className)} {...props} />
  ),
  h4: ({ node: _node, className, ...props }: MarkdownProps<"h4">) => (
    <h4 className={cn(headingClass, "text-sm", className)} {...props} />
  ),
  ul: ({ node: _node, className, ...props }: MarkdownProps<"ul">) => (
    <ul
      className={cn("mb-[0.7em] list-disc pl-5 last:mb-0", className)}
      {...props}
    />
  ),
  ol: ({ node: _node, className, ...props }: MarkdownProps<"ol">) => (
    <ol
      className={cn("mb-[0.7em] list-decimal pl-5 last:mb-0", className)}
      {...props}
    />
  ),
  li: ({ node: _node, className, ...props }: MarkdownProps<"li">) => (
    <li className={cn("my-1 [&>p]:my-1", className)} {...props} />
  ),
  code: ({ node: _node, className, ...props }: MarkdownProps<"code">) => (
    <code
      className={cn(
        "rounded border border-border bg-secondary px-1.5 py-0.5 text-[0.92em] [pre_&]:border-0 [pre_&]:bg-transparent [pre_&]:p-0",
        className
      )}
      {...props}
    />
  ),
  pre: ({ node: _node, className, ...props }: MarkdownProps<"pre">) => (
    <pre
      className={cn(
        "mb-[0.7em] overflow-x-auto rounded-lg border border-border bg-secondary px-3 py-2.5 last:mb-0",
        className
      )}
      {...props}
    />
  ),
  blockquote: ({
    node: _node,
    className,
    ...props
  }: MarkdownProps<"blockquote">) => (
    <blockquote
      className={cn(
        "mb-[0.7em] border-l-2 border-border py-1 pl-3 text-muted-foreground last:mb-0",
        className
      )}
      {...props}
    />
  ),
  table: ({ node: _node, className, ...props }: MarkdownProps<"table">) => (
    <table
      className={cn(
        "mb-[0.7em] block max-w-full overflow-x-auto border-collapse text-xs last:mb-0",
        className
      )}
      {...props}
    />
  ),
  th: ({ node: _node, className, ...props }: MarkdownProps<"th">) => (
    <th
      className={cn(
        "border border-border bg-secondary px-2 py-1 text-left align-top font-semibold",
        className
      )}
      {...props}
    />
  ),
  td: ({ node: _node, className, ...props }: MarkdownProps<"td">) => (
    <td
      className={cn(
        "border border-border px-2 py-1 text-left align-top",
        className
      )}
      {...props}
    />
  ),
  hr: ({ node: _node, className, ...props }: MarkdownProps<"hr">) => (
    <hr className={cn("my-3.5 border-border", className)} {...props} />
  ),
};

export const MessageResponse = memo(
  ({
    className,
    components,
    linkSafety,
    ...props
  }: MessageResponseProps) => (
    <Streamdown
      plugins={streamdownPlugins}
      {...props}
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      components={{ ...markdownComponents, ...components }}
      linkSafety={linkSafety ?? { enabled: false }}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
