import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { DEBUG_TAX, MAX_MESSAGE_LENGTH } from "@/lib/config";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { logChatRequest } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { ventanillaUnicaSystemPrompt } from "@/lib/ai/systemPrompt";
import { getGeminiConfig } from "@/lib/ai/gemini";
import { KB_CFO_SNIPPETS } from "@/lib/kb/cfo-estrategias";
import { getPayablesSummary } from "@/lib/invoices/getPayablesSummary";
import { classifyInvoices, getTopPriorityActions, type ReviewQueueItem, type ReviewAction, type ConfidenceLevel, type ConfidenceResult } from "@/lib/invoices/getReviewQueue";
import { computePortfolioReadiness } from "@/lib/invoices/computeReadinessScore";
import { getReceiptsCounts } from "@/lib/invoices/getReceiptsCounts";
import { getBulkRecommendations, type BulkRecommendation } from "@/lib/invoices/getBulkRecommendations";
import { buildPaymentPlan, type WeeklyPaymentPlan } from "@/lib/invoices/getPaymentPlan";
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

type InvoicesPrioritySummary = Awaited<ReturnType<typeof getPayablesSummary>>;

type FinancialIntentReason =
  | "cuotas_or_acuerdo"
  | "payments_to_suppliers"
  | "domiciliar_or_transfer"
  | "liquidity_pressure"
  | "iva_focus"
  | "renta_focus"
  | "invoices_priority"
  | "keyword_match"
  | "greeting_weekly_plan"
  | "no_financial_keyword";

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

type AiProviderErrorLike = {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

function isTimeoutError(error: AiProviderErrorLike): boolean {
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

function isModelNotFoundError(error: AiProviderErrorLike): boolean {
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

function hashStringValue(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
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
): { enabled: boolean; reason: FinancialIntentReason; matchedKeyword: string | null } {
  const cuotasKeywords = [
    "pagar en cuotas",
    "no pagarlo de golpe",
    "no pagar de golpe",
    "acuerdo dian",
    "acuerdo de pago",
    "diferir",
  ];
  const domiciliarKeywords = ["domiciliar", "programar transferencias", "programar pagos"];
  const liquidezKeywords = ["justo de caja", "liquidez", "flujo", "caja"];
  const ivaKeywords = ["iva", "vencimiento iva"];
  const rentaKeywords = ["renta", "impuesto de renta", "provision de renta", "provisiono de renta"];
  const proveedoresKeywords = [
    "proveedor",
    "proveedores",
    "factura",
    "facturas",
    "cuentas por pagar",
    "pagar proveedores",
  ];
  const pagosProveedoresSchedulingKeywords = [
    "programar pagos",
    "pagos mensuales",
    "transferencias",
  ];
  const invoicesPriorityKeywords = [
    "facturas pendientes",
    "cuentas por pagar",
    "cxp",
    "que pago primero",
    "vencimientos proveedores",
  ];

  const matchedInvoicesPriority = invoicesPriorityKeywords.find((keyword) =>
    normalizedMessage.includes(keyword),
  );
  if (matchedInvoicesPriority) {
    return {
      enabled: true,
      reason: "invoices_priority",
      matchedKeyword: matchedInvoicesPriority,
    };
  }

  const matchedCuotas = cuotasKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedCuotas) {
    return {
      enabled: true,
      reason: "cuotas_or_acuerdo",
      matchedKeyword: matchedCuotas,
    };
  }

  const matchedProveedores = proveedoresKeywords.find((keyword) =>
    normalizedMessage.includes(keyword),
  );
  const matchedProveedoresScheduling = pagosProveedoresSchedulingKeywords.find((keyword) =>
    normalizedMessage.includes(keyword),
  );
  if (matchedProveedores && matchedProveedoresScheduling) {
    return {
      enabled: true,
      reason: "payments_to_suppliers",
      matchedKeyword: matchedProveedores,
    };
  }

  const matchedDomiciliar = domiciliarKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedDomiciliar) {
    return {
      enabled: true,
      reason: "domiciliar_or_transfer",
      matchedKeyword: matchedDomiciliar,
    };
  }

  const matchedLiquidez = liquidezKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedLiquidez) {
    return {
      enabled: true,
      reason: "liquidity_pressure",
      matchedKeyword: matchedLiquidez,
    };
  }

  const matchedIva = ivaKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedIva) {
    return {
      enabled: true,
      reason: "iva_focus",
      matchedKeyword: matchedIva,
    };
  }

  const matchedRenta = rentaKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedRenta) {
    return {
      enabled: true,
      reason: "renta_focus",
      matchedKeyword: matchedRenta,
    };
  }

  if (matchedProveedores) {
    return {
      enabled: true,
      reason: "payments_to_suppliers",
      matchedKeyword: matchedProveedores,
    };
  }

  const matchedKeyword = FINANCIAL_INTENT_KEYWORDS.find((keyword) =>
    normalizedMessage.includes(keyword),
  );

  if (!matchedKeyword) {
    const greetings = [
      "hola", "como voy", "que tal", "buenos dias", "buenas tardes",
      "buenas noches", "como estoy", "como va", "como estamos",
      "que hay", "hey", "buenas",
    ];
    if (greetings.some((g) => normalizedMessage.includes(g))) {
      return { enabled: true, reason: "greeting_weekly_plan", matchedKeyword: null };
    }
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

function selectKbSnippets(
  normalizedMessage: string,
  snippets: typeof KB_CFO_SNIPPETS,
  reason?: FinancialIntentReason,
) {
  const snippetsById = new Map(snippets.map((snippet) => [snippet.id, snippet]));
  const prioritizedSnippetIds: string[] = [];

  const includesAny = (values: string[]) => values.some((value) => normalizedMessage.includes(value));
  const pushId = (snippetId: string) => {
    if (!prioritizedSnippetIds.includes(snippetId)) {
      prioritizedSnippetIds.push(snippetId);
    }
  };
  const mentionsTaxState = includesAny(["iva", "dian", "impuestos", "vencimiento"]);

  if (reason === "payments_to_suppliers") {
    pushId("domiciliar-pagos");
    pushId("proveedores-calendario-pagos");

    if (mentionsTaxState) {
      pushId("priorizacion-vencimientos");
    }
  }

  if (reason === "invoices_priority") {
    pushId("triage-caja-orden-pagos");
    pushId("proveedores-calendario-pagos");
  }

  if (reason === "liquidity_pressure") {
    pushId("triage-caja-orden-pagos");

    if (mentionsTaxState) {
      pushId("iva-separacion");
    } else {
      pushId("priorizacion-vencimientos");
    }
  }

  if (reason === "renta_focus") {
    pushId("renta-provision-mensual");

    if (includesAny(["iva"])) {
      pushId("iva-separacion");
    }
  }

  if (
    includesAny([
      "pagar en cuotas",
      "no pagarlo de golpe",
      "no pagar de golpe",
      "acuerdo dian",
      "acuerdo de pago",
      "diferir",
    ])
  ) {
    pushId("cuotas-legales-dian");
    pushId("priorizacion-vencimientos");
  }

  if (includesAny(["domiciliar", "programar transferencias", "programar pagos"])) {
    pushId("domiciliar-pagos");
    pushId("priorizacion-vencimientos");
  }

  if (reason !== "liquidity_pressure" && includesAny(["justo de caja", "liquidez", "flujo", "caja"])) {
    pushId("triage-caja-orden-pagos");
    pushId("priorizacion-vencimientos");
  }

  if (includesAny(["iva", "vencimiento iva"])) {
    pushId("iva-separacion");
  }

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

  const prioritizedSnippets = prioritizedSnippetIds
    .map((snippetId) => snippetsById.get(snippetId))
    .filter((snippet): snippet is (typeof snippets)[number] => Boolean(snippet));

  const finalSnippets = [...prioritizedSnippets];
  for (const snippet of scoredSnippets) {
    if (finalSnippets.length >= 2) {
      break;
    }

    if (!finalSnippets.some((selectedSnippet) => selectedSnippet.id === snippet.id)) {
      finalSnippets.push(snippet);
    }
  }

  return finalSnippets.slice(0, 2);
}

function hardenKbSnippets(snippets: typeof KB_CFO_SNIPPETS) {
  if (snippets.length > 2) {
    console.warn("KB_OVERFLOW", { ids: snippets.map((snippet) => snippet.id) });
    return snippets.slice(0, 2);
  }

  return snippets;
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

function formatCopForPrompt(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
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

type RecommendedAction = {
  invoice_id: string;
  supplier_name: string;
  invoice_number: string | null;
  total_cop: number | null;
  due_date: string | null;
  payment_status: "unpaid" | "scheduled";
  action_reason: string;
  available_actions: ReviewAction[];
  confidence: ConfidenceLevel;
  action_confidence: Record<string, ConfidenceResult>;
  consequence_if_ignored: string;
  recommended_resolution: string;
  readiness_score: number;
  readiness_level: string;
  readiness_reason: string;
};

function worstConfidence(
  map: Record<string, ConfidenceResult>,
): ConfidenceLevel {
  const levels = Object.values(map).map((r) => r.level);
  if (levels.includes("blocked")) return "blocked";
  if (levels.includes("review")) return "review";
  return "safe";
}

function buildRecommendedActions(
  invoices: { id: string; supplier_name: string | null; invoice_number: string | null; total_cop: number | null; due_date: string | null; payment_status: string; payment_url: string | null; supplier_portal_url: string | null; scheduled_payment_date: string | null; data_quality_status?: string }[],
  financialIntentEnabled: boolean,
  reviewQueueItems?: ReviewQueueItem[],
): RecommendedAction[] {
  if (!financialIntentEnabled) return [];

  // Use review queue items as primary source when available (richer priority + reason)
  if (reviewQueueItems && reviewQueueItems.length > 0) {
    const actionableItems = reviewQueueItems
      .filter((item) => item.payment_status !== "paid" || item.available_actions.includes("upload_receipt"))
      .slice(0, 3);

    if (actionableItems.length > 0) {
      return actionableItems.map((item) => ({
        invoice_id: item.invoice_id,
        supplier_name: item.supplier_name?.trim() || "Proveedor desconocido",
        invoice_number: item.invoice_number,
        total_cop: item.total_cop,
        due_date: item.due_date,
        payment_status: (item.payment_status === "paid" ? "unpaid" : item.payment_status ?? "unpaid") as "unpaid" | "scheduled",
        action_reason: item.reason,
        available_actions: item.available_actions,
        confidence: worstConfidence(item.action_confidence),
        action_confidence: item.action_confidence,
        consequence_if_ignored: item.consequence_if_ignored,
        recommended_resolution: item.recommended_resolution,
        readiness_score: item.readiness_score,
        readiness_level: item.readiness_level,
        readiness_reason: item.readiness_reason,
      }));
    }
  }

  // Fallback: existing scoring logic when no review queue items
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const pending = invoices
    .filter((inv) => inv.payment_status === "unpaid" || inv.payment_status === "scheduled")
    .filter((inv) => inv.data_quality_status !== "incomplete");
  if (pending.length === 0) return [];

  // Priority tiers: unpaid overdue=6, unpaid <=7d=5, unpaid rest=4, scheduled overdue=3, scheduled <=7d=2, scheduled rest=1
  const scored = pending.map((inv) => {
    const isScheduled = inv.payment_status === "scheduled";
    const baseTier = isScheduled ? 0 : 3; // unpaid gets +3 offset

    let dueTier = 1; // rest
    let reason = isScheduled ? "ya programada" : "pendiente";
    let diffDays: number | null = null;

    if (inv.due_date) {
      const due = new Date(inv.due_date + "T00:00:00");
      const diffMs = due.getTime() - now.getTime();
      diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        dueTier = 3; // overdue
        reason = `vencida hace ${Math.abs(diffDays)} dias`;
      } else if (diffDays <= 7) {
        dueTier = 2; // soon
        reason = `vence en ${diffDays} dias`;
      } else {
        dueTier = 1;
        reason = `vence en ${diffDays} dias`;
      }
    }

    if (isScheduled) {
      if (inv.scheduled_payment_date) {
        const schedDate = new Date(inv.scheduled_payment_date + "T00:00:00");
        const schedLabel = schedDate.toLocaleDateString("es-CO", { day: "numeric", month: "long" });
        if (diffDays !== null && diffDays < 0) {
          reason = `programada para el ${schedLabel}, vencida`;
        } else if (diffDays !== null && diffDays <= 7) {
          reason = `programada para el ${schedLabel}, vence en ${diffDays}d`;
        } else {
          reason = `programada para el ${schedLabel}`;
        }
      } else {
        reason = diffDays !== null && diffDays < 0
          ? `ya programada, vencida hace ${Math.abs(diffDays)}d`
          : "ya programada";
      }
    }

    const priority = baseTier + dueTier;
    return { inv, priority, reason };
  });

  scored.sort((a, b) => b.priority - a.priority);

  return scored.slice(0, 3).map(({ inv, reason }) => ({
    invoice_id: inv.id,
    supplier_name: inv.supplier_name?.trim() || "Proveedor desconocido",
    invoice_number: inv.invoice_number,
    total_cop: inv.total_cop,
    due_date: inv.due_date,
    payment_status: inv.payment_status as "unpaid" | "scheduled",
    action_reason: reason,
    available_actions: ["pay_now", "schedule_payment", "review_invoice"] as ReviewAction[],
    confidence: "review" as ConfidenceLevel,
    action_confidence: {},
    consequence_if_ignored: "",
    recommended_resolution: "",
    readiness_score: 100,
    readiness_level: "healthy",
    readiness_reason: "",
  }));
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

    if (process.env.TEST_OFFLINE === "true") {
      const normalizedMessage = normalizeForIntent(message);
      const taxIntent = detectTaxIntent(normalizedMessage);
      const financialIntent = detectFinancialIntent(normalizedMessage);
      const selectedKbSnippets = financialIntent.enabled
        ? selectKbSnippets(normalizedMessage, KB_CFO_SNIPPETS, financialIntent.reason)
        : [];
      const hardenedKbSnippets = hardenKbSnippets(selectedKbSnippets);

      return NextResponse.json({
        taxIntentDetected: taxIntent.detected,
        financialIntentDetected: financialIntent.enabled,
        financialIntentReason: financialIntent.reason,
        financialIntentMatchedKeyword: financialIntent.matchedKeyword,
        kbSnippetIdsUsed: hardenedKbSnippets.map((snippet) => snippet.id),
      });
    }

    const supabase = await createServerSupabaseClient();
    const geminiConfig = getGeminiConfig();
    const geminiApiKey = geminiConfig.apiKey;
    const geminiModel = geminiConfig.model;
    const demoMode = isDemoModeEnabled();
    const allowAnonymousChat = demoMode;
    const messageLength = message.length;

    if (!geminiConfig.hasApiKey) {
      throw new ApiError(
        500,
        "Missing Gemini API key. Define GEMINI_API_KEY in .env.local and restart the server.",
      );
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);

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
    let history: StoredMessage[] = [];

    if (!allowAnonymousChat) {
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

        if (!existingConversation) {
          conversationId = null;
        }
      }

      if (!conversationId) {
        const { data: createdConversation, error: createConversationError } = await supabase
          .from("conversations")
          .insert({ user_id: authenticatedUserId })
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

      history = ((historyData ?? []) as StoredMessage[]).reverse();

      const { error: insertUserMessageError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: message,
          user_id: authenticatedUserId,
        });

      if (insertUserMessageError) {
        throw new ApiError(500, "Error guardando el mensaje del usuario.");
      }
    } else {
      conversationId = conversationId || crypto.randomUUID();
    }

    const contextLines = history.map(
      (item) => `${item.role === "assistant" ? "Asistente" : "Usuario"}: ${item.content}`,
    );

    const normalizedMessage = normalizeForIntent(message);

    const financialContextPayload = await getFinancialContextPayload(
      supabase,
      authenticatedUserId,
    );

    let pendingInvoicesList: { supplier_name: string, total_cop: number, due_date: string, payment_status: string }[] = [];
    let allInvoicesForActions: { id: string, supplier_name: string | null, invoice_number: string | null, total_cop: number | null, due_date: string | null, payment_status: string, payment_url: string | null, supplier_portal_url: string | null, scheduled_payment_date: string | null }[] = [];
    let allInvoicesRaw: { id: string, supplier_name: string | null, invoice_number: string | null, total_cop: number | null, iva_cop: number | null, due_date: string | null, payment_status: string | null, data_quality_status: string | null, vat_status: string | null }[] = [];
    let dataQualityWarningCount = 0;
    let dataQualityIncompleteCount = 0;
    let dataQualitySuspectCount = 0;
    if (authenticatedUserId) {
      const { data: rawInvoices } = await supabase
        .from("invoices")
        .select("id, supplier_name, invoice_number, total_cop, due_date, payment_status, payment_url, supplier_portal_url, scheduled_payment_date, data_quality_status, vat_status, iva_cop")
        .eq("user_id", authenticatedUserId)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (rawInvoices) {
        allInvoicesRaw = rawInvoices as any;
        dataQualityIncompleteCount = rawInvoices.filter((inv: any) => inv.data_quality_status === "incomplete").length;
        dataQualitySuspectCount = rawInvoices.filter((inv: any) => inv.data_quality_status === "suspect").length;
        dataQualityWarningCount = dataQualityIncompleteCount + dataQualitySuspectCount;
        pendingInvoicesList = rawInvoices.filter((inv: any) => inv.data_quality_status !== "incomplete");
        allInvoicesForActions = rawInvoices.filter((inv: any) => inv.data_quality_status !== "incomplete");
      }
    }

    // --- VAT summary for chat context ---
    let vatUsableCop = 0;
    let vatReviewCop = 0;
    let vatBlockedCop = 0;
    let vatReviewCount = 0;
    let vatBlockedCount = 0;
    let vatUsableCount = 0;
    if (authenticatedUserId && allInvoicesForActions.length > 0) {
      for (const inv of allInvoicesForActions as any[]) {
        const ivaCop = typeof inv.iva_cop === "number" ? inv.iva_cop : 0;
        if (inv.vat_status === "iva_usable") { vatUsableCop += ivaCop; vatUsableCount++; }
        else if (inv.vat_status === "iva_en_revision") { vatReviewCop += ivaCop; vatReviewCount++; }
        else if (inv.vat_status === "iva_no_usable") { vatBlockedCop += ivaCop; vatBlockedCount++; }
      }
    }

    const taxIntent = detectTaxIntent(message);
    const taxIntentDetected = taxIntent.detected;
    const financialIntent = detectFinancialIntent(normalizedMessage);
    const selectedKbSnippets = financialIntent.enabled
      ? selectKbSnippets(normalizedMessage, KB_CFO_SNIPPETS, financialIntent.reason)
      : [];
    const kbSnippetsForModel = hardenKbSnippets(selectedKbSnippets);

    const kbSnippetIdsUsed = kbSnippetsForModel.map((snippet) => snippet.id);
    let calcActualPayload: CurrentTaxCalculation | null = null;
    let invoicesPrioritySummary: InvoicesPrioritySummary | null = null;
    let weeklyPlanPayload: WeeklyPaymentPlan | null = null;

    // --- Review queue classification (reuses already-fetched invoices) ---
    let reviewQueueItems: ReviewQueueItem[] = [];
    if (financialIntent.enabled && authenticatedUserId && allInvoicesRaw.length > 0) {
      const receiptCounts = await getReceiptsCounts(
        supabase,
        allInvoicesRaw.map((inv) => inv.id),
      );
      const rq = classifyInvoices(allInvoicesRaw, receiptCounts);
      reviewQueueItems = rq.items;
    }

    // Fetch readiness delta for prompt context
    let readinessDelta: number | null = null;
    if (financialIntent.enabled && authenticatedUserId) {
      const { data: snapRows } = await supabase
        .from("readiness_snapshots")
        .select("portfolio_score")
        .eq("user_id", authenticatedUserId)
        .order("created_at", { ascending: false })
        .limit(2);
      if (snapRows && snapRows.length >= 2) {
        readinessDelta = snapRows[0].portfolio_score - snapRows[1].portfolio_score;
      }
    }

    if (financialIntent.reason === "invoices_priority" && authenticatedUserId) {
      invoicesPrioritySummary = await getPayablesSummary({
        supabase,
        userId: authenticatedUserId,
        topLimit: 10,
      });

      if ((invoicesPrioritySummary.top_unpaid_invoices ?? []).length === 0) {
        const reply = "¡Felicidades! Estás al día con tus obligaciones";

        if (!allowAnonymousChat) {
          const { error: insertAssistantMessageError } = await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: reply,
            user_id: authenticatedUserId,
          });

          if (insertAssistantMessageError) {
            throw new ApiError(500, "Error guardando el mensaje del asistente.");
          }
        }

        logChatRequest({
          ip: clientIp,
          userId: userIdForLog,
          messageLength,
          model: geminiModel,
          openAiDurationMs: 0,
        });

        return NextResponse.json({
          conversationId,
          reply,
          recommended_actions: [],
          bulk_recommendations: [],
          weekly_plan: null,
        });
      }
    }

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

    // LOG CONTRACT — Do not rename keys without dashboard migration.
    // Keys relied on: taxIntentDetected, financialIntentDetected, financialIntentReason, financialIntentMatchedKeyword, kbSnippetIdsUsed, calcStatus
    if (DEBUG_TAX) {
      const { calcStatus, errorCode } = getCalcDebugState(taxIntentDetected, calcActualPayload);

      console.info("[api/chat] Tax debug context", {
        taxIntentDetected,
        financialIntentDetected: financialIntent.enabled,
        financialIntentReason: financialIntent.reason,
        financialIntentMatchedKeyword: financialIntent.matchedKeyword,
        kbSnippetIdsUsed,
        calcStatus,
        errorCode,
        model: geminiModel,
        openai_duration_ms: null,
        user_id: userIdMaskedForDebug,
      });
    }

    let taxProfileData = "";
    if (authenticatedUserId) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", authenticatedUserId)
        .maybeSingle();

      if (profileRow && profileRow.nit) {
        const ultimoDigito = profileRow.nit.slice(-1);
        const responsabilidades = [];
        if (profileRow.impuesto_sobre_la_renta) responsabilidades.push("Impuesto sobre la renta");
        if (profileRow.retencion_en_la_fuente) responsabilidades.push("Retención en la fuente");
        if (profileRow.autorretenedor) responsabilidades.push("Autorretenedor");
        if (profileRow.responsable_de_iva) responsabilidades.push("Responsable de IVA");
        if (profileRow.regimen_simple) responsabilidades.push("Régimen Simple");
        if (profileRow.gran_contribuyente) responsabilidades.push("Gran Contribuyente");
        
        taxProfileData = "El usuario actual tiene el NIT " + profileRow.nit + 
          " (Último dígito: " + ultimoDigito + ") y tiene estas responsabilidades: [" + 
          responsabilidades.join(", ") + "]. Cuando consultes el Calendario 2026, ignora todo lo que no aplique a su último dígito o sus responsabilidades.";
      }
    }

    const promptSections = [
      `Contexto de conversacion (ultimos 10 mensajes):\n${contextLines.join("\n")}`,
      taxProfileData ? `CONTEXTO_PERFIL_USUARIO:\n${taxProfileData}` : "",
      "FINANCIAL_CONTEXT:\n" + JSON.stringify(financialContextPayload, null, 2),
      [
        "INSTRUCCION_FINANCIAL_CONTEXT:",
        "Si FINANCIAL_CONTEXT contiene valores numéricos, debes usarlos. No inventes cifras ni uses ejemplos hipotéticos.",
        "Si monthly_inputs es null, pide al usuario llenar el mes o confirma si usamos el último mes disponible.",
      ].join("\n"),
      TERMINOLOGIA_CO_LINES.join("\n"),
    ];

    if (pendingInvoicesList && pendingInvoicesList.length > 0) {
        const invoicesForPrompt = pendingInvoicesList.map((inv: any) => ({
          ...inv,
          _quality_warning: inv.data_quality_status === "suspect" ? "datos sospechosos - verificar antes de decidir" : undefined,
        }));
        promptSections.push(
          [
            "ALL_INVOICES_LIST_REAL_DATA:",
            JSON.stringify(invoicesForPrompt, null, 2),
            "INSTRUCCION_FACTURAS_PENDIENTES_Y_PAGADAS:",
            "Usa esta lista para responder si el usuario pregunta 'qué facturas tengo', '¿qué debo?', 'cuánto debo' o temas relacionados con pagos.",
            "Importante: Las facturas con payment_status 'paid' ya están pagadas. Las 'unpaid' o 'scheduled' están pendientes.",
            "El CFO SIEMPRE debe incluir y decir exactamente esta frase en su respuesta: 'Has pagado $X y te faltan $Y por pagar', donde $X es la suma de las facturas pagadas y $Y es la suma de las facturas pendientes. Formatea todo en pesos colombianos.",
            `HOY ES ${new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" }).toUpperCase()}. Al listar facturas pendientes actúa con visión de CFO y aplica la siguiente lógica de semáforo priorizando pagos:`,
            "🔴 Vencida: Si la due_date ya pasó respecto a hoy.",
            "🟡 Urgente: Si la due_date tiene vencimiento dentro de los próximos 7 días.",
            "🟢 Al día: Si tiene más de 5 días de plazo.",
            "Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas para las pendientes: Estatus (Emoji 🔴/🟡/🟢), Proveedor, Monto (COP), y Vencimiento.",
            "Al final de la tabla, debes calcular OBLIGATORIAMENTE el Gran Total Pendiente.",
            "NO añadas textos de relleno ni recomendaciones antes o después de la tabla de facturas."
          ].join("\n")
        );
      }

    if (dataQualityWarningCount > 0) {
      promptSections.push(
        `AVISO_CALIDAD_DATOS: Hay ${dataQualityWarningCount} factura(s) con datos dudosos o incompletos (${dataQualityIncompleteCount} incompleta(s), ${dataQualitySuspectCount} sospechosa(s)). Menciona esto al usuario y sugiere que las revise antes de tomar decisiones financieras.`
      );
    }

    // --- Review queue context for actionable responses ---
    if (financialIntent.enabled && reviewQueueItems.length > 0) {
      const top10 = reviewQueueItems.slice(0, 10);
      const actionMap: Record<string, string> = {
        pay_now: "pagar ahora",
        review_invoice: "revisar factura",
        upload_receipt: "subir comprobante",
        schedule_payment: "programar pago",
      };
      const confidenceTag: Record<string, string> = {
        safe: "SEGURO",
        review: "REVISAR",
        blocked: "BLOQUEADO",
      };
      const reviewLines = top10.map((item) => {
        const supplierLabel = item.supplier_name?.trim() || "Proveedor desconocido";
        const amountLabel = item.total_cop !== null ? formatCopForPrompt(item.total_cop) : "monto no disponible";
        const dueLabel = item.due_date
          ? (() => {
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const due = new Date(item.due_date + "T00:00:00");
              const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
              if (diffDays < 0) return `vencida hace ${Math.abs(diffDays)}d`;
              if (diffDays === 0) return "vence hoy";
              return `vence en ${diffDays}d`;
            })()
          : "sin vencimiento";
        const actionLabel = actionMap[item.available_actions[0]] ?? item.available_actions[0];
        const confLevel = worstConfidence(item.action_confidence);
        const confTag = confidenceTag[confLevel] ?? "REVISAR";
        return `- ${supplierLabel} | ${amountLabel} | ${dueLabel} | ${item.reason} | ${actionLabel} | [${confTag}] | si no actúas: ${item.consequence_if_ignored} | resolución recomendada: ${item.recommended_resolution} | readiness: ${item.readiness_score}/100 (${item.readiness_level})`;
      });

      promptSections.push(
        [
          "REVIEW_QUEUE:",
          (() => {
            const portfolio = computePortfolioReadiness(reviewQueueItems.map((i) => ({ score: i.readiness_score, level: i.readiness_level, reason: i.readiness_reason })));
            let line = `Salud operativa global: ${portfolio.score}/100 (${portfolio.level}) — ${portfolio.breakdown.healthy} sanas, ${portfolio.breakdown.warning} con alerta, ${portfolio.breakdown.critical} críticas.`;
            if (readinessDelta != null && readinessDelta !== 0) {
              line += ` Tendencia: ${readinessDelta > 0 ? `+${readinessDelta}` : readinessDelta} puntos respecto al último corte (${readinessDelta > 0 ? "mejorando" : "empeorando"}).`;
            }
            return line;
          })(),
          `Hay ${reviewQueueItems.length} factura(s) que requieren atención del usuario. Las ${top10.length} más urgentes:`,
          ...reviewLines,
          "",
          "INSTRUCCION_REVIEW_QUEUE:",
          "Cuando el usuario pregunte qué revisar, qué tiene pendiente, o pida recomendaciones, usa esta cola de revisión con facturas reales.",
          "Prioriza en el orden mostrado (ya están ordenadas por urgencia).",
          "Para cada factura que menciones, incluye la acción recomendada específica (pagar, revisar, subir comprobante, programar).",
          "Si hay facturas vencidas, enfatiza su urgencia.",
          "Cada factura incluye una consecuencia si el usuario no actúa, una resolución recomendada, y un readiness score (0-100). Prioriza acciones concretas y la mejor resolución para cada caso. Evita respuestas abstractas.",
          "Usa el readiness score como apoyo, no como verdad absoluta. Explícalo de forma simple: un score bajo significa que la factura está en mal estado operativo, uno alto que está bastante lista.",
          "Responde con facturas concretas, NO en abstracto.",
          "",
          "INSTRUCCION_CONFIANZA:",
          "Cada factura tiene un nivel de confianza entre corchetes: [SEGURO], [REVISAR], o [BLOQUEADO].",
          "- SEGURO: datos verificados, la acción se puede ejecutar.",
          "- REVISAR: sugiere al usuario verificar datos antes de actuar.",
          "- BLOQUEADO: faltan datos críticos, NO recomendar ejecutar esa acción.",
          "Usa lenguaje prudente: 'puedes hacerlo con seguridad', 'conviene revisar antes', 'no recomendable sin corregir datos'.",
          "NUNCA ejecutes ni confirmes acciones automáticamente — solo comunica el nivel de riesgo.",
        ].join("\n"),
      );

      // --- Bulk recommendations context ---
      const bulkRecs = getBulkRecommendations(reviewQueueItems);
      if (bulkRecs.length > 0) {
        const bulkLines = bulkRecs.map((rec) => {
          const totalLabel = rec.total_cop != null ? ` (${formatCopForPrompt(rec.total_cop)} total)` : "";
          const confLabel = confidenceTag[rec.overall_confidence] ?? "REVISAR";
          return `- ${rec.title}${totalLabel} [${confLabel}]`;
        });
        promptSections.push(
          [
            "ACCIONES_EN_LOTE:",
            ...bulkLines,
            "",
            "INSTRUCCION_LOTE:",
            "Si hay acciones en lote disponibles, sugiere al usuario resolverlas en grupo antes de detallar una por una.",
            "Explica por qué conviene y menciona que puede hacerlo desde el dashboard.",
          ].join("\n"),
        );
      }
    }

    // --- Weekly plan context for greetings ---
    if (financialIntent.reason === "greeting_weekly_plan" && reviewQueueItems.length > 0) {
      weeklyPlanPayload = buildPaymentPlan(reviewQueueItems);
      const mp = weeklyPlanPayload.this_week.must_pay;
      const ss = weeklyPlanPayload.this_week.should_schedule;
      const sr = weeklyPlanPayload.this_week.should_review;

      const planLines: string[] = ["PLAN_SEMANAL:", "Esta semana deberías:"];
      if (mp.length > 0) {
        const topMp = mp.slice(0, 3).map((i) => i.supplier_name || "Sin proveedor").join(", ");
        planLines.push(`- Pagar ${mp.length} factura${mp.length !== 1 ? "s" : ""} (${formatCopForPrompt(weeklyPlanPayload.totals.must_pay_total)}) — vencidas o por vencer en 3 días. Principales: ${topMp}.`);
      }
      if (ss.length > 0) {
        const topSs = ss.slice(0, 3).map((i) => i.supplier_name || "Sin proveedor").join(", ");
        planLines.push(`- Programar ${ss.length} factura${ss.length !== 1 ? "s" : ""} (${formatCopForPrompt(weeklyPlanPayload.totals.upcoming_total)}) — vencen esta semana. Principales: ${topSs}.`);
      }
      if (sr.length > 0) {
        planLines.push(`- Revisar ${sr.length} factura${sr.length !== 1 ? "s" : ""} con datos incompletos o sospechosos.`);
      }
      if (mp.length === 0 && ss.length === 0 && sr.length === 0) {
        planLines.push("- No tienes acciones urgentes esta semana. ¡Estás al día!");
      }
      // Cash scenarios (conservative: only outflows, no income estimation)
      const sc = weeklyPlanPayload.cash_scenarios;
      if (sc.pay_and_schedule.outflow_now + sc.pay_and_schedule.outflow_scheduled > 0) {
        planLines.push(
          "",
          "ESCENARIOS_DE_CAJA:",
          `- Si no haces nada: $0 en salidas.`,
          `- Si pagas solo lo urgente: ${formatCopForPrompt(sc.pay_urgent_only.outflow_now)} en salidas.`,
          `- Si pagas y programas todo: ${formatCopForPrompt(sc.pay_and_schedule.outflow_now + sc.pay_and_schedule.outflow_scheduled)} en salidas.`,
        );
      }
      // Top 3 critical actions
      const top3 = getTopPriorityActions(reviewQueueItems);
      if (top3.length > 0) {
        planLines.push(
          "",
          "ACCIONES_CRITICAS:",
          "Empieza tu respuesta mencionando estas acciones críticas (las más urgentes):",
          ...top3.map((item) => {
            const name = item.supplier_name?.trim() || "Sin proveedor";
            const amount = item.total_cop !== null ? formatCopForPrompt(item.total_cop) : "monto no disponible";
            return `- ${name} (${amount}) — readiness ${item.readiness_score}/100 — ${item.recommended_resolution}`;
          }),
        );
      }
      planLines.push(
        "",
        "INSTRUCCION_PLAN_SEMANAL:",
        "El usuario te está saludando. Responde empezando por las acciones críticas, luego un resumen breve del plan semanal.",
        "No uses formato numerado (1)-(4). Sé breve, directo y cálido.",
        "Menciona las facturas más urgentes por nombre de proveedor y monto.",
        "Si hay escenarios de caja, preséntalos brevemente para que el usuario entienda el impacto de cada opción.",
        "NUNCA estimes ingresos ni prometas caja futura. Solo impacto de salidas.",
        "Si no hay nada urgente, felicita al usuario.",
      );
      promptSections.push(planLines.join("\n"));
    }

    // IVA context — always inject if user has VAT data, so IVA questions can be answered
    if (vatUsableCop > 0 || vatReviewCop > 0 || vatBlockedCop > 0) {
      promptSections.push(
        [
          "RESUMEN_IVA_DESCONTABLE_CONSERVADOR:",
          `- IVA usable (con criterios conservadores): ${formatCopForPrompt(vatUsableCop)} (${vatUsableCount} factura${vatUsableCount !== 1 ? "s" : ""})`,
          `- IVA en revisión (faltan soportes o datos dudosos): ${formatCopForPrompt(vatReviewCop)} (${vatReviewCount} factura${vatReviewCount !== 1 ? "s" : ""})`,
          `- IVA no usable (factura incompleta): ${formatCopForPrompt(vatBlockedCop)} (${vatBlockedCount} factura${vatBlockedCount !== 1 ? "s" : ""})`,
          "",
          "INSTRUCCION_IVA_CONSERVADOR:",
          "Cuando el usuario pregunte por IVA descontable, usa SOLO estos datos reales.",
          "NUNCA decir que el IVA ya es 100% descontable legalmente.",
          "Usa siempre estas frases:",
          '- "IVA usable con criterios conservadores"',
          '- "IVA en revisión — faltan soportes o hay datos dudosos"',
          '- "IVA no usable todavía — factura incompleta"',
          "Formato recomendado:",
          "## (1) Resumen IVA",
          "## (2) Qué parte está usable",
          "## (3) Qué parte está en revisión o bloqueada",
          "## (4) Siguiente acción recomendada",
          "Si hay IVA en revisión, recomendar: subir comprobante de pago o corregir datos de factura.",
          "Si hay IVA bloqueado, recomendar: completar datos de la factura antes de considerar el IVA.",
          "Siempre priorizar seguridad y revisión ante la duda.",
        ].join("\n"),
      );
    }

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

    if (financialIntent.enabled && kbSnippetsForModel.length > 0) {
      const kbCfoText = kbSnippetsForModel
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

    if (financialIntent.reason === "invoices_priority") {
      const invoicesPriorityContext = invoicesPrioritySummary ?? {
        top_limit: 10,
        unpaid_total: 0,
        unpaid_count: 0,
        overdue_count: 0,
        overdue_total: 0,
        due_next_7d_total: 0,
        due_next_30d_total: 0,
        by_type: {
          impuesto: 0,
          servicio: 0,
        },
        top_unpaid_invoices: [],
        note: authenticatedUserId
          ? "No hay cuentas por pagar pendientes con datos suficientes."
          : "Usuario no autenticado; no se puede consultar facturas reales.",
      };

      const priorityContext = [
        "ESTRATEGIA_DE_TESORERIA_ACTUAL:",
        `- Facturas vencidas: ${invoicesPriorityContext.overdue_count} (${formatCopForPrompt(invoicesPriorityContext.overdue_total)})`,
        `- Total por pagar en próximos 7 días: ${formatCopForPrompt(invoicesPriorityContext.due_next_7d_total)}`,
        `- Total por pagar en próximos 30 días: ${formatCopForPrompt(invoicesPriorityContext.due_next_30d_total)}`,
        `- CxP tipo impuesto: ${formatCopForPrompt(invoicesPriorityContext.by_type.impuesto)}`,
        `- CxP tipo servicio: ${formatCopForPrompt(invoicesPriorityContext.by_type.servicio)}`,
        "- PRIORIDAD LEGAL SUGERIDA:",
        "  1. Impuestos DIAN (IVA/Retenciones) por riesgo sancionatorio y penal.",
        "  2. Servicios críticos para continuidad operativa.",
        "  3. Proveedores comerciales por antigüedad y cercanía de vencimiento.",
      ].join("\n");

      promptSections.push(
        [
          "INVOICES_PRIORITY_CONTEXT:",
          JSON.stringify(invoicesPriorityContext, null, 2),
          priorityContext,
          "INSTRUCCION_INVOICES_PRIORITY:",
          "Usa este contexto para priorizar pagos sin usar datos bancarios y respetando prioridad legal en Colombia.",
          "Regla legal: obligaciones DIAN (IVA/retenciones) tienen prioridad sobre proveedores comerciales.",
          "Si hay facturas vencidas, priorízalas primero por antigüedad de due_date y luego por tipo (impuesto antes que servicio).",
          "Si no hay due_date en una factura, trátala como prioridad media y sugiere confirmar vencimiento.",
          "Cada factura incluye campo type: impuesto|servicio; úsalo explícitamente en el orden propuesto.",
          "En (2) menciona explícitamente facturas vencidas y próximos 7/30 días usando overdue_count, overdue_total, due_next_7d_total y due_next_30d_total.",
          "En (3) propone un orden de pago operativo priorizando primero impuestos DIAN vencidos, luego servicios críticos, luego demás proveedores.",
          "Formatea montos SIEMPRE en pesos colombianos (COP), por ejemplo: $1.250.000 COP.",
          "Responde SIEMPRE en Markdown con esta estructura exacta:",
          "## (1) Lo que sé",
          "## (2) Cálculo mínimo necesario",
          "## (3) Plan operativo accionable",
          "## (4) Pregunta final",
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
          "Regla 0 (anti-invención): Usa SOLO cifras de FINANCIAL_CONTEXT o CALCULO_ACTUAL; si falta un dato, no inventes.",
          "Regla 1 (modo conversación): ANALISIS_INICIAL = resumen breve de 3-5 bullets. SEGUIMIENTO = empezar con 'Con los nuevos datos…' y recalcular solo lo mínimo (sin repetir resumen completo). Re-resumir solo si hay contradicción entre datos o si el usuario pide explícitamente 'resúmeme todo'.",
          "Regla 2 (foco por obligación): Si el usuario menciona IVA y NO menciona explícitamente renta/impuesto de renta/provisión total, responde SOLO sobre IVA + caja.",
          "Regla 3 (cuándo incluir renta): Solo ejecutar renta/provisión total si el usuario lo pide explícitamente con palabras como: 'renta', 'impuesto de renta', 'provisión total', 'cuánto provisiono total', 'renta neta'.",
          "Regla 4 (presión real antes de dividir):",
          "A) obligacion = iva_to_separate (si pregunta IVA) o total_provision_mvp (solo si el usuario lo pidió explícitamente).",
          "B) faltante_bruto = max(obligacion - liquidez_actual, 0).",
          "C) recursos_movibles = cobros_confirmados + cobros_probables + pagos_diferibles + caja_alternativa + linea_credito_disponible (solo números dados por usuario o en FINANCIAL_CONTEXT).",
          "D) presion_real = max(faltante_bruto - recursos_movibles, 0).",
          "E) SOLO si presion_real > 0: aporte = presion_real / horizonte (días o semanas según lo que dijo el usuario). Si presion_real = 0: no dividir; dar plan de ejecución con calendario simple.",
          "Regla 5 (horizonte y calendario): Si horizonte = N días, usar solo Día 1..Día N. Si horizonte = N semanas, usar solo Semana 1..Semana N. No mezclar unidades ni inventar Día/Semana N+1.",
          "Regla 6 (estrategia operativa): Antes de DIAN, proponer 3 acciones concretas de caja: adelantar cobros, diferir pagos no críticos/renegociar plazos, recortar gasto discrecional inmediato. DIAN solo como último recurso.",
          "Regla 7 (estructura de salida): (1) Lo que sé (breve), (2) Cálculo mínimo necesario, (3) Plan operativo accionable, (4) Máximo 1 pregunta final bloqueante y cerrada si es posible.",
          "Regla 8 (formato obligatorio): Responder SIEMPRE en Markdown usando esta estructura exacta: '## (1) Lo que sé' + bullets, '## (2) Cálculo mínimo necesario', '## (3) Plan operativo accionable', '## (4) Pregunta final'.",
          "Regla 9 (liquidez explícita): Si el usuario dice 'no tengo caja' o 'reventado de caja', tratarlo como liquidez insuficiente; NO decir que no mencionó caja. Pedir monto exacto solo si hace falta para armar cronograma.",
          "Regla 10 (nómina): Prohibido sugerir pago parcial de nómina. Si no alcanza caja, sugerir renegociación de fecha + plan de caja + acciones de liquidez.",
          "Regla 11 (nómina vs IVA): Si preguntan 'nómina o IVA', decidir por vencimiento real: si nómina vence antes, priorizar nómina y crear plan de apartes de IVA; si IVA vence antes, priorizar IVA.",
          "Regla 12 (Markdown): Mantener siempre saltos de línea y secciones separadas con encabezados '## (1)'...'## (4)'.",
          "Seguridad: Nunca sugerir evasión, ocultamiento de ingresos, facturación falsa ni prácticas ilegales."
        ].join("\n"),
      );
    }

    

    const REGLAS_DE_ORO = [
      "REGLAS DE ORO:",
      "- OMITE introducciones como \"Soy tu CFO\", \"Como experto...\", o \"He analizado tus documentos\".",
      "- OMITE confirmaciones de lectura.",
      "- RESPUESTA DIRECTA: Empieza siempre con la información solicitada. Si pregunto por una fecha, la primera palabra de tu respuesta debe ser la fecha o el contexto de la misma.",
      "- TONO: Profesional, técnico y breve. Usa el Calendario 2026 y el Estatuto Tributario como si fueran tu propia memoria, sin citarlos a menos que sea necesario para dar validez (ej: \"Según el Art. X...\").",
      "- LENGUAJE SIMPLE: Nunca uses un código fiscal o contable (como 'Formulario 350') sin antes explicar que es de forma simplificada (ej: Retención en la Fuente) y qué implicaciones tiene para el negocio.",
      "- FORMATO: Manten la tabla Markdown con los emojis (🔴, 🟡, 🟢) solo cuando se listen facturas, sin textos de relleno antes o después.",
      "",
      "FORMATO DE RESPUESTA FINANCIERA OBLIGATORIO:",
      "Cuando el usuario haga una pregunta sobre facturas, pagos, impuestos, provisiones, caja o tesorería, usa SIEMPRE esta estructura:",
      "",
      "## (1) Resumen",
      "- Nº facturas pendientes, total pendiente, vencidas (si aplica)",
      "- Máximo 3-4 bullets concisos",
      "",
      "## (2) Prioridad de pagos",
      "- Lista clara: proveedor, monto, fecha, motivo (vence antes / crítica / impuesto DIAN)",
      "- Si hay facturas, usar tabla Markdown con 🔴/🟡/🟢",
      "",
      "## (3) Impacto en caja",
      "- Total próximos 7 días",
      "- Total próximos 30 días",
      "- Provisión estimada pendiente (si hay datos fiscales)",
      "",
      "## (4) Acción recomendada",
      "- Instrucciones claras y ejecutables",
      "- NO teoría fiscal larga",
      "- Máximo 3 pasos concretos",
      "",
      "EXCEPCIONES al formato (1)-(4):",
      "- Saludos simples: responder con saludo y pregunta de en qué ayudar",
      "- Preguntas conceptuales (\"qué es IVA\"): responder directo sin estructura (1)-(4)",
      "- Si NO hay datos financieros del usuario: pedir los datos necesarios, no inventar",
    ].join("\n");

    const fullPrompt = [
      REGLAS_DE_ORO,
      ventanillaUnicaSystemPrompt,
      "PRIORIDAD_LEGAL_COLOMBIA: En estrategia de tesorería, prioriza deudas DIAN (IVA y retenciones) sobre proveedores comerciales por mayor riesgo legal/sancionatorio. Cuando existan montos, exprésalos en COP con formato colombiano.",
      promptSections.join("\n\n"),
    ].join("\n\n");

    const baseGeminiHistory = history.map((item: any) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));

    const geminiHistory = [
      {
        role: "user",
        parts: [
          { fileData: { mimeType: "application/pdf", fileUri: "https://generativelanguage.googleapis.com/v1beta/files/xmjzrh532617" } },
          { fileData: { mimeType: "application/pdf", fileUri: "https://generativelanguage.googleapis.com/v1beta/files/fwodctvd7yy1" } },
          { fileData: { mimeType: "application/pdf", fileUri: "https://generativelanguage.googleapis.com/v1beta/files/781kmh61cfr7" } },
          { text: "INSTRUCCIONES Y CONTEXTO INICIAL:\n" + fullPrompt }
        ],
      },
      {
        role: "model",
        parts: [{ text: "Listo. ¿Qué consulta tienes sobre tus cuentas o la normativa?" }],
      },
      ...baseGeminiHistory
    ];

    let reply = "";
    let openAiDurationMs = 0;
    const openAiStart = Date.now();
    const hasGeminiApiKey = Boolean(geminiApiKey);

    console.info("[api/chat] Gemini request started", {
      model: geminiModel,
      hasGeminiApiKey,
    });

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview",
        systemInstruction: fullPrompt,
      });

      const chat = model.startChat({ history: geminiHistory });
      const result = await chat.sendMessage(message);
      openAiDurationMs = Date.now() - openAiStart;

      console.info("[api/chat] Gemini request completed", {
        model: geminiModel,
        hasGeminiApiKey,
        openAiDurationMs,
      });

      if (DEBUG_TAX) {
        const { calcStatus, errorCode } = getCalcDebugState(taxIntentDetected, calcActualPayload);

        console.info("[api/chat] Tax debug summary", {
          taxIntentDetected,
          financialIntentDetected: financialIntent.enabled,
          financialIntentReason: financialIntent.reason,
          financialIntentMatchedKeyword: financialIntent.matchedKeyword,
          kbSnippetIdsUsed,
          calcStatus,
          errorCode,
          model: geminiModel,
          openai_duration_ms: openAiDurationMs,
          user_id: userIdMaskedForDebug,
        });
      }

      reply = result.response.text()?.trim() ?? "";
    } catch (error) {
      openAiDurationMs = Date.now() - openAiStart;

      const aiProviderError = error as AiProviderErrorLike;
      const errorStatus =
        typeof aiProviderError.status === "number" ? aiProviderError.status : undefined;

      console.error("[api/chat] Gemini request failed", {
        model: geminiModel,
        hasGeminiApiKey,
        openAiDurationMs,
        errorName: aiProviderError.name,
        errorMessage: aiProviderError.message,
        errorStatus,
      });

      if (DEBUG_TAX) {
        const { calcStatus, errorCode } = getCalcDebugState(taxIntentDetected, calcActualPayload);

        console.error("[api/chat] Tax debug summary", {
          taxIntentDetected,
          financialIntentDetected: financialIntent.enabled,
          financialIntentReason: financialIntent.reason,
          financialIntentMatchedKeyword: financialIntent.matchedKeyword,
          kbSnippetIdsUsed,
          calcStatus,
          errorCode,
          model: geminiModel,
          openai_duration_ms: openAiDurationMs,
          user_id: userIdMaskedForDebug,
        });
      }

      logChatRequest({
        ip: clientIp,
        userId: userIdForLog,
        messageLength,
        model: geminiModel,
        openAiDurationMs,
      });

      if (isTimeoutError(aiProviderError)) {
        throw new ApiError(504, "Gemini timeout");
      }

      if (errorStatus === 401 || errorStatus === 403) {
        throw new ApiError(502, "Gemini auth error");
      }

      if (isModelNotFoundError(aiProviderError)) {
        throw new ApiError(502, `Model not found: ${geminiModel}`);
      }

      throw new ApiError(502, "Error generando respuesta con Gemini.");
    }

    if (!reply) {
      throw new ApiError(502, "Gemini no devolvio texto de respuesta.");
    }

    if (DEBUG_TAX) {
      console.info("[api/chat] Assistant message fingerprint", {
        assistant_message_length: reply.length,
        assistant_message_hash: hashStringValue(reply),
      });
    }

    if (!allowAnonymousChat) {
      const { error: insertAssistantMessageError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: reply,
          user_id: authenticatedUserId,
        });

      if (insertAssistantMessageError) {
        throw new ApiError(500, "Error guardando el mensaje del asistente.");
      }
    }

    logChatRequest({
      ip: clientIp,
      userId: userIdForLog,
      messageLength,
      model: geminiModel,
      openAiDurationMs,
    });

    const recommendedActions = buildRecommendedActions(
      allInvoicesForActions,
      financialIntent.enabled,
      reviewQueueItems,
    );

    const bulkRecommendations = financialIntent.enabled
      ? getBulkRecommendations(reviewQueueItems)
      : [];

    return NextResponse.json({
      conversationId,
      reply,
      recommended_actions: recommendedActions,
      bulk_recommendations: bulkRecommendations,
      weekly_plan: weeklyPlanPayload,
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
