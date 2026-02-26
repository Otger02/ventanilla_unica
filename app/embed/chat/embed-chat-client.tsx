"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type EmbedChatClientProps = {
  theme: "light" | "dark";
  title?: string;
};

function formatAssistantMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").trim().split("\n");
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    const headingMatch = trimmedLine.match(/^(?:\((\d)\)|(\d)\))\s*(.+)$/);

    if (headingMatch) {
      const number = headingMatch[1] || headingMatch[2];
      const headingContent = headingMatch[3].trim();
      let headingTitle = headingContent;
      let headingBody: string | null = null;

      if (headingContent.includes(": - ")) {
        const [titlePart, bodyPart] = headingContent.split(": - ", 2);
        headingTitle = titlePart.trim();
        headingBody = `- ${bodyPart.trim()}`;
      } else if (headingContent.includes(": ")) {
        const [titlePart, bodyPart] = headingContent.split(": ", 2);
        headingTitle = titlePart.trim();
        headingBody = bodyPart.trim();
      }

      headingTitle = headingTitle.replace(/:\s*$/, "").trim();

      if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== "") {
        normalizedLines.push("");
      }

      normalizedLines.push(`## (${number}) ${headingTitle}`);

      if (headingBody) {
        if (headingBody.includes(" - ")) {
          headingBody
            .split(" - ")
            .map((item) => item.trim())
            .filter(Boolean)
            .forEach((item) => normalizedLines.push(`- ${item.replace(/^-\s*/, "")}`));
        } else {
          normalizedLines.push(headingBody);
        }
      }

      continue;
    }

    if (trimmedLine.includes(": - ")) {
      const [prefix, suffix] = trimmedLine.split(": - ", 2);
      const items = suffix
        .split(" - ")
        .map((item) => item.trim())
        .filter(Boolean);

      normalizedLines.push(`${prefix}:`);
      items.forEach((item) => normalizedLines.push(`- ${item}`));
      continue;
    }

    const previousLine = normalizedLines[normalizedLines.length - 1] ?? "";
    if (previousLine.startsWith("## ") && trimmedLine.includes(" - ") && !trimmedLine.startsWith("-")) {
      const items = trimmedLine
        .split(" - ")
        .map((item) => item.trim())
        .filter(Boolean);

      items.forEach((item) => normalizedLines.push(`- ${item}`));
      continue;
    }

    normalizedLines.push(trimmedLine);
  }

  let formatted = normalizedLines.join("\n");
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  return formatted.trim();
}

export function EmbedChatClient({ theme, title }: EmbedChatClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const isDark = theme === "dark";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = input.trim();
    if (!message || isSending) {
      return;
    }

    setInput("");
    setIsSending(true);
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          message,
        }),
      });

      if (!response.ok) {
        throw new Error("No se pudo enviar el mensaje");
      }

      const data: { conversationId: string; reply: string } = await response.json();
      setConversationId(data.conversationId);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "Hubo un error procesando tu mensaje. Intenta de nuevo.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div
      className={`flex h-screen flex-col p-3 ${
        isDark ? "bg-zinc-950 text-zinc-100" : "bg-white text-zinc-900"
      }`}
    >
      {title ? <h1 className="pb-2 text-sm font-semibold">{title}</h1> : null}

      <div
        className={`flex-1 overflow-y-auto rounded-md border p-3 ${
          isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-50"
        }`}
      >
        {messages.length === 0 ? (
          <p className={`text-xs ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
            Escribe tu primera consulta.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((messageItem, index) => {
              const renderedContent =
                messageItem.role === "assistant"
                  ? formatAssistantMarkdown(messageItem.content)
                  : messageItem.content;

              return (
              <li
                key={`${messageItem.role}-${index}`}
                className={`max-w-[92%] rounded-md px-2.5 py-2 text-xs ${
                  messageItem.role === "user"
                    ? isDark
                      ? "ml-auto bg-zinc-100 text-zinc-900"
                      : "ml-auto bg-zinc-900 text-white"
                    : isDark
                      ? "bg-zinc-800 text-zinc-100"
                      : "bg-zinc-100 text-zinc-900"
                }`}
              >
                <div
                  className={`max-w-none whitespace-normal prose prose-sm [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_a]:break-all [&_a]:underline ${
                    isDark
                      ? "prose-invert [&_pre]:bg-zinc-950 [&_pre]:text-zinc-100 [&_a]:text-blue-300"
                      : "[&_pre]:bg-zinc-900 [&_pre]:text-zinc-100 [&_a]:text-blue-600"
                  }`}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node: _node, ...props }) => (
                        <a {...props} target="_blank" rel="noreferrer noopener" />
                      ),
                      code: ({ node: _node, className, children, ...props }) => {
                        const isInline = !className;

                        if (isInline) {
                          return (
                            <code
                              {...props}
                              className="rounded bg-zinc-200 px-1 py-0.5 text-[0.9em] text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                            >
                              {children}
                            </code>
                          );
                        }

                        return (
                          <code {...props} className={className}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {renderedContent}
                  </ReactMarkdown>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Escribe..."
          className={`flex-1 rounded-md border px-3 py-2 text-xs outline-none ${
            isDark
              ? "border-zinc-700 bg-zinc-900 text-zinc-100"
              : "border-zinc-300 bg-white text-zinc-900"
          }`}
          disabled={isSending}
        />
        <button
          type="submit"
          className={`rounded-md px-3 py-2 text-xs font-medium ${
            isDark
              ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-300"
              : "bg-zinc-900 text-white hover:bg-zinc-700"
          } disabled:cursor-not-allowed disabled:opacity-60`}
          disabled={isSending}
        >
          {isSending ? "..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}
