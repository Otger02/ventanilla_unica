import { NextResponse } from "next/server";

import { calculateMonthlyProvisionCO } from "@/lib/tax/calculators/colombia/monthlyProvision";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type UserTaxProfileRow = {
  user_id: string;
  persona_type: "natural" | "juridica" | "unknown";
  regimen: "simple" | "ordinario" | "unknown";
  vat_responsible: "yes" | "no" | "unknown";
  provision_style: "conservative" | "balanced" | "aggressive";
  municipality: string | null;
};

type MonthlyTaxInputRow = {
  user_id: string;
  year: number;
  month: number;
  income_cop: number;
  deductible_expenses_cop: number;
  withholdings_cop: number;
  vat_collected_cop: number;
};

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

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const { data: profileData, error: profileError } = await supabase
      .from("user_tax_profile_co")
      .select("user_id, persona_type, regimen, vat_responsible, provision_style, municipality")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: "No se pudo obtener el perfil fiscal." }, { status: 500 });
    }

    if (!profileData) {
      return NextResponse.json({ error: "Completa tus datos del mes para calcular." }, { status: 400 });
    }

    const { data: monthlyInputData, error: monthlyInputError } = await supabase
      .from("monthly_tax_inputs_co")
      .select(
        "user_id, year, month, income_cop, deductible_expenses_cop, withholdings_cop, vat_collected_cop",
      )
      .eq("user_id", user.id)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (monthlyInputError) {
      return NextResponse.json({ error: "No se pudo obtener el input mensual." }, { status: 500 });
    }

    if (!monthlyInputData) {
      return NextResponse.json({ error: "Completa tus datos del mes para calcular." }, { status: 400 });
    }

    const profile = profileData as UserTaxProfileRow;
    const inputs = monthlyInputData as MonthlyTaxInputRow;

    const result = calculateMonthlyProvisionCO(profile, inputs);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      period: {
        year,
        month,
      },
      profile: {
        persona_type: profile.persona_type,
        regimen: profile.regimen,
        vat_responsible: profile.vat_responsible,
        provision_style: profile.provision_style,
        municipality: profile.municipality,
      },
      inputs: {
        income_cop: inputs.income_cop,
        deductible_expenses_cop: inputs.deductible_expenses_cop,
        withholdings_cop: inputs.withholdings_cop,
        vat_collected_cop: inputs.vat_collected_cop,
      },
      breakdown: result.breakdown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno.";

    return NextResponse.json(
      { error: "No se pudo calcular la provision mensual.", details: message },
      { status: 500 },
    );
  }
}
