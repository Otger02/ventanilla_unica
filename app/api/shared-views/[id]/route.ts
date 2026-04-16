import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// ─── PATCH: toggle is_active ───

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

  if (typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "is_active debe ser boolean" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shared_views")
    .update({ is_active: body.is_active })
    .eq("id", id)
    .eq("owner_user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error actualizando vista compartida", details: error.message }, { status: 500 });
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
    .from("shared_views")
    .delete()
    .eq("id", id)
    .eq("owner_user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Error eliminando vista compartida", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
