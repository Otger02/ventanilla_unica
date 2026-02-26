import { ReactNode } from "react";

type TabItem = {
  value: string;
  label: string;
};

type TabsProps = {
  value: string;
  onChange: (value: string) => void;
  items: TabItem[];
  className?: string;
};

export function Tabs({ value, onChange, items, className }: TabsProps) {
  return (
    <div className={`inline-flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900 ${className ?? ""}`.trim()}>
      {items.map((item) => {
        const active = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
