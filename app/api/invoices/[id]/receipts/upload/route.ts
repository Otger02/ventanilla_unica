import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type UploadReceiptContext = {
  params: Promise<{
    id: string;
  }>;
};

const MAX_RECEIPT_SIZE_BYTES = 15 * 1024 * 1024;

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function hasPdfExtension(fileName: string) {
  return fileName.toLowerCase().endsWith(".pdf");
}

export async function POST(request: Request, context: UploadReceiptContext) {
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

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, user_id, payment_status, paid_at")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (invoiceError) {
    return NextResponse.json({ error: "No se pudo consultar la factura." }, { status: 500 });
  }

  if (!invoice) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Debes adjuntar un archivo." }, { status: 400 });
  }

  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    return NextResponse.json({ error: "Archivo demasiado grande (máximo 15MB)." }, { status: 413 });
  }

  if (file.type !== "application/pdf" || !hasPdfExtension(file.name)) {
    return NextResponse.json({ error: "Solo se permiten archivos PDF (.pdf)." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  const { data: duplicateReceipt, error: duplicateLookupError } = await supabase
    .from("invoice_receipts")
    .select("id")
    .eq("user_id", user.id)
    .eq("sha256", sha256)
    .maybeSingle();

  if (duplicateLookupError) {
    return NextResponse.json({ error: "No se pudo validar duplicado." }, { status: 500 });
  }

  if (duplicateReceipt?.id) {
    return NextResponse.json({ status: "duplicate" });
  }

  const safeName = sanitizeFileName(file.name || "receipt.pdf") || "receipt.pdf";
  const timestamp = Date.now();
  const storagePath = `invoice_receipts/${user.id}/${invoiceId}/${timestamp}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("invoice_receipts")
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: "No se pudo subir el comprobante." }, { status: 500 });
  }

  const { data: insertedReceipt, error: insertReceiptError } = await supabase
    .from("invoice_receipts")
    .insert({
      user_id: user.id,
      invoice_id: invoiceId,
      sha256,
      storage_path: storagePath,
      original_filename: file.name || null,
    })
    .select("id")
    .single();

  if (insertReceiptError || !insertedReceipt?.id) {
    await supabase.storage.from("invoice_receipts").remove([storagePath]);
    return NextResponse.json({ error: "No se pudo guardar el comprobante." }, { status: 500 });
  }

  const { error: updateInvoiceError } = await supabase
    .from("invoices")
    .update({
      payment_status: "paid",
      paid_at: invoice.paid_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("user_id", user.id);

  if (updateInvoiceError) {
    return NextResponse.json({ error: "Comprobante subido, pero no se pudo actualizar la factura." }, { status: 500 });
  }

  return NextResponse.json({
    status: "created",
    receipt_id: insertedReceipt.id,
    invoice_id: invoiceId,
  });
}
