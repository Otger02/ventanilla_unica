import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}
