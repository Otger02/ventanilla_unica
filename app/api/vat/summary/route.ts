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

    // Current month boundaries based on created_at
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const monthStart = new Date(year, month, 1).toISOString();
    const monthEnd = new Date(year, month + 1, 1).toISOString();
    const monthLabel = `${year}-${String(month + 1).padStart(2, "0")}`;

    const { data: invoices, error: dbError } = await supabase
      .from("invoices")
      .select("vat_status, vat_amount_usable_cop, vat_amount_review_cop, vat_amount_blocked_cop, iva_cop")
      .eq("user_id", user.id)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    const rows = invoices ?? [];

    let vatUsableCop = 0;
    let vatReviewCop = 0;
    let vatBlockedCop = 0;
    let usableCount = 0;
    let reviewCount = 0;
    let blockedCount = 0;
    let withoutVatCount = 0;

    for (const row of rows) {
      switch (row.vat_status) {
        case "iva_usable":
          vatUsableCop += Number(row.vat_amount_usable_cop) || 0;
          usableCount++;
          break;
        case "iva_en_revision":
          vatReviewCop += Number(row.vat_amount_review_cop) || 0;
          reviewCount++;
          break;
        case "iva_no_usable":
          vatBlockedCop += Number(row.vat_amount_blocked_cop) || 0;
          blockedCount++;
          break;
        default:
          withoutVatCount++;
          break;
      }
    }

    const totalWithVat = usableCount + reviewCount + blockedCount;

    return NextResponse.json({
      month: monthLabel,
      total_invoices_with_vat: totalWithVat,
      vat_usable_cop: vatUsableCop,
      vat_review_cop: vatReviewCop,
      vat_blocked_cop: vatBlockedCop,
      invoices_usable_count: usableCount,
      invoices_review_count: reviewCount,
      invoices_blocked_count: blockedCount,
      invoices_without_vat_count: withoutVatCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
