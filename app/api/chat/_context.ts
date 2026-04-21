import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type UserTaxProfileRow,
  type MonthlyTaxInputRow,
  type FinancialContextPayload,
  type CurrentTaxCalculation,
  type RequiredProfileField,
  type RecommendedAction,
  REQUIRED_PROFILE_FIELDS,
  worstConfidence,
} from "./_types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { calculateMonthlyProvisionCO } from "@/lib/tax/calculators/colombia/monthlyProvision";
import type { ReviewQueueItem, ReviewAction, ConfidenceLevel } from "@/lib/invoices/getReviewQueue";

export function buildProfileSnapshot(profileData: UserTaxProfileRow | null) {
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

export function getMissingProfileFields(profileSnapshot: ReturnType<typeof buildProfileSnapshot>) {
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

export async function getFinancialContextPayload(
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

export async function getCurrentTaxCalculation(
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

export async function fetchAllInvoiceData(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: rawInvoices } = await supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, total_cop, due_date, payment_status, payment_url, supplier_portal_url, scheduled_payment_date, data_quality_status, vat_status, iva_cop, assigned_to_label")
    .eq("user_id", userId)
    .order("due_date", { ascending: true, nullsFirst: false });

  let pendingInvoicesList: { supplier_name: string; total_cop: number; due_date: string; payment_status: string }[] = [];
  let allInvoicesForActions: { id: string; supplier_name: string | null; invoice_number: string | null; total_cop: number | null; due_date: string | null; payment_status: string; payment_url: string | null; supplier_portal_url: string | null; scheduled_payment_date: string | null }[] = [];
  let allInvoicesRaw: { id: string; supplier_name: string | null; invoice_number: string | null; total_cop: number | null; iva_cop: number | null; due_date: string | null; payment_status: string | null; data_quality_status: string | null; vat_status: string | null; assigned_to_label: string | null }[] = [];
  let dataQualityWarningCount = 0;
  let dataQualityIncompleteCount = 0;
  let dataQualitySuspectCount = 0;

  if (rawInvoices) {
    allInvoicesRaw = rawInvoices as any;
    dataQualityIncompleteCount = rawInvoices.filter((inv: any) => inv.data_quality_status === "incomplete").length;
    dataQualitySuspectCount = rawInvoices.filter((inv: any) => inv.data_quality_status === "suspect").length;
    dataQualityWarningCount = dataQualityIncompleteCount + dataQualitySuspectCount;
    pendingInvoicesList = rawInvoices.filter((inv: any) => inv.data_quality_status !== "incomplete");
    allInvoicesForActions = rawInvoices.filter((inv: any) => inv.data_quality_status !== "incomplete");
  }

  // VAT summary
  let vatUsableCop = 0;
  let vatReviewCop = 0;
  let vatBlockedCop = 0;
  let vatReviewCount = 0;
  let vatBlockedCount = 0;
  let vatUsableCount = 0;
  if (allInvoicesForActions.length > 0) {
    for (const inv of allInvoicesForActions as any[]) {
      const ivaCop = typeof inv.iva_cop === "number" ? inv.iva_cop : 0;
      if (inv.vat_status === "iva_usable") { vatUsableCop += ivaCop; vatUsableCount++; }
      else if (inv.vat_status === "iva_en_revision") { vatReviewCop += ivaCop; vatReviewCount++; }
      else if (inv.vat_status === "iva_no_usable") { vatBlockedCop += ivaCop; vatBlockedCount++; }
    }
  }

  return {
    pendingInvoicesList,
    allInvoicesForActions,
    allInvoicesRaw,
    dataQualityWarningCount,
    dataQualityIncompleteCount,
    dataQualitySuspectCount,
    vatUsableCop,
    vatReviewCop,
    vatBlockedCop,
    vatUsableCount,
    vatReviewCount,
    vatBlockedCount,
  };
}

export async function fetchTaxProfileString(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
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

    return "El usuario actual tiene el NIT " + profileRow.nit +
      " (Último dígito: " + ultimoDigito + ") y tiene estas responsabilidades: [" +
      responsabilidades.join(", ") + "]. Cuando consultes el Calendario 2026, ignora todo lo que no aplique a su último dígito o sus responsabilidades.";
  }

  return "";
}

export function buildRecommendedActions(
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
