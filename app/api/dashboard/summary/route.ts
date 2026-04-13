import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: invoices, error: dbError } = await supabase
      .from("invoices")
      .select("total_cop, due_date, payment_status, paid_at, data_quality_status")
      .eq("user_id", user.id);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    const rows = invoices ?? [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const next7d = new Date(now);
    next7d.setDate(next7d.getDate() + 7);

    const next30d = new Date(now);
    next30d.setDate(next30d.getDate() + 30);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalUnpaidCop = 0;
    let overdueCount = 0;
    let overdueTotalCop = 0;
    let dueNext7dTotal = 0;
    let dueNext30dTotal = 0;
    let paidThisMonthTotal = 0;
    let reviewNeededCount = 0;

    for (const row of rows) {
      const amount = typeof row.total_cop === "number" ? row.total_cop : 0;

      if (row.data_quality_status && row.data_quality_status !== "ok") {
        reviewNeededCount++;
      }

      if (row.payment_status === "paid") {
        if (row.paid_at) {
          const paidDate = new Date(row.paid_at);
          if (paidDate >= monthStart) {
            paidThisMonthTotal += amount;
          }
        }
        continue;
      }

      // unpaid or scheduled
      totalUnpaidCop += amount;

      if (row.due_date) {
        const due = new Date(row.due_date + "T00:00:00");
        if (due < now) {
          overdueCount++;
          overdueTotalCop += amount;
        } else if (due <= next7d) {
          dueNext7dTotal += amount;
        } else if (due <= next30d) {
          dueNext30dTotal += amount;
        }
      }
    }

    return NextResponse.json({
      total_unpaid_cop: totalUnpaidCop,
      overdue_count: overdueCount,
      overdue_total_cop: overdueTotalCop,
      due_next_7d_total: dueNext7dTotal,
      due_next_30d_total: dueNext30dTotal,
      paid_this_month_total: paidThisMonthTotal,
      review_needed_count: reviewNeededCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
