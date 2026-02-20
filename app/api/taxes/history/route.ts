import { NextRequest, NextResponse } from "next/server";

import { calculateMonthlyProvisionCO } from "@/lib/tax/calculators/colombia/monthlyProvision";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type UserTaxProfileRow = {
  user_id: string;
  persona_type: "natural" | "juridica" | "unknown";
  regimen: "simple" | "ordinario" | "unknown";
  vat_responsible: "yes" | "no" | "unknown";
  provision_style: "conservative" | "balanced" | "aggressive";
};

type MonthlyTaxInputRow = {
  year: number;
  month: number;
  income_cop: number;
  deductible_expenses_cop: number;
  withholdings_cop: number;
  vat_collected_cop: number;
};

function parseMonths(value: string | null): number | null {
  if (!value) {
    return 6;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 1 || parsed > 24) {
    return null;
  }

  return parsed;
}

function periodToNumber(year: number, month: number): number {
  return year * 12 + month;
}

export async function GET(request: NextRequest) {
  try {
    const months = parseMonths(request.nextUrl.searchParams.get("months"));

    if (months === null) {
      return NextResponse.json({ error: "Parametro months invalido. Usa un entero entre 1 y 24." }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const { data: profileData, error: profileError } = await supabase
      .from("user_tax_profile_co")
      .select("user_id, persona_type, regimen, vat_responsible, provision_style")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: "No se pudo obtener el perfil fiscal." }, { status: 500 });
    }

    if (!profileData) {
      return NextResponse.json({ items: [] });
    }

    const { data: monthlyRowsData, error: monthlyRowsError } = await supabase
      .from("monthly_tax_inputs_co")
      .select("year, month, income_cop, deductible_expenses_cop, withholdings_cop, vat_collected_cop")
      .eq("user_id", user.id)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(24);

    if (monthlyRowsError) {
      return NextResponse.json({ error: "No se pudo obtener el histórico mensual." }, { status: 500 });
    }

    const profile = profileData as UserTaxProfileRow;
    const monthlyRows = (monthlyRowsData ?? []) as MonthlyTaxInputRow[];

    const now = new Date();
    const currentPeriodNumber = periodToNumber(now.getFullYear(), now.getMonth() + 1);
    const minPeriodNumber = currentPeriodNumber - (months - 1);

    const filteredRows = monthlyRows
      .filter((row) => periodToNumber(row.year, row.month) >= minPeriodNumber)
      .sort((a, b) => periodToNumber(a.year, a.month) - periodToNumber(b.year, b.month));

    const items = filteredRows
      .map((row) => {
        const result = calculateMonthlyProvisionCO(profile, row);

        if (!result.ok) {
          return null;
        }

        return {
          year: row.year,
          month: row.month,
          income_cop: row.income_cop,
          deductible_expenses_cop: row.deductible_expenses_cop,
          totalProvision: result.breakdown.totalProvision,
          cashAfterProvision: result.breakdown.cashAfterProvision,
          riskLevel: result.breakdown.riskLevel,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno.";

    return NextResponse.json(
      { error: "No se pudo obtener el histórico tributario.", details: message },
      { status: 500 },
    );
  }
}
