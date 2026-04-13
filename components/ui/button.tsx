import { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "outline" | "ghost";
type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent/90",
  outline:
    "border border-border bg-transparent text-foreground hover:bg-surface-secondary",
  ghost: "bg-transparent text-muted hover:bg-surface-secondary",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({ children, className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${className ?? ""}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
