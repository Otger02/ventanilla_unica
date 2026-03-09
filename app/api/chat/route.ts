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

    let pendingInvoicesList: { supplier_name: string, total_cop: number, due_date: string }[] = [];
    if (authenticatedUserId) {
      const { data: rawInvoices } = await supabase
        .from("invoices")
        .select("supplier_name, total_cop, due_date")
        .eq("user_id", authenticatedUserId)
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      if (rawInvoices) pendingInvoicesList = rawInvoices;
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

    if (pendingInvoicesList && pendingInvoicesList.length > 0) {
      promptSections.push(
        [
          "PENDING_INVOICES_LIST_REAL_DATA:",
          JSON.stringify(pendingInvoicesList, null, 2),
          "INSTRUCCION_FACTURAS_PENDIENTES:",
            "Usa esta lista para responder si el usuario pregunta sobre sus facturas.",
            "HOY ES EL 6 DE MARZO DE 2026. Al listar facturas actúa con visión de CFO y aplica la siguiente lógica de semáforo priorizando pagos:",
            "🔴 Vencida: Si la due_date es estricta o anterior al 6 de marzo de 2026.",
            "🟡 Urgente: Si la due_date tiene vencimiento dentro de los próximos 5 días (hasta el 11 de marzo).",
            "🟢 Al día: Si tiene más de 5 días de plazo.",
            "Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas: Estatus (Emoji 🔴/🟡/🟢), Proveedor, Monto (COP), y Vencimiento.",
            "Al final de la lista, debes calcular OBLIGATORIAMENTE y mostrar resaltado el Gran Total Pendiente sumando todos los montos, formateado correctamente en pesos colombianos.",
            "Tu tono debe ser resolutivo, profesional y proactivo. Además de la tabla, debes mencionar brevemente una recomendación estratégica sobre qué facturas priorizar sus pagos según el grado de urgimiento y liquidez operativa del mes."
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

    const fullPrompt = [
      ventanillaUnicaSystemPrompt,
      "PRIORIDAD_LEGAL_COLOMBIA: En estrategia de tesorería, prioriza deudas DIAN (IVA y retenciones) sobre proveedores comerciales por mayor riesgo legal/sancionatorio. Cuando existan montos, exprésalos en COP con formato colombiano.",
      promptSections.join("\n\n"),
    ].join("\n\n");

    const geminiHistory = history.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));

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

