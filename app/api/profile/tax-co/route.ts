import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type PersonaType = "natural" | "juridica" | "unknown";
type ActivityType = "services" | "commerce" | "mixed" | "unknown";
type RegimenType = "simple" | "ordinario" | "unknown";
type VatResponsibleType = "yes" | "no" | "unknown";
type ProvisionStyleType = "conservative" | "balanced" | "aggressive";
type TaxpayerType = "natural" | "juridica" | "individual" | "company" | "unknown";
type LegalType =
  | "sas"
  | "sa"
  | "ltda"
  | "eirl"
  | "sucursal"
  | "esal"
  | "other"
  | "unknown";
type VatPeriodicityType =
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "annual"
  | "bimestral"
  | "cuatrimestral"
  | "anual"
  | "not_applicable"
  | "unknown";

type TaxProfileRow = {
  user_id: string;
  created_at: string;
  updated_at: string;
  persona_type: PersonaType;
  activity_type: ActivityType;
  regimen: RegimenType;
  vat_responsible: VatResponsibleType;
  provision_style: ProvisionStyleType;
  taxpayer_type: TaxpayerType;
  legal_type: LegalType;
  vat_periodicity: VatPeriodicityType;
  monthly_fixed_costs_cop: number;
  monthly_payroll_cop: number;
  monthly_debt_payments_cop: number;
  municipality: string | null;
  start_date: string | null;
  nombre_razon_social: string | null;
  nit_dv: string | null;
};

type TaxProfilePayload = {
  persona_type?: PersonaType;
  activity_type?: ActivityType;
  regimen?: RegimenType;
  vat_responsible?: VatResponsibleType;
  provision_style?: ProvisionStyleType;
  taxpayer_type?: TaxpayerType;
  legal_type?: LegalType;
  vat_periodicity?: VatPeriodicityType;
  monthly_fixed_costs_cop?: number | string | null;
  monthly_payroll_cop?: number | string | null;
  monthly_debt_payments_cop?: number | string | null;
  municipality?: string | null;
  start_date?: string | null;
};

const validPersonaTypes: PersonaType[] = ["natural", "juridica", "unknown"];
const validActivityTypes: ActivityType[] = ["services", "commerce", "mixed", "unknown"];
const validRegimenTypes: RegimenType[] = ["simple", "ordinario", "unknown"];
const validVatResponsibleTypes: VatResponsibleType[] = ["yes", "no", "unknown"];
const validProvisionStyles: ProvisionStyleType[] = ["conservative", "balanced", "aggressive"];
const validTaxpayerTypes: TaxpayerType[] = ["natural", "juridica", "individual", "company", "unknown"];
const validLegalTypes: LegalType[] = ["sas", "sa", "ltda", "eirl", "sucursal", "esal", "other", "unknown"];
const validVatPeriodicities: VatPeriodicityType[] = [
  "monthly",
  "bimonthly",
  "quarterly",
  "annual",
  "bimestral",
  "cuatrimestral",
  "anual",
  "not_applicable",
  "unknown",
];

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString().slice(0, 10) === value;
}

function parseNonNegativeNumber(
  value: number | string | null | undefined,
  fieldName: string,
): { value: number } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { value: 0 };
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return { error: `Campo ${fieldName} inválido.` };
  }

  return { value: parsed };
}

function sanitizePayload(payload: TaxProfilePayload) {
  const personaType = payload.persona_type ?? "unknown";
  const activityType = payload.activity_type ?? "unknown";
  const regimen = payload.regimen ?? "unknown";
  const vatResponsible = payload.vat_responsible ?? "unknown";
  const provisionStyle = payload.provision_style ?? "balanced";
  const taxpayerType = payload.taxpayer_type ?? "unknown";
  const legalType = payload.legal_type ?? "unknown";
  const vatPeriodicity = payload.vat_periodicity ?? "unknown";

  if (!validPersonaTypes.includes(personaType)) {
    return { error: "Campo persona_type inválido." } as const;
  }

  if (!validActivityTypes.includes(activityType)) {
    return { error: "Campo activity_type inválido." } as const;
  }

  if (!validRegimenTypes.includes(regimen)) {
    return { error: "Campo regimen inválido." } as const;
  }

  if (!validVatResponsibleTypes.includes(vatResponsible)) {
    return { error: "Campo vat_responsible inválido." } as const;
  }

  if (!validProvisionStyles.includes(provisionStyle)) {
    return { error: "Campo provision_style inválido." } as const;
  }

  if (!validTaxpayerTypes.includes(taxpayerType)) {
    return { error: "Campo taxpayer_type inválido." } as const;
  }

  if (!validLegalTypes.includes(legalType)) {
    return { error: "Campo legal_type inválido." } as const;
  }

  if (!validVatPeriodicities.includes(vatPeriodicity)) {
    return { error: "Campo vat_periodicity inválido." } as const;
  }

  const monthlyFixedCosts = parseNonNegativeNumber(
    payload.monthly_fixed_costs_cop,
    "monthly_fixed_costs_cop",
  );
  if ("error" in monthlyFixedCosts) {
    return { error: monthlyFixedCosts.error } as const;
  }

  const monthlyPayroll = parseNonNegativeNumber(payload.monthly_payroll_cop, "monthly_payroll_cop");
  if ("error" in monthlyPayroll) {
    return { error: monthlyPayroll.error } as const;
  }

  const monthlyDebtPayments = parseNonNegativeNumber(
    payload.monthly_debt_payments_cop,
    "monthly_debt_payments_cop",
  );
  if ("error" in monthlyDebtPayments) {
    return { error: monthlyDebtPayments.error } as const;
  }

  const municipalityRaw = payload.municipality;
  const municipality =
    municipalityRaw === undefined || municipalityRaw === null
      ? null
      : String(municipalityRaw).trim() || null;

  const startDateRaw = payload.start_date;
  let startDate: string | null = null;

  if (startDateRaw !== undefined && startDateRaw !== null && String(startDateRaw).trim() !== "") {
    const normalizedDate = String(startDateRaw).trim();
    if (!isValidIsoDate(normalizedDate)) {
      return { error: "start_date invalido. Usa formato YYYY-MM-DD." } as const;
    }
    startDate = normalizedDate;
  }

  return {
    data: {
      persona_type: personaType,
      activity_type: activityType,
      regimen,
      vat_responsible: vatResponsible,
      provision_style: provisionStyle,
      taxpayer_type: taxpayerType,
      legal_type: legalType,
      vat_periodicity: vatPeriodicity,
      monthly_fixed_costs_cop: monthlyFixedCosts.value,
      monthly_payroll_cop: monthlyPayroll.value,
      monthly_debt_payments_cop: monthlyDebtPayments.value,
      municipality,
      start_date: startDate,
    },
  } as const;
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("user_tax_profile_co")
      .select(
        "user_id, created_at, updated_at, persona_type, activity_type, regimen, vat_responsible, provision_style, taxpayer_type, legal_type, vat_periodicity, monthly_fixed_costs_cop, monthly_payroll_cop, monthly_debt_payments_cop, municipality, start_date, nombre_razon_social, nit_dv",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "No se pudo obtener el perfil tributario." }, { status: 500 });
    }

    return NextResponse.json({ profile: (data as TaxProfileRow | null) ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno.";
    return NextResponse.json(
      { error: "No se pudo procesar la solicitud.", details: message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const body = (await request.json()) as TaxProfilePayload;
    const sanitized = sanitizePayload(body ?? {});

    if ("error" in sanitized) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("user_tax_profile_co")
      .upsert(
        {
          user_id: user.id,
          ...sanitized.data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select(
        "user_id, created_at, updated_at, persona_type, activity_type, regimen, vat_responsible, provision_style, taxpayer_type, legal_type, vat_periodicity, monthly_fixed_costs_cop, monthly_payroll_cop, monthly_debt_payments_cop, municipality, start_date, nombre_razon_social, nit_dv",
      )
      .single();

    if (error) {
      return NextResponse.json({ error: "No se pudo guardar el perfil tributario." }, { status: 500 });
    }

    return NextResponse.json({ profile: data as TaxProfileRow });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Error interno.";
    return NextResponse.json(
      { error: "No se pudo procesar la solicitud.", details: message },
      { status: 500 },
    );
  }
}
