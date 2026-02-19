import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { MAX_MESSAGE_LENGTH } from "@/lib/config";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { logChatRequest } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { ventanillaUnicaSystemPrompt } from "@/lib/ai/systemPrompt";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type OpenAiErrorLike = {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

function isTimeoutError(error: OpenAiErrorLike): boolean {
  const name = error.name?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";
  const status = error.status;

  return (
    name.includes("timeout") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    status === 408
  );
}

function isModelNotFoundError(error: OpenAiErrorLike): boolean {
  const status = error.status;
  const message = error.message?.toLowerCase() ?? "";
  const code = error.code ?? error.error?.code;

  return status === 404 && (message.includes("model") || code === "model_not_found");
}

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request.headers);
    const rateLimit = checkRateLimit(clientIp, 20, 60_000);

    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const body = (await request.json()) as ChatRequestBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        { error: "El campo 'message' es obligatorio." },
        { status: 400 },
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const openAiModel = process.env.OPENAI_MODEL?.trim() || "gpt-5";
    const demoMode = isDemoModeEnabled();
    const allowAnonymousChat = demoMode;
    const messageLength = message.length;

    if (!openAiApiKey) {
      throw new ApiError(500, "Missing OPENAI_API_KEY");
    }

    const openai = new OpenAI({ apiKey: openAiApiKey });

    let authenticatedUserId: string | null = null;

    if (!allowAnonymousChat) {
      const {
        data: { user: authenticatedUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) {
        throw new ApiError(401, "No se pudo validar la sesion del usuario.");
      }

      if (!authenticatedUser) {
        throw new ApiError(401, "Debes iniciar sesion para usar el chat.");
      }

      authenticatedUserId = authenticatedUser.id;
    }

    const userIdForLog = allowAnonymousChat ? null : authenticatedUserId;

    let conversationId = body.conversationId?.trim() || null;

    if (conversationId) {
      let findConversationQuery = supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId);

      if (allowAnonymousChat) {
        findConversationQuery = findConversationQuery.is("user_id", null);
      } else {
        findConversationQuery = findConversationQuery.eq("user_id", authenticatedUserId);
      }

      const { data: existingConversation, error: findConversationError } =
        await findConversationQuery.maybeSingle();

      if (findConversationError) {
        throw new ApiError(500, "Error consultando la conversacion.");
      }

      if (!existingConversation) {
        conversationId = null;
      }
    }

    if (!conversationId) {
      const { data: createdConversation, error: createConversationError } =
        await supabase
          .from("conversations")
          .insert({ user_id: allowAnonymousChat ? null : authenticatedUserId })
          .select("id")
          .single();

      if (createConversationError) {
        throw new ApiError(500, "Error creando la conversacion.");
      }

      conversationId = createdConversation.id;
    }

    const { data: historyData, error: historyError } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (historyError) {
      throw new ApiError(500, "Error obteniendo historial de mensajes.");
    }

    const history = ((historyData ?? []) as StoredMessage[]).reverse();

    const { error: insertUserMessageError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: message,
        user_id: allowAnonymousChat ? null : authenticatedUserId,
      });

    if (insertUserMessageError) {
      throw new ApiError(500, "Error guardando el mensaje del usuario.");
    }

    const contextLines = history.map(
      (item) => `${item.role === "assistant" ? "Asistente" : "Usuario"}: ${item.content}`,
    );
    contextLines.push(`Usuario: ${message}`);

    let reply = "";
    let openAiDurationMs = 0;
    const openAiStart = Date.now();
    const hasOpenAiApiKey = Boolean(openAiApiKey);

    console.info("[api/chat] OpenAI request started", {
      model: openAiModel,
      hasOpenAiApiKey,
    });

    try {
      const aiResponse = await openai.responses.create({
        model: openAiModel,
        input: [
          {
            role: "system",
            content: ventanillaUnicaSystemPrompt,
          },
          {
            role: "user",
            content: `Contexto de conversacion (ultimos 10 mensajes):\n${contextLines.join("\n")}`,
          },
        ],
      });
      openAiDurationMs = Date.now() - openAiStart;

      console.info("[api/chat] OpenAI request completed", {
        model: openAiModel,
        hasOpenAiApiKey,
        openAiDurationMs,
      });

      reply = aiResponse.output_text?.trim() ?? "";
    } catch (error) {
      openAiDurationMs = Date.now() - openAiStart;

      const openAiError = error as OpenAiErrorLike;
      const errorStatus =
        typeof openAiError.status === "number" ? openAiError.status : undefined;

      console.error("[api/chat] OpenAI request failed", {
        model: openAiModel,
        hasOpenAiApiKey,
        openAiDurationMs,
        errorName: openAiError.name,
        errorMessage: openAiError.message,
        errorStatus,
      });

      logChatRequest({
        ip: clientIp,
        userId: userIdForLog,
        messageLength,
        model: openAiModel,
        openAiDurationMs,
      });

      if (isTimeoutError(openAiError)) {
        throw new ApiError(504, "OpenAI timeout");
      }

      if (errorStatus === 401 || errorStatus === 403) {
        throw new ApiError(502, "OpenAI auth error");
      }

      if (isModelNotFoundError(openAiError)) {
        throw new ApiError(502, `Model not found: ${openAiModel}`);
      }

      throw new ApiError(502, "Error generando respuesta con OpenAI.");
    }

    if (!reply) {
      throw new ApiError(502, "OpenAI no devolvio texto de respuesta.");
    }

    const { error: insertAssistantMessageError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: reply,
        user_id: allowAnonymousChat ? null : authenticatedUserId,
      });

    if (insertAssistantMessageError) {
      throw new ApiError(500, "Error guardando el mensaje del asistente.");
    }

    logChatRequest({
      ip: clientIp,
      userId: userIdForLog,
      messageLength,
      model: openAiModel,
      openAiDurationMs,
    });

    return NextResponse.json({
      conversationId,
      reply,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Error interno.";

    return NextResponse.json(
      { error: "No se pudo procesar el chat.", details: message },
      { status: 500 },
    );
  }
}
