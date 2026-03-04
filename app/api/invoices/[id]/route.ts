import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type InvoicePatchContext = {
  params: Promise<{
    id: string;
  }>;
};

type PaymentStatus = "unpaid" | "scheduled" | "paid";
type PaymentMethod = "transfer" | "pse" | "cash" | "other";

type InvoicePatchPayload = {
  payment_status?: PaymentStatus;
  scheduled_payment_date?: string | null;
  paid_at?: string | null;
  payment_method?: PaymentMethod | null;
  payment_notes?: string | null;
};

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
  ];

  const hasInvalidKeys = payloadKeys.some((key) => !allowedKeys.includes(key as keyof InvoicePatchPayload));
  if (hasInvalidKeys) {
    return NextResponse.json({ error: "Solo se permiten campos de pago." }, { status: 400 });
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

  const { data: currentInvoice, error: currentInvoiceError } = await supabase
    .from("invoices")
    .select("id, user_id, payment_status, scheduled_payment_date, paid_at, payment_method, payment_notes")
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

  const { data: updatedInvoice, error: updateError } = await supabase
    .from("invoices")
    .update(updatePayload)
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .select("id, payment_status, scheduled_payment_date, paid_at, payment_method, payment_notes")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: "No se pudo actualizar el estado de pago." }, { status: 500 });
  }

  if (!updatedInvoice) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ invoice: updatedInvoice });
}
