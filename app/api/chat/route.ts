import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { DEBUG_TAX, MAX_MESSAGE_LENGTH } from "@/lib/config";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { logChatRequest } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { ventanillaUnicaSystemPrompt } from "@/lib/ai/systemPrompt";
import { KB_CFO_SNIPPETS } from "@/lib/kb/cfo-estrategias";
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

type FinancialContextPayload = {
  period: {
    year: number;
    month: number;
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
    provision_style: "conservative" | "balanced" | "aggressive";
    monthly_fixed_costs_cop: number;
    monthly_payroll_cop: number;
    monthly_debt_payments_cop: number;
    municipality: string | null;
  };
  monthly_inputs: {
    income_cop: number;
    deductible_expenses_cop: number;
    withholdings_cop: number;
    vat_collected_cop: number;
  } | null;
  fallback_monthly_inputs: {
    period: {
      year: number;
      month: number;
    };
    inputs: {
      income_cop: number;
      deductible_expenses_cop: number;
      withholdings_cop: number;
      vat_collected_cop: number;
    };
  } | null;
  monthly_inputs_status:
    | "ok"
    | "fallback_used"
    | "no_data_at_all"
    | "not_authenticated"
    | "monthly_inputs_query_error";
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
        ivaProvision?: number;
        base?: number;
        rentaProvision?: number;
        totalProvision?: number;
        riskLevel?: "high" | "medium" | "low";
        iva_to_separate?: number;
        ingreso_base_sin_iva?: number;
        utilidad_estimada?: number;
        renta_bruta_estimada?: number;
        renta_neta_estimada?: number;
        total_provision_mvp?: number;
        method?: string;
        notes?: string;
      };
    }
  | {
      ok: false;
      error: string;
      reason:
        | "not_authenticated"
        | "missing_profile"
        | "missing_monthly_input"
        | "missing_data"
        | "calculation_error"
        | "internal_error";
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
  "provision",
  "provisionar",
  "separar",
  "apartar",
  "dian",
  "declaracion",
  "retencion",
  "renta",
  "iva",
  "impuestos",
  "pagar impuestos",
  "este mes",
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

const HARD_TAX_TRIGGERS = ["impuestos", "iva", "dian"] as const;

const FINANCIAL_INTENT_KEYWORDS = [
  "impuestos",
  "iva",
  "dian",
  "renta",
  "retencion",
  "flujo",
  "caja",
  "provision",
  "apartar",
  "separar",
  "cuotas",
  "deuda",
  "vencimiento",
  "sancion",
  "domiciliar",
  "programar",
  "tesoreria",
  "subcuentas",
  "contratar",
  "nomina",
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

const TERMINOLOGIA_CO_LINES = [
  "Terminología (CO):",
  "- IVA: no es ingreso; es dinero que cobras y debes entregar al Estado.",
  "- Retenciones: son anticipos; pueden ser renta, IVA o ICA (no asumir cuál si no está clasificado).",
  "- Régimen ordinario vs SIMPLE: ordinario liquida impuestos con reglas generales; SIMPLE unifica y simplifica cargas para ciertos contribuyentes.",
  "- DIAN: autoridad tributaria nacional.",
  "- Caja/flujo: hablar en términos de plata disponible y separar en cuenta aparte.",
];

function normalizeForIntent(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function detectTaxIntent(message: string): { detected: boolean; matchedKeyword: string | null } {
  const normalizedMessage = normalizeForIntent(message);

  const hardTrigger = HARD_TAX_TRIGGERS.find((keyword) => normalizedMessage.includes(keyword));
  if (hardTrigger) {
    return {
      detected: true,
      matchedKeyword: hardTrigger,
    };
  }

  const matchedKeyword = TAX_INTENT_KEYWORDS.find((keyword) =>
    normalizedMessage.includes(normalizeForIntent(keyword)),
  );

  return {
    detected: Boolean(matchedKeyword),
    matchedKeyword: matchedKeyword ?? null,
  };
}

function detectFinancialIntent(
  normalizedMessage: string,
): { enabled: boolean; reason: string; matchedKeyword: string | null } {
  const matchedKeyword = FINANCIAL_INTENT_KEYWORDS.find((keyword) =>
    normalizedMessage.includes(keyword),
  );

  if (!matchedKeyword) {
    return {
      enabled: false,
      reason: "no_financial_keyword",
      matchedKeyword: null,
    };
  }

  return {
    enabled: true,
    reason: "keyword_match",
    matchedKeyword,
  };
}

function selectKbSnippets(normalizedMessage: string, snippets: typeof KB_CFO_SNIPPETS) {
  const scoredSnippets = snippets
    .map((snippet) => {
      const normalizedKeywords = snippet.keywords.map((keyword) => normalizeForIntent(keyword));
      const score = normalizedKeywords.reduce((accumulator, keyword) => {
        return accumulator + (normalizedMessage.includes(keyword) ? 1 : 0);
      }, 0);

      return {
        snippet,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.snippet);

  return scoredSnippets;
}

function buildProfileSnapshot(profileData: UserTaxProfileRow | null) {
  return {
    taxpayer_type: profileData?.taxpayer_type ?? "unknown",
    regimen: profileData?.regimen ?? "unknown",
    vat_responsible: profileData?.vat_responsible ?? "unknown",
    vat_periodicity: profileData?.vat_periodicity ?? "unknown",
    provision_style: profileData?.provision_style ?? "balanced",
    monthly_fixed_costs_cop: profileData?.monthly_fixed_costs_cop ?? 0,
    monthly_payroll_cop: profileData?.monthly_payroll_cop ?? 0,
    monthly_debt_payments_cop: profileData?.monthly_debt_payments_cop ?? 0,
    municipality: profileData?.municipality ?? null,
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

function formatPeriodLabelEs(year: number, month: number): string {
  const monthNames = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];

  const monthIndex = Math.min(Math.max(month - 1, 0), 11);
  return `${monthNames[monthIndex]} ${year}`;
}

function getCalcDebugState(
  taxIntentDetected: boolean,
  calcActualPayload: CurrentTaxCalculation | null,
): {
  calcStatus: "not_applicable" | "ok" | "missing_data" | "error";
  errorCode: string | null;
} {
  if (!taxIntentDetected) {
    return {
      calcStatus: "not_applicable",
      errorCode: null,
    };
  }

  if (calcActualPayload?.ok) {
    return {
      calcStatus: "ok",
      errorCode: null,
    };
  }

  const reason = calcActualPayload?.reason ?? "unknown";
  const isMissingDataReason =
    reason === "missing_data" ||
    reason === "missing_profile" ||
    reason === "missing_monthly_input" ||
    reason === "not_authenticated";

  return {
    calcStatus: isMissingDataReason ? "missing_data" : "error",
    errorCode: reason,
  };
}

async function getFinancialContextPayload(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string | null,
): Promise<FinancialContextPayload> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (!userId) {
    return {
      period: { year, month },
      profile_snapshot: buildProfileSnapshot(null),
      monthly_inputs: null,
      fallback_monthly_inputs: null,
      monthly_inputs_status: "not_authenticated",
    };
  }

  const { data: profileData } = await supabase
    .from("user_tax_profile_co")
    .select(
      "taxpayer_type, regimen, vat_responsible, vat_periodicity, provision_style, monthly_fixed_costs_cop, monthly_payroll_cop, monthly_debt_payments_cop, municipality",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const profileSnapshot = buildProfileSnapshot((profileData as UserTaxProfileRow | null) ?? null);

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
      period: { year, month },
      profile_snapshot: profileSnapshot,
      monthly_inputs: null,
      fallback_monthly_inputs: null,
      monthly_inputs_status: "monthly_inputs_query_error",
    };
  }

  if (!monthlyInputData) {
    const { data: fallbackMonthlyInputData, error: fallbackMonthlyInputError } = await supabase
      .from("monthly_tax_inputs_co")
      .select(
        "year, month, income_cop, deductible_expenses_cop, withholdings_cop, vat_collected_cop",
      )
      .eq("user_id", userId)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackMonthlyInputError) {
      return {
        period: { year, month },
        profile_snapshot: profileSnapshot,
        monthly_inputs: null,
        fallback_monthly_inputs: null,
        monthly_inputs_status: "monthly_inputs_query_error",
      };
    }

    if (!fallbackMonthlyInputData) {
      return {
        period: { year, month },
        profile_snapshot: profileSnapshot,
        monthly_inputs: null,
        fallback_monthly_inputs: null,
        monthly_inputs_status: "no_data_at_all",
      };
    }

    const fallbackInputs = fallbackMonthlyInputData as MonthlyTaxInputRow;

    return {
      period: { year, month },
      profile_snapshot: profileSnapshot,
      monthly_inputs: null,
      fallback_monthly_inputs: {
        period: {
          year: fallbackInputs.year,
          month: fallbackInputs.month,
        },
        inputs: {
          income_cop: fallbackInputs.income_cop,
          deductible_expenses_cop: fallbackInputs.deductible_expenses_cop,
          withholdings_cop: fallbackInputs.withholdings_cop,
          vat_collected_cop: fallbackInputs.vat_collected_cop,
        },
      },
      monthly_inputs_status: "fallback_used",
    };
  }

  const inputs = monthlyInputData as MonthlyTaxInputRow;

  return {
    period: { year, month },
    profile_snapshot: profileSnapshot,
    monthly_inputs: {
      income_cop: inputs.income_cop,
      deductible_expenses_cop: inputs.deductible_expenses_cop,
      withholdings_cop: inputs.withholdings_cop,
      vat_collected_cop: inputs.vat_collected_cop,
    },
    fallback_monthly_inputs: null,
    monthly_inputs_status: "ok",
  };
}

async function getCurrentTaxCalculation(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  financialContextPayload: FinancialContextPayload,
): Promise<CurrentTaxCalculation> {
  const currentPeriod = financialContextPayload.period;

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
      reason: "internal_error",
      period: currentPeriod,
      profile_snapshot: buildProfileSnapshot(null),
      missing_fields: [...REQUIRED_PROFILE_FIELDS],
    };
  }

  if (!profileData) {
    return {
      ok: false,
      error: "Falta perfil fiscal. Guarda tu perfil antes de estimar.",
      reason: "missing_data",
      period: currentPeriod,
      profile_snapshot: buildProfileSnapshot(null),
      missing_fields: [...REQUIRED_PROFILE_FIELDS],
    };
  }

  const profile = profileData as UserTaxProfileRow;
  const profileSnapshot = buildProfileSnapshot(profile);
  const missingFields: string[] = [...getMissingProfileFields(profileSnapshot)];

  if (financialContextPayload.monthly_inputs_status === "monthly_inputs_query_error") {
    return {
      ok: false,
      error: "No se pudo obtener el input mensual.",
      reason: "internal_error",
      period: currentPeriod,
      profile_snapshot: profileSnapshot,
      missing_fields: missingFields,
    };
  }

  const selectedInputs =
    financialContextPayload.monthly_inputs ?? financialContextPayload.fallback_monthly_inputs?.inputs;

  const selectedPeriod = financialContextPayload.monthly_inputs
    ? financialContextPayload.period
    : financialContextPayload.fallback_monthly_inputs?.period ?? financialContextPayload.period;

  const taxpayerType = profileSnapshot.taxpayer_type;
  const regimen = profileSnapshot.regimen;

  if (taxpayerType === "unknown") {
    missingFields.push("taxpayer_type");
  }

  if (regimen === "unknown") {
    missingFields.push("regimen");
  }

  if (!selectedInputs) {
    missingFields.push(
      "income_cop",
      "vat_collected_cop",
      "deductible_expenses_cop",
      "withholdings_cop",
    );
  }

  const uniqueMissingFields = [...new Set(missingFields)];

  if (uniqueMissingFields.length > 0) {
    return {
      ok: false,
      error: "Faltan datos para calcular provisión de este periodo.",
      reason: "missing_data",
      period: selectedPeriod,
      profile_snapshot: profileSnapshot,
      missing_fields: uniqueMissingFields,
    };
  }

  const selectedInputsValue = selectedInputs as NonNullable<typeof selectedInputs>;

  const inputs: MonthlyTaxInputRow = {
    year: selectedPeriod.year,
    month: selectedPeriod.month,
    income_cop: selectedInputsValue.income_cop,
    deductible_expenses_cop: selectedInputsValue.deductible_expenses_cop,
    withholdings_cop: selectedInputsValue.withholdings_cop,
    vat_collected_cop: selectedInputsValue.vat_collected_cop,
  };
  const isJuridicaOrdinario = taxpayerType === "juridica" && regimen === "ordinario";

  if (isJuridicaOrdinario) {
    const ivaToSeparate = inputs.vat_collected_cop > 0 ? inputs.vat_collected_cop : 0;
    const ingresoBaseSinIva = inputs.income_cop - inputs.vat_collected_cop;
    const utilidadEstimada = ingresoBaseSinIva - inputs.deductible_expenses_cop;
    const rentaBrutaEstimada = Math.max(utilidadEstimada, 0) * 0.35;
    const rentaNetaEstimada = Math.max(rentaBrutaEstimada - inputs.withholdings_cop, 0);
    const totalProvisionMvp = ivaToSeparate + rentaNetaEstimada;

    return {
      ok: true,
      period: selectedPeriod,
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
      missing_fields: [],
      inputs: {
        income_cop: inputs.income_cop,
        deductible_expenses_cop: inputs.deductible_expenses_cop,
        withholdings_cop: inputs.withholdings_cop,
        vat_collected_cop: inputs.vat_collected_cop,
      },
      breakdown: {
        iva_to_separate: ivaToSeparate,
        ingreso_base_sin_iva: ingresoBaseSinIva,
        utilidad_estimada: utilidadEstimada,
        renta_bruta_estimada: rentaBrutaEstimada,
        renta_neta_estimada: rentaNetaEstimada,
        total_provision_mvp: totalProvisionMvp,
        method: "mvp_juridica_ordinario_v1",
        notes: "Estimación MVP basada en FINANCIAL_CONTEXT; no reemplaza cierre contable oficial.",
      },
    };
  }

  let result: ReturnType<typeof calculateMonthlyProvisionCO>;

  try {
    result = calculateMonthlyProvisionCO(profile, inputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cálculo no disponible";
    return {
      ok: false,
      error: message,
      reason: "calculation_error",
      period: selectedPeriod,
      profile_snapshot: profileSnapshot,
      missing_fields: [],
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      reason: "calculation_error",
      period: selectedPeriod,
      profile_snapshot: profileSnapshot,
      missing_fields: [],
    };
  }

  return {
    ok: true,
    period: selectedPeriod,
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
    missing_fields: [],
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

    const normalizedMessage = normalizeForIntent(message);

    const financialContextPayload = await getFinancialContextPayload(
      supabase,
      authenticatedUserId,
    );

    const taxIntent = detectTaxIntent(message);
    const taxIntentDetected = taxIntent.detected;
    const taxIntentKeyword = taxIntent.matchedKeyword;
    const financialIntent = detectFinancialIntent(normalizedMessage);
    const selectedKbSnippets = financialIntent.enabled
      ? selectKbSnippets(normalizedMessage, KB_CFO_SNIPPETS)
      : [];
    const kbSnippetIdsUsed = selectedKbSnippets.map((snippet) => snippet.id);
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
        calcActualPayload = await getCurrentTaxCalculation(
          supabase,
          authenticatedUserId,
          financialContextPayload,
        );
      }
    }

    if (DEBUG_TAX) {
      const { calcStatus, errorCode } = getCalcDebugState(taxIntentDetected, calcActualPayload);

      console.info("[api/chat] Tax debug context", {
        taxIntentDetected,
        financialIntentDetected: financialIntent.enabled,
        kbSnippetIdsUsed,
        calcStatus,
        errorCode,
        model: openAiModel,
        openai_duration_ms: null,
        user_id: userIdMaskedForDebug,
      });
    }

    const promptSections = [
      `Contexto de conversacion (ultimos 10 mensajes):\n${contextLines.join("\n")}`,
      "FINANCIAL_CONTEXT:\n" + JSON.stringify(financialContextPayload, null, 2),
      [
        "INSTRUCCION_FINANCIAL_CONTEXT:",
        "Si FINANCIAL_CONTEXT contiene valores numéricos, debes usarlos. No inventes cifras ni uses ejemplos hipotéticos.",
        "Si monthly_inputs es null, pide al usuario llenar el mes o confirma si usamos el último mes disponible.",
      ].join("\n"),
      TERMINOLOGIA_CO_LINES.join("\n"),
    ];

    if (
      financialContextPayload.monthly_inputs_status === "fallback_used" &&
      financialContextPayload.fallback_monthly_inputs
    ) {
      const currentPeriodLabel = formatPeriodLabelEs(
        financialContextPayload.period.year,
        financialContextPayload.period.month,
      );
      const fallbackPeriodLabel = formatPeriodLabelEs(
        financialContextPayload.fallback_monthly_inputs.period.year,
        financialContextPayload.fallback_monthly_inputs.period.month,
      );

      promptSections.push(
        [
          "INSTRUCCION_FALLBACK_MENSUAL:",
          `Si usas fallback, debes decir explícitamente: "No veo datos para ${currentPeriodLabel}; estoy usando ${fallbackPeriodLabel}. ¿Confirmas o prefieres actualizar este mes?"`,
        ].join("\n"),
      );
    }

    if (financialIntent.enabled && selectedKbSnippets.length > 0) {
      const kbCfoText = selectedKbSnippets
        .map((snippet, index) => {
          return `${index + 1}) ${snippet.title}\n${snippet.content}`;
        })
        .join("\n\n");

      promptSections.push(
        [
          "KB_CFO_SNIPPETS:",
          kbCfoText,
          "INSTRUCCION_KB_CFO:",
          "Usa estos snippets solo si aportan respuesta práctica a la pregunta actual.",
        ].join("\n"),
      );
    }

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
          "Regla #0 (anti-invención): SOLO usa cifras que existan en FINANCIAL_CONTEXT o CALCULO_ACTUAL. Si falta un número, NO inventes.",
          "Regla #1 (prioridad de datos): Si FINANCIAL_CONTEXT.monthly_inputs existe => usar esos valores. Si monthly_inputs es null pero hay fallback_monthly_inputs => decir explícitamente que estás usando el último mes disponible y pedir confirmación.",
          "Regla #2 (estructura obligatoria de respuesta): Siempre responder en este orden:",
          "   (1) Resumen de lo que sé (bullets numerados).",
          "   (2) Cálculo o diagnóstico con fórmulas visibles si aplica.",
          "   (3) Estrategia operativa concreta (qué hacer hoy).",
          "   (4) Máximo 1-2 preguntas si realmente falta algo crítico.",
          "Regla #2.1 (priorización IVA vs nómina): nunca sugerir 'pago parcial del IVA al Estado'; en su lugar, aportar a subcuenta semanalmente y pagar completo en vencimiento.",
          "Regla #2.2 (si preguntan priorización IVA vs nómina): si faltan datos, pedir SOLO 2: (i) fecha de vencimiento de IVA, (ii) liquidez disponible esta semana.",
          "Regla #2.3 (plan numérico): si hay monthly_inputs y datos de costos fijos/nómina/deuda, proponer plan semanal con montos concretos.",
          "Regla #2.4 (liquidez-aware): si vencimiento IVA > 2 semanas y la liquidez actual es menor que la obligación más próxima (ej. nómina), priorizar primero la obligación inmediata.",
          "Regla #2.5 (acumulación IVA): en ese caso NO recomendar separar el IVA completo hoy si no hay caja suficiente; diseñar plan semanal hasta vencimiento.",
          "Regla #2.6 (fórmula automática): aporte_semanal_iva = iva_to_separate / semanas_restantes_hasta_vencimiento (redondeado y ajustable por liquidez).",
          "Regla #2.7 (faltante explícito): cuando haya liquidez parcial para IVA, calcular faltante = iva_to_separate - liquidez_actual.",
          "Regla #2.8 (si faltante > 0): dividir faltante por tiempo restante al vencimiento; usar días si el plan se expresa en días y semanas si se expresa en semanas.",
          "Regla #2.9 (consistencia): no volver a llamar 'restante' al IVA total si ya calculaste faltante; reportar siempre sobre faltante pendiente.",
          "Regla #3: Si hay income_cop, deductible_expenses_cop, vat_collected_cop y taxpayer_type/regimen => hacer cálculo MVP automáticamente sin pedir contador.",
          "Regla #4 (horizonte y aportes): Si el usuario menciona un horizonte explícito (por ejemplo 'en 3 días' o 'en 4 semanas'), calcula:",
          "  - faltante = iva_to_separate - liquidez_actual (si el usuario dio cuánto puede pagar o cuánto tiene hoy para IVA)",
          "  - aporte_por_unidad = faltante / horizonte",
          "  - Redondea a COP enteros y muestra el aporte como '≈ X COP por día/semana'.",
          "  - NO uses otra unidad distinta a la mencionada por el usuario.",
          "Regla #5 (prioridad operativa antes de DIAN): Antes de sugerir acuerdo con DIAN, propone 3 acciones de caja legales y concretas:",
          "  (1) adelantar cobros (clientes),",
          "  (2) diferir pagos no críticos (proveedores) o renegociar plazos,",
          "  (3) recortar gastos discrecionales inmediatos.",
          "  Solo si el faltante sigue siendo imposible, mencionar DIAN como 'último recurso'.",
          "Regla #4 (jurídica ordinario con datos suficientes): aplicar el algoritmo MVP explícito solo cuando taxpayer_type='juridica', regimen='ordinario' y monthly_inputs exista.",
          "",
          "ALGORITMO MVP — JURÍDICA ORDINARIO:",
          "A) iva_to_separate = (vat_collected_cop > 0) ? vat_collected_cop : 0.",
          "B) ingreso_base_sin_iva = income_cop - vat_collected_cop.",
          "C) utilidad_estimada = ingreso_base_sin_iva - deductible_expenses_cop.",
          "D) renta_bruta_estimada = max(utilidad_estimada, 0) * 0.35.",
          "E) renta_neta_estimada = max(renta_bruta_estimada - withholdings_cop, 0).",
          "F) total_provision_mvp = iva_to_separate + renta_neta_estimada.",
          "G) Mostrar fórmulas y números concretos (sin inventar cifras).",
          "H) Si utilidad_estimada <= 0: renta_neta_estimada = 0, IVA se separa igual si existe.",
          "",
          "MODO_CFO (obligatorio si la pregunta es estratégica o de caja):",
          "1. Diagnosticar liquidez actual.",
          "2. Evaluar riesgo (liquidez, sanción, flujo negativo).",
          "3. Proponer 2-3 estrategias legales priorizadas.",
          "4. Indicar impacto de cada estrategia.",
          "5. No dar recomendaciones ilegales ni evasión.",
          "",
          "ESTRATEGIAS LEGALES DISPONIBLES:",
          "- Separar IVA inmediatamente en subcuenta.",
          "- Si piden no pagarlo de golpe: pedir monto total, fecha límite y cuánto puede apartar hoy; ofrecer acuerdo DIAN (si aplica), transferencias semanales, subcuentas y priorización por vencimiento/sanción.",
          "- No recomendar pagos parciales del IVA al Estado; sí recomendar apartes semanales en subcuenta y pago completo en fecha de vencimiento.",
          "- Si el vencimiento del IVA está a más de 2 semanas y la caja no alcanza para la obligación inmediata, priorizar la obligación inmediata y calendarizar apartes semanales de IVA.",
          "- Si piden domiciliar: explicar programación desde banco/tesorería/calendario; pedir canal y fecha objetivo.",
          "- Programar provisiones semanales en vez de mensuales.",
          "- Priorizar obligaciones por riesgo de sanción.",
          "- Negociar plazos con proveedores antes que con DIAN.",
          "- Evaluar acuerdo de pago formal con DIAN si aplica.",
          "- Ajustar estructura de costos si margen < 20%.",
          "- Simular impacto antes de contratar o endeudarse.",
          "",
          "SEGURIDAD:",
          "No dar consejos de evasión, ocultamiento de ingresos, facturación falsa o prácticas ilegales."
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
        const { calcStatus, errorCode } = getCalcDebugState(taxIntentDetected, calcActualPayload);

        console.info("[api/chat] Tax debug summary", {
          taxIntentDetected,
          financialIntentDetected: financialIntent.enabled,
          kbSnippetIdsUsed,
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
        const { calcStatus, errorCode } = getCalcDebugState(taxIntentDetected, calcActualPayload);

        console.error("[api/chat] Tax debug summary", {
          taxIntentDetected,
          financialIntentDetected: financialIntent.enabled,
          kbSnippetIdsUsed,
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
