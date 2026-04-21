import { getPayablesSummary } from "@/lib/invoices/getPayablesSummary";
import type { ConfidenceLevel, ConfidenceResult, ReviewAction } from "@/lib/invoices/getReviewQueue";

export type ChatRequestBody = {
  conversationId?: string;
  message?: string;
};

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type UserTaxProfileRow = {
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

export type MonthlyTaxInputRow = {
  year: number;
  month: number;
  income_cop: number;
  deductible_expenses_cop: number;
  withholdings_cop: number;
  vat_collected_cop: number;
};

export type FinancialContextPayload = {
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

export type InvoicesPrioritySummary = Awaited<ReturnType<typeof getPayablesSummary>>;

export type FinancialIntentReason =
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

export type CurrentTaxCalculation =
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

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type AiProviderErrorLike = {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

export const REQUIRED_PROFILE_FIELDS = [
  "taxpayer_type",
  "regimen",
  "vat_responsible",
  "vat_periodicity",
  "monthly_fixed_costs_cop",
  "monthly_payroll_cop",
  "monthly_debt_payments_cop",
] as const;

export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export type RecommendedAction = {
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

export function formatPeriodLabelEs(year: number, month: number): string {
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

export function formatCopForPrompt(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function worstConfidence(
  map: Record<string, ConfidenceResult>,
): ConfidenceLevel {
  const levels = Object.values(map).map((r) => r.level);
  if (levels.includes("blocked")) return "blocked";
  if (levels.includes("review")) return "review";
  return "safe";
}
