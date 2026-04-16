import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getReviewQueue } from "@/lib/invoices/getReviewQueue";
import { computeWeeklyGoals } from "@/lib/invoices/getWeeklyGoals";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { items } = await getReviewQueue({ supabase, userId: user.id });
  const summary = computeWeeklyGoals(items);

  return NextResponse.json(summary);
}
