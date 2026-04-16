import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// ─── PATCH: edit content ───

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
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

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 2000) {
    return NextResponse.json({ error: "content debe tener entre 1 y 2000 caracteres" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("operational_notes")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error actualizando nota", details: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// ─── DELETE ───

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { error } = await supabase
    .from("operational_notes")
    .delete()
    .eq("id", id)
    .eq("owner_user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Error eliminando nota", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
