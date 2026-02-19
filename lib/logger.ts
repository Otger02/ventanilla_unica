type ChatRequestLogPayload = {
  ip: string;
  userId: string | null;
  messageLength: number;
  model: string;
  openAiDurationMs: number;
};

export function logChatRequest(payload: ChatRequestLogPayload) {
  console.log("[api/chat]", {
    ip: payload.ip,
    user_id: payload.userId ?? "demo",
    message_length: payload.messageLength,
    model: payload.model,
    openai_duration_ms: payload.openAiDurationMs,
  });
}
