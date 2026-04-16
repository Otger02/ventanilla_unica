import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const VALID_ACCESS_MODES = ["read_only", "advisor_limited"] as const;

// ─── GET: list owner's shared views ───

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("shared_views")
    .select("id, shared_with_email, access_mode, token, is_active, created_at, expires_at")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

// ─── POST: create shared view ───

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Validate email
  const email = body.shared_with_email;
  if (typeof email !== "string" || !email.includes("@") || email.length < 5) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  // Validate access_mode
  const mode = body.access_mode;
  if (typeof mode !== "string" || !(VALID_ACCESS_MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: `access_mode debe ser: ${VALID_ACCESS_MODES.join(", ")}` }, { status: 400 });
  }

  // Validate optional expires_at
  let expiresAt: string | null = null;
  if (body.expires_at != null) {
    const d = new Date(String(body.expires_at));
    if (isNaN(d.getTime()) || d <= new Date()) {
      return NextResponse.json({ error: "expires_at debe ser una fecha futura" }, { status: 400 });
    }
    expiresAt = d.toISOString();
  }

  const token = randomUUID();

  const { data, error } = await supabase
    .from("shared_views")
    .insert({
      owner_user_id: user.id,
      shared_with_email: email.trim().toLowerCase(),
      access_mode: mode,
      token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error creando vista compartida", details: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
