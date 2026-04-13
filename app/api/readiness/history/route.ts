import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Snapshot = {
  portfolio_score: number;
  healthy_count: number;
  warning_count: number;
  critical_count: number;
  created_at: string;
};

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("readiness_snapshots")
    .select("portfolio_score, healthy_count, warning_count, critical_count, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const history = (rows ?? []) as Snapshot[];
  const current = history[0] ?? null;
  const previous = history[1] ?? null;
  const delta_score =
    current && previous ? current.portfolio_score - previous.portfolio_score : null;

  return NextResponse.json({ current, previous, delta_score, history });
}
