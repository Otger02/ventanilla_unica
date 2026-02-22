import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { DEBUG_TAX, MAX_MESSAGE_LENGTH } from "@/lib/config";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { logChatRequest } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { ventanillaUnicaSystemPrompt } from "@/lib/ai/systemPrompt";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { calculateMonthlyProvisionCO } from "@/lib/tax/calculators/colombia/monthlyProvision";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type UserTaxProfileRow = {
  persona_type: "natural" | "juridica" | "unknown";
  taxpayer_type: "natural" | "juridica" | "individual" | "company" | "unknown";
  regimen: "simple" | "ordinario" | "unknown";
  vat_responsible: "yes" | "no" | "unknown";
  vat_periodicity:
    | "monthly"
    | "bimonthly"
    | "quarterly"
    | "annual"
    | "bimestral"
    | "cuatrimestral"
    | "anual"
    | "not_applicable"
    | "unknown";
  monthly_fixed_costs_cop: number;
  monthly_payroll_cop: number;
  monthly_debt_payments_cop: number;
  provision_style: "conservative" | "balanced" | "aggressive";
  municipality: string | null;
};

type MonthlyTaxInputRow = {
  year: number;
  month: number;
  income_cop: number;
  deductible_expenses_cop: number;
  withholdings_cop: number;
  vat_collected_cop: number;
};

type CurrentTaxCalculation =
  | {
      ok: true;
      period: {
        year: number;
        month: number;
      };
      profile: {
        persona_type: "natural" | "juridica" | "unknown";
        taxpayer_type: "natural" | "juridica" | "individual" | "company" | "unknown";
        regimen: "simple" | "ordinario" | "unknown";
        vat_responsible: "yes" | "no" | "unknown";
        vat_periodicity:
          | "monthly"
          | "bimonthly"
          | "quarterly"
          | "annual"
          | "bimestral"
          | "cuatrimestral"
          | "anual"
          | "not_applicable"
          | "unknown";
        monthly_fixed_costs_cop: number;
        monthly_payroll_cop: number;
        monthly_debt_payments_cop: number;
        provision_style: "conservative" | "balanced" | "aggressive";
        municipality: string | null;
      };
      profile_snapshot: {
        taxpayer_type: "natural" | "juridica" | "individual" | "company" | "unknown";
        regimen: "simple" | "ordinario" | "unknown";
        vat_responsible: "yes" | "no" | "unknown";
        vat_periodicity:
          | "monthly"
          | "bimonthly"
          | "quarterly"
          | "annual"
          | "bimestral"
          | "cuatrimestral"
          | "anual"
          | "not_applicable"
          | "unknown";
        monthly_fixed_costs_cop: number;
        monthly_payroll_cop: number;
        monthly_debt_payments_cop: number;
      };
      missing_fields: string[];
      inputs: {
        income_cop: number;
        deductible_expenses_cop: number;
        withholdings_cop: number;
        vat_collected_cop: number;
      };
      breakdown: {
        ivaProvision: number;
        base: number;
        rentaProvision: number;
        totalProvision: number;
        riskLevel: "high" | "medium" | "low";
      };
    }
  | {
      ok: false;
      error: string;
      reason: "not_authenticated" | "missing_profile" | "missing_monthly_input" | "calculation_error";
      period?: {
        year: number;
        month: number;
      };
      profile_snapshot?: {
        taxpayer_type: "natural" | "juridica" | "individual" | "company" | "unknown";
        regimen: "simple" | "ordinario" | "unknown";
        vat_responsible: "yes" | "no" | "unknown";
        vat_periodicity:
          | "monthly"
          | "bimonthly"
          | "quarterly"
          | "annual"
          | "bimestral"
          | "cuatrimestral"
          | "anual"
          | "not_applicable"
          | "unknown";
        monthly_fixed_costs_cop: number;
        monthly_payroll_cop: number;
        monthly_debt_payments_cop: number;
      };
      missing_fields?: string[];
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

const TAX_INTENT_KEYWORDS = [
  "impuestos",
  "pagar",
  "provision",
  "este mes",
  "iva",
  "renta",
  "contratar",
  "nomina",
  "empleado",
  "empleados",
  "cuotas",
  "deuda",
  "contribuyente",
  "gastos fijos",
  "pago en cuotas",
  "no pagar de golpe",
];

const REQUIRED_PROFILE_FIELDS = [
  "taxpayer_type",
  "regimen",
  "vat_responsible",
  "vat_periodicity",
  "monthly_fixed_costs_cop",
  "monthly_payroll_cop",
  "monthly_debt_payments_cop",
] as const;

type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

const KB_RESUMEN = {
  impuestos_basicos: [
    "Los negocios pequeños en Colombia suelen gestionar renta, IVA (si aplica), retenciones y facturación electrónica.",
    "Error común: no provisionar impuestos mes a mes.",
    "Rango orientativo no obligatorio para provisión: 10%–25% de ingresos en freelancers/servicios.",
    "El IVA cobrado no es ingreso del negocio; es un valor a trasladar al Estado.",
  ],
  salud_financiera: [
    "Facturar no equivale a tener caja disponible.",
    "Conviene provisionar impuestos, gastos fijos y emergencias cada mes.",
    "Semáforo: verde (estabilidad y provisiones), amarillo (flujo irregular), rojo (sin provisiones y alto riesgo).",
    "Checklist mensual: ingresos, gastos, provisión de impuestos, flujo de caja y estado financiero.",
  ],
};

function normalizeForIntent(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasTaxIntent(message: string): boolean {
  const normalizedMessage = normalizeForIntent(message);
  return TAX_INTENT_KEYWORDS.some((keyword) => normalizedMessage.includes(keyword));
}

function buildProfileSnapshot(profileData: UserTaxProfileRow | null) {
  return {
    taxpayer_type: profileData?.taxpayer_type ?? "unknown",
    regimen: profileData?.regimen ?? "unknown",
    vat_responsible: profileData?.vat_responsible ?? "unknown",
    vat_periodicity: profileData?.vat_periodicity ?? "unknown",
    monthly_fixed_costs_cop: profileData?.monthly_fixed_costs_cop ?? 0,
    monthly_payroll_cop: profileData?.monthly_payroll_cop ?? 0,
    monthly_debt_payments_cop: profileData?.monthly_debt_payments_cop ?? 0,
  };
}

function getMissingProfileFields(profileSnapshot: ReturnType<typeof buildProfileSnapshot>) {
  const missingFields: RequiredProfileField[] = [];

  if (profileSnapshot.taxpayer_type === "unknown") {
    missingFields.push("taxpayer_type");
  }

  if (profileSnapshot.regimen === "unknown") {
    missingFields.push("regimen");
  }

  if (profileSnapshot.vat_responsible === "unknown") {
    missingFields.push("vat_responsible");
  }

  if (profileSnapshot.vat_periodicity === "unknown") {
    missingFields.push("vat_periodicity");
  }

  if (profileSnapshot.monthly_fixed_costs_cop <= 0) {
    missingFields.push("monthly_fixed_costs_cop");
  }

  if (profileSnapshot.monthly_payroll_cop <= 0) {
    missingFields.push("monthly_payroll_cop");
  }

  if (profileSnapshot.monthly_debt_payments_cop <= 0) {
    missingFields.push("monthly_debt_payments_cop");
  }

  return missingFields;
}

function maskUserId(userId: string | null): string | null {
  if (!userId) {
    return null;
  }

  return userId.slice(0, 8);
}

async function getCurrentTaxCalculation(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<CurrentTaxCalculation> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: profileData, error: profileError } = await supabase
    .from("user_tax_profile_co")
    .select(
      "persona_type, taxpayer_type, regimen, vat_responsible, vat_periodicity, monthly_fixed_costs_cop, monthly_payroll_cop, monthly_debt_payments_cop, provision_style, municipality",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      error: "No se pudo obtener el perfil fiscal.",
      reason: "missing_profile",
      period: { year, month },
      profile_snapshot: buildProfileSnapshot(null),
      missing_fields: [...REQUIRED_PROFILE_FIELDS],
    };
  }

  if (!profileData) {
    return {
      ok: false,
      error: "Falta perfil fiscal. Guarda tu perfil antes de estimar.",
      reason: "missing_profile",
      period: { year, month },
      profile_snapshot: buildProfileSnapshot(null),
      missing_fields: [...REQUIRED_PROFILE_FIELDS],
    };
  }

  const profile = profileData as UserTaxProfileRow;
  const profileSnapshot = buildProfileSnapshot(profile);
  const missingFields = getMissingProfileFields(profileSnapshot);

  const { data: monthlyInputData, error: monthlyInputError } = await supabase
    .from("monthly_tax_inputs_co")
    .select(
      "year, month, income_cop, deductible_expenses_cop, withholdings_cop, vat_collected_cop",
    )
    .eq("user_id", userId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (monthlyInputError) {
    return {
      ok: false,
      error: "No se pudo obtener el input mensual.",
      reason: "missing_monthly_input",
      period: { year, month },
      profile_snapshot: profileSnapshot,
      missing_fields: missingFields,
    };
  }

  if (!monthlyInputData) {
    return {
      ok: false,
      error: "Faltan datos del mes actual. Guarda ingresos/gastos del mes antes de estimar.",
      reason: "missing_monthly_input",
      period: { year, month },
      profile_snapshot: profileSnapshot,
      missing_fields: missingFields,
    };
  }

  const inputs = monthlyInputData as MonthlyTaxInputRow;
  let result: ReturnType<typeof calculateMonthlyProvisionCO>;

  try {
    result = calculateMonthlyProvisionCO(profile, inputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cálculo no disponible";
    return {
      ok: false,
      error: message,
      reason: "calculation_error",
      period: { year, month },
      profile_snapshot: profileSnapshot,
      missing_fields: missingFields,
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      reason: "calculation_error",
      period: { year, month },
      profile_snapshot: profileSnapshot,
      missing_fields: missingFields,
    };
  }

  return {
    ok: true,
    period: { year, month },
    profile: {
      persona_type: profile.persona_type,
      taxpayer_type: profile.taxpayer_type,
      regimen: profile.regimen,
      vat_responsible: profile.vat_responsible,
      vat_periodicity: profile.vat_periodicity,
      monthly_fixed_costs_cop: profile.monthly_fixed_costs_cop,
      monthly_payroll_cop: profile.monthly_payroll_cop,
      monthly_debt_payments_cop: profile.monthly_debt_payments_cop,
      provision_style: profile.provision_style,
      municipality: profile.municipality,
    },
    profile_snapshot: profileSnapshot,
    missing_fields: missingFields,
    inputs: {
      income_cop: inputs.income_cop,
      deductible_expenses_cop: inputs.deductible_expenses_cop,
      withholdings_cop: inputs.withholdings_cop,
      vat_collected_cop: inputs.vat_collected_cop,
    },
    breakdown: result.breakdown,
  };
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
    const userIdMaskedForDebug = maskUserId(authenticatedUserId);

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

    const taxIntentDetected = hasTaxIntent(message);
    let calcActualPayload: CurrentTaxCalculation | null = null;

    if (taxIntentDetected) {
      if (!authenticatedUserId) {
        calcActualPayload = {
          ok: false,
          error: "No autenticado. Inicia sesión para calcular provisión del mes.",
          reason: "not_authenticated",
          profile_snapshot: buildProfileSnapshot(null),
          missing_fields: [...REQUIRED_PROFILE_FIELDS],
        };
      } else {
        calcActualPayload = await getCurrentTaxCalculation(supabase, authenticatedUserId);
      }
    }

    if (DEBUG_TAX) {
      const calcStatus = !taxIntentDetected
        ? "not_applicable"
        : calcActualPayload?.ok
          ? "ok"
          : "error";
      const errorCode = !taxIntentDetected
        ? null
        : calcActualPayload?.ok
          ? null
          : calcActualPayload?.reason ?? "unknown";

      console.info("[api/chat] Tax debug context", {
        taxIntentDetected,
        calcStatus,
        errorCode,
        model: openAiModel,
        openai_duration_ms: null,
        user_id: userIdMaskedForDebug,
      });
    }

    const promptSections = [
      `Contexto de conversacion (ultimos 10 mensajes):\n${contextLines.join("\n")}`,
    ];

    if (taxIntentDetected) {
      const calcActualJson = JSON.stringify(calcActualPayload, null, 2);
      const kbResumenJson = JSON.stringify(KB_RESUMEN, null, 2);

      promptSections.push(
        [
          "CALCULO_ACTUAL:",
          calcActualJson,
          "PROFILE_SNAPSHOT:",
          JSON.stringify(calcActualPayload?.profile_snapshot ?? buildProfileSnapshot(null), null, 2),
          "missing_fields:",
          JSON.stringify(calcActualPayload?.missing_fields ?? [...REQUIRED_PROFILE_FIELDS]),
          "KB_RESUMEN:",
          kbResumenJson,
          "INSTRUCCION_FISCAL:",
          "Si CALCULO_ACTUAL.ok=true, primero responde con lo que ya sabes en lenguaje simple y luego sugiere próximos pasos concretos.",
          "Si CALCULO_ACTUAL.ok=false, continúa en modo best-effort: responde con lo que sí se puede inferir y no inventes cifras.",
          "Si falta información clave del perfil (taxpayer_type, regimen, vat_responsible, vat_periodicity, monthly_fixed_costs_cop, monthly_payroll_cop, monthly_debt_payments_cop), NO inventes.",
          "Usa missing_fields para decidir qué pedir y solicita exactamente 1-2 datos máximos con opciones cerradas cuando sea posible.",
          "Flujo de respuesta: (1) lo que se sabe, (2) exactamente la pregunta mínima faltante.",
          "Ejemplo contratar: pide costo mensual total de contratación (salario + prestaciones + parafiscales) y confirma el valor de gastos fijos mensuales.",
          "Ejemplo pago en cuotas/no pagar de golpe: pide monto total, fecha límite, y si puede pagar algo hoy.",
          "Si piden estrategias de pago, ofrece solo opciones legales: acuerdo de pago con la autoridad, programar transferencias, separar fondos en cuenta aparte, priorizar obligaciones por vencimiento e impacto.",
          "No des pasos ilegales ni sugerencias de evasión.",
        ].join("\n"),
      );
    }

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
            content: promptSections.join("\n\n"),
          },
        ],
      });
      openAiDurationMs = Date.now() - openAiStart;

      console.info("[api/chat] OpenAI request completed", {
        model: openAiModel,
        hasOpenAiApiKey,
        openAiDurationMs,
      });

      if (DEBUG_TAX) {
        const calcStatus = !taxIntentDetected
          ? "not_applicable"
          : calcActualPayload?.ok
            ? "ok"
            : "error";
        const errorCode = !taxIntentDetected
          ? null
          : calcActualPayload?.ok
            ? null
            : calcActualPayload?.reason ?? "unknown";

        console.info("[api/chat] Tax debug summary", {
          taxIntentDetected,
          calcStatus,
          errorCode,
          model: openAiModel,
          openai_duration_ms: openAiDurationMs,
          user_id: userIdMaskedForDebug,
        });
      }

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

      if (DEBUG_TAX) {
        const calcStatus = !taxIntentDetected
          ? "not_applicable"
          : calcActualPayload?.ok
            ? "ok"
            : "error";
        const errorCode = !taxIntentDetected
          ? null
          : calcActualPayload?.ok
            ? null
            : calcActualPayload?.reason ?? "unknown";

        console.error("[api/chat] Tax debug summary", {
          taxIntentDetected,
          calcStatus,
          errorCode,
          model: openAiModel,
          openai_duration_ms: openAiDurationMs,
          user_id: userIdMaskedForDebug,
        });
      }

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
