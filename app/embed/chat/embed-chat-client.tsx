"use client";

import { FormEvent, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type EmbedChatClientProps = {
  theme: "light" | "dark";
  title?: string;
};

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
            {messages.map((messageItem, index) => (
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
                {messageItem.content}
              </li>
            ))}
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
