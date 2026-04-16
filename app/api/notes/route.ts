import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID_TARGET_TYPES = ["invoice", "review_queue", "weekly_plan", "goal", "dashboard"] as const;

// ─── GET: list notes with optional filters ───

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const targetType = url.searchParams.get("target_type");
  const targetId = url.searchParams.get("target_id");

  let query = supabase
    .from("operational_notes")
    .select("*")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (targetType) query = query.eq("target_type", targetType);
  if (targetId) query = query.eq("target_id", targetId);
  else if (targetType && !targetId) query = query.is("target_id", null);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: data ?? [] });
}

// ─── POST: create note ───

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

  // Validate content
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 2000) {
    return NextResponse.json({ error: "content debe tener entre 1 y 2000 caracteres" }, { status: 400 });
  }

  // Validate target_type
  const targetType = body.target_type;
  if (typeof targetType !== "string" || !(VALID_TARGET_TYPES as readonly string[]).includes(targetType)) {
    return NextResponse.json({ error: `target_type debe ser: ${VALID_TARGET_TYPES.join(", ")}` }, { status: 400 });
  }

  // target_id and author_label
  const targetId = typeof body.target_id === "string" ? body.target_id : null;
  const authorLabel = typeof body.author_label === "string" && body.author_label.trim()
    ? body.author_label.trim().slice(0, 100)
    : "Propietario";

  const { data, error } = await supabase
    .from("operational_notes")
    .insert({
      owner_user_id: user.id,
      author_label: authorLabel,
      target_type: targetType,
      target_id: targetId,
      content,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error creando nota", details: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
