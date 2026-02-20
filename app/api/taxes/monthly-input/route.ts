import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type MonthlyInputRow = {
  id: string;
  user_id: string;
  year: number;
  month: number;
  income_cop: number;
  deductible_expenses_cop: number;
  withholdings_cop: number;
  vat_collected_cop: number;
  notes: string | null;
  created_at: string;
};

type MonthlyInputPayload = {
  year?: number;
  month?: number;
  income_cop?: number;
  deductible_expenses_cop?: number;
  withholdings_cop?: number;
  vat_collected_cop?: number;
  notes?: string | null;
};

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function isValidYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 3000;
}

function isValidMonth(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

function toSafeNumeric(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function sanitizePayload(payload: MonthlyInputPayload) {
  if (
    typeof payload.year !== "number" ||
    !Number.isInteger(payload.year) ||
    typeof payload.month !== "number" ||
    !Number.isInteger(payload.month)
  ) {
    return { error: "year y month son obligatorios." } as const;
  }

  const year = payload.year;
  const month = payload.month;

  if (!isValidYear(year)) {
    return { error: "year invalido." } as const;
  }

  if (!isValidMonth(month)) {
    return { error: "month invalido (1-12)." } as const;
  }

  const incomeCop = toSafeNumeric(payload.income_cop ?? 0);
  const deductibleExpensesCop = toSafeNumeric(payload.deductible_expenses_cop ?? 0);
  const withholdingsCop = toSafeNumeric(payload.withholdings_cop ?? 0);
  const vatCollectedCop = toSafeNumeric(payload.vat_collected_cop ?? 0);

  if (incomeCop === null) {
    return { error: "income_cop invalido." } as const;
  }

  if (deductibleExpensesCop === null) {
    return { error: "deductible_expenses_cop invalido." } as const;
  }

  if (withholdingsCop === null) {
    return { error: "withholdings_cop invalido." } as const;
  }

  if (vatCollectedCop === null) {
    return { error: "vat_collected_cop invalido." } as const;
  }

  const notes = payload.notes === undefined || payload.notes === null ? null : String(payload.notes).trim() || null;

  return {
    data: {
      year,
      month,
      income_cop: incomeCop,
      deductible_expenses_cop: deductibleExpensesCop,
      withholdings_cop: withholdingsCop,
      vat_collected_cop: vatCollectedCop,
      notes,
    },
  } as const;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const year = parsePositiveInt(request.nextUrl.searchParams.get("year"));
    const month = parsePositiveInt(request.nextUrl.searchParams.get("month"));

    if (year === null || month === null) {
      return NextResponse.json({ error: "Query params year y month son obligatorios." }, { status: 400 });
    }

    if (!isValidYear(year)) {
      return NextResponse.json({ error: "year invalido." }, { status: 400 });
    }

    if (!isValidMonth(month)) {
      return NextResponse.json({ error: "month invalido (1-12)." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("monthly_tax_inputs_co")
      .select(
        "id, user_id, year, month, income_cop, deductible_expenses_cop, withholdings_cop, vat_collected_cop, notes, created_at",
      )
      .eq("user_id", user.id)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "No se pudo obtener el input mensual." }, { status: 500 });
    }

    return NextResponse.json({ input: (data as MonthlyInputRow | null) ?? null });
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

    const body = (await request.json()) as MonthlyInputPayload;
    const sanitized = sanitizePayload(body ?? {});

    if ("error" in sanitized) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("monthly_tax_inputs_co")
      .upsert(
        {
          user_id: user.id,
          ...sanitized.data,
        },
        { onConflict: "user_id,year,month" },
      )
      .select(
        "id, user_id, year, month, income_cop, deductible_expenses_cop, withholdings_cop, vat_collected_cop, notes, created_at",
      )
      .single();

    if (error) {
      return NextResponse.json({ error: "No se pudo guardar el input mensual." }, { status: 500 });
    }

    return NextResponse.json({ input: data as MonthlyInputRow });
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
