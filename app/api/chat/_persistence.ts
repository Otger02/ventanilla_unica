import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type StoredMessage } from "./_types";

export async function findOrCreateConversation(
  supabase: SupabaseClient,
  authenticatedUserId: string | null,
  conversationId: string | null,
): Promise<string> {
  if (conversationId) {
    const { data: existingConversation, error: findConversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", authenticatedUserId)
      .maybeSingle();

    if (findConversationError) {
      throw new ApiError(500, "Error consultando la conversacion.");
    }

    if (existingConversation) {
      return existingConversation.id;
    }
  }

  const { data: createdConversation, error: createConversationError } = await supabase
    .from("conversations")
    .insert({ user_id: authenticatedUserId })
    .select("id")
    .single();

  if (createConversationError) {
    throw new ApiError(500, "Error creando la conversacion.");
  }

  return createdConversation.id;
}

export async function fetchMessageHistory(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<StoredMessage[]> {
  const { data: historyData, error: historyError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (historyError) {
    throw new ApiError(500, "Error obteniendo historial de mensajes.");
  }

  return ((historyData ?? []) as StoredMessage[]).reverse();
}

export async function insertUserMessage(
  supabase: SupabaseClient,
  conversationId: string,
  content: string,
  userId: string | null,
): Promise<void> {
  const { error: insertUserMessageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      content,
      user_id: userId,
    });

  if (insertUserMessageError) {
    throw new ApiError(500, "Error guardando el mensaje del usuario.");
  }
}

export async function insertAssistantMessage(
  supabase: SupabaseClient,
  conversationId: string,
  content: string,
  userId: string | null,
): Promise<void> {
  const { error: insertAssistantMessageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      user_id: userId,
    });

  if (insertAssistantMessageError) {
    throw new ApiError(500, "Error guardando el mensaje del asistente.");
  }
}
