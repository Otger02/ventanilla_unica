import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { DEBUG_TAX, MAX_MESSAGE_LENGTH } from "@/lib/config";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { logChatRequest } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { getGeminiConfig } from "@/lib/ai/gemini";
import { KB_CFO_SNIPPETS } from "@/lib/kb/cfo-estrategias";
import { getPayablesSummary } from "@/lib/invoices/getPayablesSummary";
import { classifyInvoices, type ReviewQueueItem } from "@/lib/invoices/getReviewQueue";
import { computeWeeklyGoals } from "@/lib/invoices/getWeeklyGoals";
import { computeInactionScenarios } from "@/lib/invoices/getInactionScenarios";
import { applyPreferencesToGoals, DEFAULT_PREFERENCES, type OperatingPreferences } from "@/lib/invoices/applyOperatingPreferences";
import { getReceiptsCounts } from "@/lib/invoices/getReceiptsCounts";
import { getBulkRecommendations } from "@/lib/invoices/getBulkRecommendations";
import { buildPaymentPlan, type WeeklyPaymentPlan } from "@/lib/invoices/getPaymentPlan";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  type ChatRequestBody,
  type StoredMessage,
  type CurrentTaxCalculation,
  type InvoicesPrioritySummary,
  type AiProviderErrorLike,
  ApiError,
  REQUIRED_PROFILE_FIELDS,
  formatCopForPrompt,
} from "./_types";
import { normalizeForIntent, detectTaxIntent, detectFinancialIntent, selectKbSnippets, hardenKbSnippets } from "./_intent";
import { buildProfileSnapshot, getFinancialContextPayload, getCurrentTaxCalculation, fetchAllInvoiceData, fetchTaxProfileString, buildRecommendedActions } from "./_context";
import { buildChatPrompt } from "./_prompt";
import { findOrCreateConversation, fetchMessageHistory, insertUserMessage, insertAssistantMessage } from "./_persistence";

// --- Small helpers that stay local (only used in this file) ---

function isTimeoutError(error: AiProviderErrorLike): boolean {
  const name = error.name?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";
  const status = error.status;
  return name.includes("timeout") || message.includes("timeout") || message.includes("timed out") || status === 408;
}

function isModelNotFoundError(error: AiProviderErrorLike): boolean {
  const status = error.status;
  const message = error.message?.toLowerCase() ?? "";
  const code = error.code ?? error.error?.code;
  return status === 404 || message.includes("not found") || code === "model_not_found";
}

function hashStringValue(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function maskUserId(userId: string | null): string | null {
  if (!userId) return null;
  return userId.slice(0, 8);
}

function getCalcDebugState(
  taxIntentDetected: boolean,
  calcActualPayload: CurrentTaxCalculation | null,
): { calcStatus: "not_applicable" | "ok" | "missing_data" | "error"; errorCode: string | null } {
  if (!taxIntentDetected) return { calcStatus: "not_applicable", errorCode: null };
  if (calcActualPayload?.ok) return { calcStatus: "ok", errorCode: null };
  const reason = calcActualPayload?.reason ?? "unknown";
  const isMissingDataReason = reason === "missing_data" || reason === "missing_profile" || reason === "missing_monthly_input" || reason === "not_authenticated";
  return { calcStatus: isMissingDataReason ? "missing_data" : "error", errorCode: reason };
}

// --- POST handler ---

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request.headers);
    const rateLimit = checkRateLimit(clientIp, 20, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const body = (await request.json()) as ChatRequestBody;
    const message = body.message?.trim() ?? "";
    if (!message) throw new ApiError(400, "Mensaje vacio.");
    if (message.length > MAX_MESSAGE_LENGTH) throw new ApiError(400, `Mensaje demasiado largo (max ${MAX_MESSAGE_LENGTH}).`);

    // TEST_OFFLINE early return
    if (message === "TEST_OFFLINE") {
      return NextResponse.json({ conversationId: "test-offline", reply: "Pong desde route. Gemini NO fue llamado.", recommended_actions: [], bulk_recommendations: [], weekly_plan: null, weekly_goals: null, inaction_summary: null, operating_preferences_active: null });
    }

    const supabase = await createServerSupabaseClient();
    const geminiConfig = getGeminiConfig();
    const geminiApiKey = geminiConfig.apiKey;
    const geminiModel = geminiConfig.model;
    const demoMode = isDemoModeEnabled();
    const allowAnonymousChat = demoMode;
    const messageLength = message.length;

    if (!geminiConfig.hasApiKey) {
      throw new ApiError(500, "Missing Gemini API key. Define GEMINI_API_KEY in .env.local and restart the server.");
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);

    // --- Auth ---
    let authenticatedUserId: string | null = null;
    if (!allowAnonymousChat) {
      const { data: { user: authenticatedUser }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new ApiError(401, "No se pudo validar la sesion del usuario.");
      if (!authenticatedUser) throw new ApiError(401, "Debes iniciar sesion para usar el chat.");
      authenticatedUserId = authenticatedUser.id;
    }

    const userIdForLog = allowAnonymousChat ? null : authenticatedUserId;
    const userIdMaskedForDebug = maskUserId(authenticatedUserId);

    // --- Persistence: conversation + history + save user msg ---
    let conversationId = body.conversationId?.trim() || null;
    let history: StoredMessage[] = [];

    if (!allowAnonymousChat) {
      conversationId = await findOrCreateConversation(supabase, authenticatedUserId, conversationId);
      history = await fetchMessageHistory(supabase, conversationId);
      await insertUserMessage(supabase, conversationId, message, authenticatedUserId);
    } else {
      conversationId = conversationId || crypto.randomUUID();
    }

    const contextLines = history.map((item) => `${item.role === "assistant" ? "Asistente" : "Usuario"}: ${item.content}`);
    const normalizedMessage = normalizeForIntent(message);

    // --- Data fetching ---
    const financialContextPayload = await getFinancialContextPayload(supabase, authenticatedUserId);

    let invoiceData = { pendingInvoicesList: [] as any[], allInvoicesForActions: [] as any[], allInvoicesRaw: [] as any[], dataQualityWarningCount: 0, dataQualityIncompleteCount: 0, dataQualitySuspectCount: 0, vatUsableCop: 0, vatReviewCop: 0, vatBlockedCop: 0, vatUsableCount: 0, vatReviewCount: 0, vatBlockedCount: 0 };
    if (authenticatedUserId) {
      invoiceData = await fetchAllInvoiceData(supabase, authenticatedUserId);
    }

    // --- Intent detection ---
    const taxIntent = detectTaxIntent(message);
    const taxIntentDetected = taxIntent.detected;
    const financialIntent = detectFinancialIntent(normalizedMessage);
    const selectedKbSnippets = financialIntent.enabled ? selectKbSnippets(normalizedMessage, KB_CFO_SNIPPETS, financialIntent.reason) : [];
    const kbSnippetsForModel = hardenKbSnippets(selectedKbSnippets);
    const kbSnippetIdsUsed = kbSnippetsForModel.map((snippet) => snippet.id);

    let calcActualPayload: CurrentTaxCalculation | null = null;
    let invoicesPrioritySummary: InvoicesPrioritySummary | null = null;
    let weeklyPlanPayload: WeeklyPaymentPlan | null = null;

    // --- Review queue ---
    let reviewQueueItems: ReviewQueueItem[] = [];
    if (financialIntent.enabled && authenticatedUserId && invoiceData.allInvoicesRaw.length > 0) {
      const receiptCounts = await getReceiptsCounts(supabase, invoiceData.allInvoicesRaw.map((inv) => inv.id));
      const rq = classifyInvoices(invoiceData.allInvoicesRaw, receiptCounts);
      reviewQueueItems = rq.items;
    }

    // Readiness delta
    let readinessDelta: number | null = null;
    if (financialIntent.enabled && authenticatedUserId) {
      const { data: snapRows } = await supabase.from("readiness_snapshots").select("portfolio_score").eq("user_id", authenticatedUserId).order("created_at", { ascending: false }).limit(2);
      if (snapRows && snapRows.length >= 2) {
        readinessDelta = snapRows[0].portfolio_score - snapRows[1].portfolio_score;
      }
    }

    // Operating preferences
    let operatingPrefs: OperatingPreferences = DEFAULT_PREFERENCES;
    if (authenticatedUserId) {
      const { data: prefsRow } = await supabase.from("user_operating_preferences").select("preferred_action_style, preferred_weekly_focus, preferred_schedule_day, max_weekly_execution_count, preferred_view_mode, notes").eq("user_id", authenticatedUserId).maybeSingle();
      if (prefsRow) operatingPrefs = prefsRow as OperatingPreferences;
    }

    // Operational notes
    let operationalNotes: { target_type: string; target_id: string | null; author_label: string; content: string; created_at: string }[] = [];
    if (authenticatedUserId) {
      const { data: notesRows } = await supabase.from("operational_notes").select("target_type, target_id, author_label, content, created_at").eq("owner_user_id", authenticatedUserId).order("created_at", { ascending: false }).limit(20);
      if (notesRows) operationalNotes = notesRows as typeof operationalNotes;
    }

    // --- Debug log (pre-call) ---
    if (DEBUG_TAX) {
      console.info("[api/chat] Tax debug context", { taxIntentDetected, financialIntentDetected: financialIntent.enabled, financialIntentReason: financialIntent.reason, financialIntentMatchedKeyword: financialIntent.matchedKeyword, kbSnippetIdsUsed, ...getCalcDebugState(taxIntentDetected, calcActualPayload), model: geminiModel, openai_duration_ms: null, user_id: userIdMaskedForDebug });
    }

    // --- Invoices-priority early return ---
    if (financialIntent.reason === "invoices_priority" && authenticatedUserId) {
      invoicesPrioritySummary = await getPayablesSummary({ supabase, userId: authenticatedUserId, topLimit: 10 });
      if ((invoicesPrioritySummary.top_unpaid_invoices ?? []).length === 0) {
        const reply = "¡Felicidades! Estás al día con tus obligaciones";
        if (!allowAnonymousChat) await insertAssistantMessage(supabase, conversationId, reply, authenticatedUserId);
        logChatRequest({ ip: clientIp, userId: userIdForLog, messageLength, model: geminiModel, openAiDurationMs: 0 });
        return NextResponse.json({ conversationId, reply, recommended_actions: [], bulk_recommendations: [], weekly_plan: null, weekly_goals: null, inaction_summary: null, operating_preferences_active: null });
      }
    }

    // --- Tax calculation (conditional) ---
    if (taxIntentDetected) {
      if (!authenticatedUserId) {
        calcActualPayload = { ok: false, error: "No autenticado. Inicia sesión para calcular provisión del mes.", reason: "not_authenticated", profile_snapshot: buildProfileSnapshot(null), missing_fields: [...REQUIRED_PROFILE_FIELDS] };
      } else {
        calcActualPayload = await getCurrentTaxCalculation(supabase, authenticatedUserId, financialContextPayload);
      }
    }

    // --- Weekly plan (if greeting) ---
    if (financialIntent.reason === "greeting_weekly_plan" && reviewQueueItems.length > 0) {
      weeklyPlanPayload = buildPaymentPlan(reviewQueueItems);
    }

    // --- Tax profile string ---
    const taxProfileData = authenticatedUserId ? await fetchTaxProfileString(supabase, authenticatedUserId) : "";

    // --- Build prompt ---
    const fullPrompt = buildChatPrompt({
      contextLines,
      taxProfileData,
      financialContextPayload,
      financialIntent,
      taxIntentDetected,
      pendingInvoicesList: invoiceData.pendingInvoicesList,
      allInvoicesRaw: invoiceData.allInvoicesRaw,
      dataQualityWarningCount: invoiceData.dataQualityWarningCount,
      dataQualityIncompleteCount: invoiceData.dataQualityIncompleteCount,
      dataQualitySuspectCount: invoiceData.dataQualitySuspectCount,
      vatUsableCop: invoiceData.vatUsableCop,
      vatReviewCop: invoiceData.vatReviewCop,
      vatBlockedCop: invoiceData.vatBlockedCop,
      vatUsableCount: invoiceData.vatUsableCount,
      vatReviewCount: invoiceData.vatReviewCount,
      vatBlockedCount: invoiceData.vatBlockedCount,
      reviewQueueItems,
      readinessDelta,
      operatingPrefs,
      operationalNotes,
      kbSnippetsForModel,
      kbSnippetIdsUsed,
      calcActualPayload,
      invoicesPrioritySummary,
      weeklyPlanPayload,
      authenticatedUserId,
    });

    // --- Build Gemini history + call ---
    const baseGeminiHistory = history.map((item: any) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] }));

    const fileParts = [
      process.env.GEMINI_FILE_CALENDARIO_URI,
      process.env.GEMINI_FILE_ESTATUTO_URI,
      process.env.GEMINI_FILE_LEY_REFORMA_URI,
    ]
      .filter((uri): uri is string => !!uri)
      .map((uri) => ({ fileData: { mimeType: "application/pdf" as const, fileUri: uri } }));

    const geminiHistory = [
      { role: "user", parts: [...fileParts, { text: "INSTRUCCIONES Y CONTEXTO INICIAL:\n" + fullPrompt }] },
      { role: "model", parts: [{ text: "Listo. ¿Qué consulta tienes sobre tus cuentas o la normativa?" }] },
      ...baseGeminiHistory,
    ];

    let reply = "";
    let openAiDurationMs = 0;
    const openAiStart = Date.now();

    console.info("[api/chat] Gemini request started", { model: geminiModel, hasGeminiApiKey: Boolean(geminiApiKey) });

    try {
      const model = genAI.getGenerativeModel({ model: geminiModel, systemInstruction: fullPrompt });
      const chat = model.startChat({ history: geminiHistory });
      const result = await chat.sendMessage(message);
      openAiDurationMs = Date.now() - openAiStart;
      console.info("[api/chat] Gemini request completed", { model: geminiModel, openAiDurationMs });

      if (DEBUG_TAX) {
        console.info("[api/chat] Tax debug summary", { taxIntentDetected, financialIntentDetected: financialIntent.enabled, financialIntentReason: financialIntent.reason, financialIntentMatchedKeyword: financialIntent.matchedKeyword, kbSnippetIdsUsed, ...getCalcDebugState(taxIntentDetected, calcActualPayload), model: geminiModel, openai_duration_ms: openAiDurationMs, user_id: userIdMaskedForDebug });
      }

      reply = result.response.text()?.trim() ?? "";
    } catch (error) {
      openAiDurationMs = Date.now() - openAiStart;
      const aiProviderError = error as AiProviderErrorLike;
      console.error("[api/chat] Gemini request failed", { model: geminiModel, openAiDurationMs, errorName: aiProviderError.name, errorMessage: aiProviderError.message, errorStatus: typeof aiProviderError.status === "number" ? aiProviderError.status : undefined });

      if (DEBUG_TAX) {
        console.error("[api/chat] Tax debug summary", { taxIntentDetected, financialIntentDetected: financialIntent.enabled, financialIntentReason: financialIntent.reason, financialIntentMatchedKeyword: financialIntent.matchedKeyword, kbSnippetIdsUsed, ...getCalcDebugState(taxIntentDetected, calcActualPayload), model: geminiModel, openai_duration_ms: openAiDurationMs, user_id: userIdMaskedForDebug });
      }

      logChatRequest({ ip: clientIp, userId: userIdForLog, messageLength, model: geminiModel, openAiDurationMs });

      if (isTimeoutError(aiProviderError)) throw new ApiError(504, "Gemini timeout");
      if (aiProviderError.status === 401 || aiProviderError.status === 403) throw new ApiError(502, "Gemini auth error");
      if (isModelNotFoundError(aiProviderError)) throw new ApiError(502, `Model not found: ${geminiModel}`);
      throw new ApiError(502, "Error generando respuesta con Gemini.");
    }

    if (!reply) throw new ApiError(502, "Gemini no devolvio texto de respuesta.");

    if (DEBUG_TAX) {
      console.info("[api/chat] Assistant message fingerprint", { assistant_message_length: reply.length, assistant_message_hash: hashStringValue(reply) });
    }

    // --- Save assistant message ---
    if (!allowAnonymousChat) {
      await insertAssistantMessage(supabase, conversationId, reply, authenticatedUserId);
    }

    logChatRequest({ ip: clientIp, userId: userIdForLog, messageLength, model: geminiModel, openAiDurationMs });

    // --- Build response ---
    const recommendedActions = buildRecommendedActions(invoiceData.allInvoicesForActions, financialIntent.enabled, reviewQueueItems);
    const bulkRecommendations = financialIntent.enabled ? getBulkRecommendations(reviewQueueItems) : [];
    const responseGoals = reviewQueueItems.length > 0
      ? (() => { const g = computeWeeklyGoals(reviewQueueItems); return { ...g, goals: applyPreferencesToGoals(g.goals, operatingPrefs) }; })()
      : null;

    return NextResponse.json({
      conversationId,
      reply,
      recommended_actions: recommendedActions,
      bulk_recommendations: bulkRecommendations,
      weekly_plan: weeklyPlanPayload,
      weekly_goals: responseGoals,
      inaction_summary: reviewQueueItems.length > 0 ? computeInactionScenarios(reviewQueueItems, weeklyPlanPayload, responseGoals) : null,
      operating_preferences_active: operatingPrefs.preferred_view_mode !== "owner" || operatingPrefs.preferred_action_style !== "balanced" || operatingPrefs.preferred_weekly_focus
        ? { style: operatingPrefs.preferred_action_style, focus: operatingPrefs.preferred_weekly_focus, view_mode: operatingPrefs.preferred_view_mode }
        : null,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Error interno.";
    return NextResponse.json({ error: "No se pudo procesar el chat.", details: message }, { status: 500 });
  }
}
