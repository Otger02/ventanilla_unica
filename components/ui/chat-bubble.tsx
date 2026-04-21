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
      <div className="ml-auto max-w-[70%] bg-[#E8001C] p-3 text-sm text-white shadow-sm" style={{ borderRadius: "4px" }}>
        <p className="whitespace-pre-wrap text-white">{content}</p>
      </div>
    );
  }

  const sections = splitAssistantSections(content);

  return (
    <div className="max-w-[75%] bg-white p-4 text-sm text-[#111]" style={{ borderRadius: "4px", borderLeft: "3px solid #E8001C", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#E8001C]">
          Asistente · IA
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
            className="bg-[#F5F5F5] p-3"
            style={{ borderRadius: "2px" }}
          >
            <RichText content={section} className="prose-sm text-[#111]" />
          </div>
        ))}
      </div>
    </div>
  );
}
