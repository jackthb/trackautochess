import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ElementType,
  ReactNode,
} from "react";

type ButtonVariant = "ghost" | "primary";
type ButtonElement = "button" | "a";

interface BaseButtonProps {
  as?: ButtonElement;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
}

type SharedButtonProps = BaseButtonProps &
  (ButtonHTMLAttributes<HTMLButtonElement> | AnchorHTMLAttributes<HTMLAnchorElement>);

function buttonClass(variant: ButtonVariant, className?: string) {
  return ["ui-button", `ui-button-${variant}`, className].filter(Boolean).join(" ");
}

export function Button({
  as = "button",
  children,
  className,
  variant = "ghost",
  ...props
}: SharedButtonProps) {
  const Component = as as ElementType;
  return (
    <Component className={buttonClass(variant, className)} {...props}>
      {children}
    </Component>
  );
}
