import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getReceiptsCounts } from "@/lib/invoices/getReceiptsCounts";

export const dynamic = "force-dynamic";

export type AlertAction = "pay_now" | "review_invoice" | "upload_receipt" | "schedule_payment";

export type AlertItem = {
  id: string;
  type: "overdue" | "due_soon" | "quality" | "no_receipt" | "scheduled_tomorrow" | "vat_review" | "vat_blocked";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  invoice_id: string;
  primary_action: AlertAction;
  secondary_action?: AlertAction;
};

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
      .select("id, supplier_name, total_cop, due_date, payment_status, scheduled_payment_date, data_quality_status, vat_status, iva_cop")
      .eq("user_id", user.id);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    const rows = invoices ?? [];

    // Get receipt counts from invoice_receipts table
    const receiptCounts = await getReceiptsCounts(supabase, rows.map((r) => r.id));
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const in3d = new Date(now);
    in3d.setDate(in3d.getDate() + 3);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const alerts: AlertItem[] = [];
    let nextId = 1;

    for (const row of rows) {
      const label = row.supplier_name || `Factura ${row.id.slice(0, 8)}`;
      const amount =
        typeof row.total_cop === "number"
          ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(row.total_cop)
          : null;

      // 1. Overdue
      if (row.payment_status !== "paid" && row.due_date) {
        const due = new Date(row.due_date + "T00:00:00");
        if (due < now) {
          const diffDays = Math.ceil((now.getTime() - due.getTime()) / 86_400_000);
          alerts.push({
            id: String(nextId++),
            type: "overdue",
            severity: "critical",
            title: `${label} vencida`,
            description: `Venció hace ${diffDays} día${diffDays !== 1 ? "s" : ""}${amount ? ` · ${amount}` : ""}`,
            invoice_id: row.id,
            primary_action: "pay_now",
            secondary_action: "schedule_payment",
          });
        }
        // 2. Due within 3 days
        else if (due >= now && due <= in3d) {
          const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
          alerts.push({
            id: String(nextId++),
            type: "due_soon",
            severity: "warning",
            title: `${label} vence pronto`,
            description: `Vence en ${diffDays} día${diffDays !== 1 ? "s" : ""}${amount ? ` · ${amount}` : ""}`,
            invoice_id: row.id,
            primary_action: "pay_now",
            secondary_action: "schedule_payment",
          });
        }
      }

      // 3. Quality issues
      if (row.data_quality_status && row.data_quality_status !== "ok") {
        alerts.push({
          id: String(nextId++),
          type: "quality",
          severity: row.data_quality_status === "incomplete" ? "warning" : "info",
          title: `${label} — datos ${row.data_quality_status === "incomplete" ? "incompletos" : "sospechosos"}`,
          description: "Revisar y corregir datos de la factura",
          invoice_id: row.id,
          primary_action: "review_invoice",
        });
      }

      // 4. Paid without receipt
      if (row.payment_status === "paid" && (receiptCounts.get(row.id) ?? 0) === 0) {
        alerts.push({
          id: String(nextId++),
          type: "no_receipt",
          severity: "info",
          title: `${label} sin comprobante`,
          description: "Pagada pero sin comprobante adjunto",
          invoice_id: row.id,
          primary_action: "upload_receipt",
        });
      }

      // 5. Scheduled for tomorrow
      if (row.payment_status === "scheduled" && row.scheduled_payment_date) {
        const sched = new Date(row.scheduled_payment_date + "T00:00:00");
        if (sched >= now && sched <= tomorrow) {
          alerts.push({
            id: String(nextId++),
            type: "scheduled_tomorrow",
            severity: "info",
            title: `${label} programada para mañana`,
            description: `Pago programado${amount ? ` · ${amount}` : ""}`,
            invoice_id: row.id,
            primary_action: "pay_now",
          });
        }
      }

      // 6. VAT in review (has IVA but missing receipt or suspect data)
      if (row.vat_status === "iva_en_revision" && typeof row.iva_cop === "number" && row.iva_cop > 0) {
        const ivaFormatted = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(row.iva_cop);
        alerts.push({
          id: String(nextId++),
          type: "vat_review",
          severity: "info",
          title: `${label} — IVA en revisión`,
          description: `${ivaFormatted} de IVA pendiente de soporte`,
          invoice_id: row.id,
          primary_action: (receiptCounts.get(row.id) ?? 0) === 0 ? "upload_receipt" : "review_invoice",
        });
      }

      // 7. VAT blocked (incomplete data)
      if (row.vat_status === "iva_no_usable" && typeof row.iva_cop === "number" && row.iva_cop > 0) {
        const ivaFormatted = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(row.iva_cop);
        alerts.push({
          id: String(nextId++),
          type: "vat_blocked",
          severity: "warning",
          title: `${label} — IVA bloqueado`,
          description: `${ivaFormatted} de IVA no usable por datos incompletos`,
          invoice_id: row.id,
          primary_action: "review_invoice",
        });
      }
    }

    // Sort: critical first, then warning, then info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return NextResponse.json({
      alerts,
      counts: {
        total: alerts.length,
        critical: alerts.filter((a) => a.severity === "critical").length,
        warning: alerts.filter((a) => a.severity === "warning").length,
        info: alerts.filter((a) => a.severity === "info").length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
