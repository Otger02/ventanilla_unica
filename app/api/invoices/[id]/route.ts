import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { computeDataQuality } from "@/lib/invoices/computeDataQuality";
import { computeVatStatus } from "@/lib/invoices/computeVatStatus";
import { logInvoiceActivity } from "@/lib/invoices/logInvoiceActivity";

type InvoicePatchContext = {
  params: Promise<{
    id: string;
  }>;
};

type PaymentStatus = "unpaid" | "scheduled" | "paid";
type PaymentMethod = "transfer" | "pse" | "cash" | "other";

type InvoicePatchPayload = {
  // Payment fields
  payment_status?: PaymentStatus;
  scheduled_payment_date?: string | null;
  paid_at?: string | null;
  payment_method?: PaymentMethod | null;
  payment_notes?: string | null;
  payment_url?: string | null;
  supplier_portal_url?: string | null;
  last_payment_opened_at?: string | null;
  // Data fields (manual edit)
  supplier_name?: string | null;
  total_cop?: number | null;
  due_date?: string | null;
  invoice_number?: string | null;
  // Assignment
  assigned_to_label?: string | null;
};

function parseOptionalHttpUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function parseDateOnlyOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function parseIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function PATCH(request: Request, context: InvoicePatchContext) {
  const { id: invoiceId } = await context.params;

  if (!invoiceId) {
    return NextResponse.json({ error: "Id de factura inválido." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const rawPayload = (await request.json().catch(() => ({}))) as InvoicePatchPayload;
  const payloadKeys = Object.keys(rawPayload);

  const allowedKeys: Array<keyof InvoicePatchPayload> = [
    "payment_status",
    "scheduled_payment_date",
    "paid_at",
    "payment_method",
    "payment_notes",
    "payment_url",
    "supplier_portal_url",
    "last_payment_opened_at",
    "supplier_name",
    "total_cop",
    "due_date",
    "invoice_number",
    "assigned_to_label",
  ];

  const hasInvalidKeys = payloadKeys.some((key) => !allowedKeys.includes(key as keyof InvoicePatchPayload));
  if (hasInvalidKeys) {
    return NextResponse.json({ error: "Campo no permitido en el payload." }, { status: 400 });
  }

  const paymentStatus = rawPayload.payment_status;
  if (paymentStatus && !["unpaid", "scheduled", "paid"].includes(paymentStatus)) {
    return NextResponse.json({ error: "payment_status inválido." }, { status: 400 });
  }

  const paymentMethod = rawPayload.payment_method;
  if (paymentMethod && !["transfer", "pse", "cash", "other"].includes(paymentMethod)) {
    return NextResponse.json({ error: "payment_method inválido." }, { status: 400 });
  }

  const scheduledPaymentDate = parseDateOnlyOrNull(rawPayload.scheduled_payment_date);
  if (rawPayload.scheduled_payment_date !== undefined && rawPayload.scheduled_payment_date !== null && !scheduledPaymentDate) {
    return NextResponse.json({ error: "scheduled_payment_date inválido. Usa YYYY-MM-DD." }, { status: 400 });
  }

  const paidAt = parseIsoOrNull(rawPayload.paid_at);
  if (rawPayload.paid_at !== undefined && rawPayload.paid_at !== null && !paidAt) {
    return NextResponse.json({ error: "paid_at inválido." }, { status: 400 });
  }

  const paymentNotes =
    typeof rawPayload.payment_notes === "string"
      ? rawPayload.payment_notes.trim() || null
      : rawPayload.payment_notes === null || rawPayload.payment_notes === undefined
        ? rawPayload.payment_notes
        : null;

  const paymentUrl = parseOptionalHttpUrl(rawPayload.payment_url);
  if (rawPayload.payment_url !== undefined && rawPayload.payment_url !== null && !paymentUrl) {
    return NextResponse.json({ error: "payment_url inválido. Usa URL http/https." }, { status: 400 });
  }

  const supplierPortalUrl = parseOptionalHttpUrl(rawPayload.supplier_portal_url);
  if (rawPayload.supplier_portal_url !== undefined && rawPayload.supplier_portal_url !== null && !supplierPortalUrl) {
    return NextResponse.json({ error: "supplier_portal_url inválido. Usa URL http/https." }, { status: 400 });
  }

  const lastPaymentOpenedAt = parseIsoOrNull(rawPayload.last_payment_opened_at);
  if (
    rawPayload.last_payment_opened_at !== undefined &&
    rawPayload.last_payment_opened_at !== null &&
    !lastPaymentOpenedAt
  ) {
    return NextResponse.json({ error: "last_payment_opened_at inválido." }, { status: 400 });
  }

  const { data: currentInvoice, error: currentInvoiceError } = await supabase
    .from("invoices")
    .select("id, user_id, payment_status, scheduled_payment_date, paid_at, payment_method, payment_notes, payment_url, supplier_portal_url, last_payment_opened_at, supplier_name, total_cop, due_date, invoice_number, subtotal_cop, iva_cop, extraction_confidence, data_quality_status, assigned_to_label")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (currentInvoiceError) {
    return NextResponse.json({ error: "No se pudo consultar la factura." }, { status: 500 });
  }

  if (!currentInvoice) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const nextPaymentStatus = paymentStatus ?? (currentInvoice.payment_status as PaymentStatus);

  let nextScheduledPaymentDate =
    rawPayload.scheduled_payment_date === undefined ? currentInvoice.scheduled_payment_date : scheduledPaymentDate;
  let nextPaidAt = rawPayload.paid_at === undefined ? currentInvoice.paid_at : paidAt;

  if (nextPaymentStatus === "paid") {
    nextPaidAt = nextPaidAt ?? new Date().toISOString();
  } else {
    nextPaidAt = null;
  }

  if (nextPaymentStatus === "scheduled") {
    if (!nextScheduledPaymentDate) {
      return NextResponse.json({ error: "scheduled_payment_date es requerido para payment_status=scheduled." }, { status: 400 });
    }
  }

  if (nextPaymentStatus === "unpaid") {
    nextScheduledPaymentDate = null;
  }

  const updatePayload: Record<string, unknown> = {
    payment_status: nextPaymentStatus,
    scheduled_payment_date: nextScheduledPaymentDate,
    paid_at: nextPaidAt,
    updated_at: new Date().toISOString(),
  };

  if (rawPayload.payment_method !== undefined) {
    updatePayload.payment_method = paymentMethod ?? null;
  }

  if (rawPayload.payment_notes !== undefined) {
    updatePayload.payment_notes = paymentNotes ?? null;
  }

  if (rawPayload.payment_url !== undefined) {
    updatePayload.payment_url = paymentUrl ?? null;
  }

  if (rawPayload.supplier_portal_url !== undefined) {
    updatePayload.supplier_portal_url = supplierPortalUrl ?? null;
  }

  if (rawPayload.last_payment_opened_at !== undefined) {
    updatePayload.last_payment_opened_at = lastPaymentOpenedAt ?? null;
  }

  // --- Data field edits ---
  const dataFieldKeys = ["supplier_name", "total_cop", "due_date", "invoice_number"] as const;
  const hasDataFieldEdit = dataFieldKeys.some((k) => rawPayload[k] !== undefined);

  if (rawPayload.supplier_name !== undefined) {
    updatePayload.supplier_name = typeof rawPayload.supplier_name === "string" ? rawPayload.supplier_name.trim() || null : null;
  }
  if (rawPayload.total_cop !== undefined) {
    const num = Number(rawPayload.total_cop);
    updatePayload.total_cop = Number.isFinite(num) ? num : null;
  }
  if (rawPayload.due_date !== undefined) {
    updatePayload.due_date = parseDateOnlyOrNull(rawPayload.due_date);
  }
  if (rawPayload.invoice_number !== undefined) {
    updatePayload.invoice_number = typeof rawPayload.invoice_number === "string" ? rawPayload.invoice_number.trim() || null : null;
  }

  // --- Assignment label ---
  if (rawPayload.assigned_to_label !== undefined) {
    const trimmed = typeof rawPayload.assigned_to_label === "string" ? rawPayload.assigned_to_label.trim().slice(0, 50) || null : null;
    updatePayload.assigned_to_label = trimmed;
  }

  // Recalculate data quality when data fields change
  if (hasDataFieldEdit) {
    const finalSupplier = updatePayload.supplier_name !== undefined ? updatePayload.supplier_name as string | null : currentInvoice.supplier_name;
    const finalTotal = updatePayload.total_cop !== undefined ? updatePayload.total_cop as number | null : (typeof currentInvoice.total_cop === "number" ? currentInvoice.total_cop : null);
    const finalDueDate = updatePayload.due_date !== undefined ? updatePayload.due_date as string | null : currentInvoice.due_date;

    const confidence = (() => {
      const ec = currentInvoice.extraction_confidence;
      if (ec && typeof ec === "object" && typeof (ec as Record<string, unknown>).overall === "number") {
        return (ec as Record<string, unknown>).overall as number;
      }
      return null;
    })();

    const { status, flags } = computeDataQuality({
      confidence,
      supplier_name: finalSupplier,
      total_cop: finalTotal,
      subtotal_cop: typeof currentInvoice.subtotal_cop === "number" ? currentInvoice.subtotal_cop : null,
      iva_cop: typeof currentInvoice.iva_cop === "number" ? currentInvoice.iva_cop : null,
      due_date: finalDueDate,
    });

    updatePayload.data_quality_status = status;
    updatePayload.data_quality_flags = flags;
  }

  // --- VAT recalculation ---
  const needsVatRecalc = hasDataFieldEdit || paymentStatus !== undefined;
  if (needsVatRecalc) {
    const { count: receiptsCount } = await supabase
      .from("invoice_receipts")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", invoiceId);

    const effectiveQuality = (updatePayload.data_quality_status ?? currentInvoice.data_quality_status ?? null) as "ok" | "suspect" | "incomplete" | null;
    const effectiveIva = typeof currentInvoice.iva_cop === "number" ? currentInvoice.iva_cop : null;
    const effectivePaymentStatus = (updatePayload.payment_status ?? currentInvoice.payment_status ?? null) as string | null;

    const vatResult = computeVatStatus({
      iva_cop: effectiveIva,
      payment_status: effectivePaymentStatus,
      receipts_count: receiptsCount ?? 0,
      data_quality_status: effectiveQuality,
    });

    updatePayload.vat_status = vatResult.vat_status;
    updatePayload.vat_reason = vatResult.vat_reason;
    updatePayload.vat_amount_usable_cop = vatResult.vat_amount_usable_cop;
    updatePayload.vat_amount_review_cop = vatResult.vat_amount_review_cop;
    updatePayload.vat_amount_blocked_cop = vatResult.vat_amount_blocked_cop;
  }

  const { data: updatedInvoice, error: updateError } = await supabase
    .from("invoices")
    .update(updatePayload)
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .select("id, supplier_name, invoice_number, total_cop, due_date, payment_status, scheduled_payment_date, paid_at, payment_method, payment_notes, payment_url, supplier_portal_url, last_payment_opened_at, data_quality_status, data_quality_flags, vat_status, vat_reason, assigned_to_label")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: "No se pudo actualizar el estado de pago." }, { status: 500 });
  }

  if (!updatedInvoice) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  // --- Activity logging ---
  const prevStatus = currentInvoice.payment_status as string;

  if (hasDataFieldEdit) {
    await logInvoiceActivity(supabase, {
      invoice_id: invoiceId,
      user_id: user.id,
      activity: "manually_edited",
      metadata: { fields: dataFieldKeys.filter((k) => rawPayload[k] !== undefined) },
    });
    if (updatePayload.data_quality_status && updatePayload.data_quality_status !== currentInvoice.data_quality_status) {
      await logInvoiceActivity(supabase, {
        invoice_id: invoiceId,
        user_id: user.id,
        activity: "quality_updated",
        metadata: { from: currentInvoice.data_quality_status, to: updatePayload.data_quality_status },
      });
    }
  }

  if (rawPayload.assigned_to_label !== undefined && updatePayload.assigned_to_label !== (currentInvoice as Record<string, unknown>).assigned_to_label) {
    await logInvoiceActivity(supabase, {
      invoice_id: invoiceId,
      user_id: user.id,
      activity: "assignment_changed",
      metadata: { from: (currentInvoice as Record<string, unknown>).assigned_to_label ?? null, to: updatePayload.assigned_to_label ?? null },
    });
  }

  if (paymentStatus === "paid" && prevStatus !== "paid") {
    await logInvoiceActivity(supabase, {
      invoice_id: invoiceId,
      user_id: user.id,
      activity: "marked_paid",
      metadata: { source: "manual" },
    });
  }

  if (paymentStatus === "scheduled") {
    const wasAlreadyScheduled = prevStatus === "scheduled";
    await logInvoiceActivity(supabase, {
      invoice_id: invoiceId,
      user_id: user.id,
      activity: wasAlreadyScheduled ? "rescheduled" : "scheduled",
      metadata: { date: nextScheduledPaymentDate },
    });
  }

  if (rawPayload.last_payment_opened_at !== undefined) {
    await logInvoiceActivity(supabase, {
      invoice_id: invoiceId,
      user_id: user.id,
      activity: "payment_opened",
      metadata: { payment_url: updatePayload.payment_url ?? currentInvoice.payment_url },
    });
  }

  return NextResponse.json({ invoice: updatedInvoice });
}
