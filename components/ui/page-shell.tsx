import { ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
};

export function PageShell({ children, header, className }: PageShellProps) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 ${className ?? ""}`.trim()}>
      {header ? <div className="mb-4">{header}</div> : null}
      {children}
    </div>
  );
}
