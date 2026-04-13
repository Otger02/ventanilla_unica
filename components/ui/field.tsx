import { ReactNode } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  prefix?: ReactNode;
  suffix?: ReactNode;
  children: ReactNode;
};

export function Field({ label, hint, error, prefix, suffix, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted">{label}</label>
      <div className="flex items-center gap-2">
        {prefix ? (
          <span className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs text-muted">
            {prefix}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">{children}</div>
        {suffix ? (
          <span className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs text-muted">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
