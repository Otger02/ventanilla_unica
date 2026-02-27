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

type InvoiceProcessDebugPayload = {
  invoiceId: string;
  status: "downloaded" | "needs_ocr" | "processed" | "error";
  textLength?: number;
  textPreview?: string;
  reason?: string;
};

export function logInvoiceProcessDebug(payload: InvoiceProcessDebugPayload) {
  const enabled = process.env.INVOICE_PROCESS_DEBUG === "1";

  if (!enabled) {
    return;
  }

  console.log("[api/invoices/process]", {
    invoice_id: payload.invoiceId,
    status: payload.status,
    text_length: payload.textLength,
    text_preview: payload.textPreview,
    reason: payload.reason,
  });
}
