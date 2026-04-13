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
    <div className={`inline-flex rounded-lg border border-border bg-surface p-1 ${className ?? ""}`.trim()}>
      {items.map((item) => {
        const active = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-accent text-white"
                : "text-muted hover:bg-surface-secondary"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
