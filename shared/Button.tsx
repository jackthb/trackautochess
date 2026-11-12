import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type ButtonVariant = "ghost" | "primary";

interface BaseButtonProps {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
}

export type SharedButtonProps = BaseButtonProps & (
  | ({ as?: "button" } & ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: "a" } & AnchorHTMLAttributes<HTMLAnchorElement>)
);

function buttonClass(variant: ButtonVariant, className?: string) {
  return ["ui-button", `ui-button-${variant}`, className].filter(Boolean).join(" ");
}

export function Button(props: SharedButtonProps) {
  if (props.as === "a") {
    const { as, children, className, variant = "ghost", ...anchorProps } = props;
    return (
      <a className={buttonClass(variant, className)} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { as, children, className, variant = "ghost", type = "button", ...buttonProps } = props;
  return (
    <button type={type} className={buttonClass(variant, className)} {...buttonProps}>
      {children}
    </button>
  );
}
