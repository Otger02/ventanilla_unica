import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DEFAULT_PREFERENCES, type OperatingPreferences } from "@/lib/invoices/applyOperatingPreferences";

export const dynamic = "force-dynamic";

// ─── Validation ───

const VALID_STYLES = ["conservative", "balanced", "aggressive"] as const;
const VALID_FOCUSES = ["cash", "compliance", "cleanup"] as const;
const VALID_DAYS = ["lunes", "martes", "miercoles", "jueves", "viernes"] as const;
const VALID_VIEW_MODES = ["owner", "advisor"] as const;

function sanitizePreferences(
  body: Record<string, unknown>,
): { error: string } | { data: Partial<Omit<OperatingPreferences, "notes">> & { notes?: string | null } } {
  const data: Record<string, unknown> = {};

  if ("preferred_action_style" in body) {
    const v = body.preferred_action_style;
    if (typeof v !== "string" || !(VALID_STYLES as readonly string[]).includes(v)) {
      return { error: `preferred_action_style debe ser: ${VALID_STYLES.join(", ")}` };
    }
    data.preferred_action_style = v;
  }

  if ("preferred_weekly_focus" in body) {
    const v = body.preferred_weekly_focus;
    if (v !== null && (typeof v !== "string" || !(VALID_FOCUSES as readonly string[]).includes(v))) {
      return { error: `preferred_weekly_focus debe ser null o: ${VALID_FOCUSES.join(", ")}` };
    }
    data.preferred_weekly_focus = v;
  }

  if ("preferred_schedule_day" in body) {
    const v = body.preferred_schedule_day;
    if (v !== null && (typeof v !== "string" || !(VALID_DAYS as readonly string[]).includes(v))) {
      return { error: `preferred_schedule_day debe ser null o: ${VALID_DAYS.join(", ")}` };
    }
    data.preferred_schedule_day = v;
  }

  if ("max_weekly_execution_count" in body) {
    const v = body.max_weekly_execution_count;
    if (v !== null) {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        return { error: "max_weekly_execution_count debe ser null o un número entre 1 y 50" };
      }
      data.max_weekly_execution_count = n;
    } else {
      data.max_weekly_execution_count = null;
    }
  }

  if ("notes" in body) {
    const v = body.notes;
    if (v !== null && typeof v !== "string") {
      return { error: "notes debe ser null o texto" };
    }
    data.notes = v === null ? null : String(v).trim().slice(0, 500) || null;
  }

  if ("preferred_view_mode" in body) {
    const v = body.preferred_view_mode;
    if (typeof v !== "string" || !(VALID_VIEW_MODES as readonly string[]).includes(v)) {
      return { error: `preferred_view_mode debe ser: ${VALID_VIEW_MODES.join(", ")}` };
    }
    data.preferred_view_mode = v;
  }

  return { data: data as Partial<OperatingPreferences> };
}

// ─── GET ───

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_operating_preferences")
    .select("preferred_action_style, preferred_weekly_focus, preferred_schedule_day, max_weekly_execution_count, preferred_view_mode, notes, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // Graceful: table doesn't exist or no row → return defaults
  if (error || !data) {
    return NextResponse.json(DEFAULT_PREFERENCES);
  }

  return NextResponse.json(data);
}

// ─── PATCH ───

export async function PATCH(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sanitized = sanitizePreferences(body);
  if ("error" in sanitized) {
    return NextResponse.json({ error: sanitized.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_operating_preferences")
    .upsert(
      {
        user_id: user.id,
        ...sanitized.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error guardando preferencias", details: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
