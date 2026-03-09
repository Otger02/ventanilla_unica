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
      <div className="ml-auto max-w-[85%] rounded-lg bg-blue-600 p-3 text-sm text-white shadow-sm dark:bg-gray-800">
        <p className="whitespace-pre-wrap text-white">{content}</p>
      </div>
    );
  }

  const sections = splitAssistantSections(content);

  return (
    <div className="max-w-[85%] rounded-lg border border-gray-200 bg-gray-100 p-4 text-sm text-black dark:border-gray-700 dark:bg-gray-200 dark:text-black">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-600">
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
            className="rounded-md border border-gray-300 bg-white/80 p-3 dark:border-gray-400 dark:bg-white/80"
          >
            <RichText content={section} className="prose-sm text-black" />
          </div>
        ))}
      </div>
    </div>
  );
}
