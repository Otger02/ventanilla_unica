import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RichText } from "@/components/ui/rich-text";

type ChatBubbleProps = {
  role: "user" | "assistant";
  content: string;
  onCopy?: () => void;
  onSave?: () => void;
};

function splitAssistantSections(content: string): string[] {
  if (!content.includes("## (")) {
    return [content];
  }

  const sections = content
    .split(/\n(?=## \(\d\))/)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.length > 0 ? sections : [content];
}

export function ChatBubble({ role, content, onCopy, onSave }: ChatBubbleProps) {
  if (role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg bg-blue-600 p-3 text-sm text-white shadow-sm dark:bg-blue-500">
        <p className="whitespace-pre-wrap text-white">{content}</p>
      </div>
    );
  }

  const sections = splitAssistantSections(content);

  return (
    <div className="max-w-[85%] rounded-lg border border-zinc-200 bg-zinc-100 p-4 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Plan recomendado
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
            Copiar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onSave}>
            Guardar
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((section, index) => (
          <div
            key={`assistant-section-${index}`}
            className="rounded-md border border-zinc-200 bg-white/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/60"
          >
            <RichText content={section} dark className="prose-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
