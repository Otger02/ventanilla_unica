import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type PersonaType = "natural" | "juridica" | "unknown";
type ActivityType = "services" | "commerce" | "mixed" | "unknown";
type RegimenType = "simple" | "ordinario" | "unknown";
type VatResponsibleType = "yes" | "no" | "unknown";
type ProvisionStyleType = "conservative" | "balanced" | "aggressive";

type TaxProfileRow = {
  user_id: string;
  created_at: string;
  updated_at: string;
  persona_type: PersonaType;
  activity_type: ActivityType;
  regimen: RegimenType;
  vat_responsible: VatResponsibleType;
  provision_style: ProvisionStyleType;
  municipality: string | null;
  start_date: string | null;
};

type TaxProfilePayload = {
  persona_type?: PersonaType;
  activity_type?: ActivityType;
  regimen?: RegimenType;
  vat_responsible?: VatResponsibleType;
  provision_style?: ProvisionStyleType;
  municipality?: string | null;
  start_date?: string | null;
};

const validPersonaTypes: PersonaType[] = ["natural", "juridica", "unknown"];
const validActivityTypes: ActivityType[] = ["services", "commerce", "mixed", "unknown"];
const validRegimenTypes: RegimenType[] = ["simple", "ordinario", "unknown"];
const validVatResponsibleTypes: VatResponsibleType[] = ["yes", "no", "unknown"];
const validProvisionStyles: ProvisionStyleType[] = ["conservative", "balanced", "aggressive"];

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

function sanitizePayload(payload: TaxProfilePayload) {
  const personaType = payload.persona_type ?? "unknown";
  const activityType = payload.activity_type ?? "unknown";
  const regimen = payload.regimen ?? "unknown";
  const vatResponsible = payload.vat_responsible ?? "unknown";
  const provisionStyle = payload.provision_style ?? "balanced";

  if (!validPersonaTypes.includes(personaType)) {
    return { error: "persona_type invalido." } as const;
  }

  if (!validActivityTypes.includes(activityType)) {
    return { error: "activity_type invalido." } as const;
  }

  if (!validRegimenTypes.includes(regimen)) {
    return { error: "regimen invalido." } as const;
  }

  if (!validVatResponsibleTypes.includes(vatResponsible)) {
    return { error: "vat_responsible invalido." } as const;
  }

  if (!validProvisionStyles.includes(provisionStyle)) {
    return { error: "provision_style invalido." } as const;
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
        "user_id, created_at, updated_at, persona_type, activity_type, regimen, vat_responsible, provision_style, municipality, start_date",
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
        "user_id, created_at, updated_at, persona_type, activity_type, regimen, vat_responsible, provision_style, municipality, start_date",
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
