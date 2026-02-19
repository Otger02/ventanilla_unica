"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatClientProps = {
  demoMode: boolean;
  showDemoDebug: boolean;
  demoModeRawEnv: string;
};

const exampleQuestions = [
  "¿Cuánto debo provisionar para impuestos este mes?",
  "¿Qué gastos puedo deducir como independiente?",
  "¿Estoy listo para contratar a alguien?",
  "¿Qué debo tener al día con la DIAN?",
  "¿Cómo organizo mis finanzas este mes?",
  "¿Qué documentos debería guardar?",
];

export function ChatClient({
  demoMode,
  showDemoDebug,
  demoModeRawEnv,
}: ChatClientProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-4 sm:p-6">
      {demoMode ? (
        <div className="rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
          DEMO MODE
        </div>
      ) : null}

      {showDemoDebug ? (
        <div className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100">
          DEMO DEBUG → process.env.DEMO_MODE: {demoModeRawEnv} | demoMode():{" "}
          {String(demoMode)}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Chat</h1>
        {!demoMode ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            disabled={isSigningOut}
          >
            {isSigningOut ? "Cerrando..." : "Cerrar sesion"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Aun no hay mensajes.
          </p>
        ) : (
          <ul className="space-y-3">
            {messages.map((messageItem, index) => (
              <li
                key={`${messageItem.role}-${index}`}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  messageItem.role === "user"
                    ? "ml-auto bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {messageItem.content}
              </li>
            ))}
            {isSending ? (
              <li className="max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                escribiendo...
              </li>
            ) : null}
          </ul>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {exampleQuestions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => void sendMessage(question)}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            disabled={isSending}
          >
            {question}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Escribe tu mensaje..."
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          disabled={isSending}
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          disabled={isSending}
        >
          {isSending ? "Enviando..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}
