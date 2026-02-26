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
      <label className="block text-xs text-zinc-600 dark:text-zinc-300">{label}</label>
      <div className="flex items-center gap-2">
        {prefix ? (
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {prefix}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">{children}</div>
        {suffix ? (
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}
