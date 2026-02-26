import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-");
}

function getExtension(fileName: string, mimeType: string) {
  const safeName = sanitizeFileName(fileName || "file");
  const byName = safeName.split(".").pop();

  if (byName && byName !== safeName && /^[a-z0-9]+$/.test(byName)) {
    return byName;
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  return "bin";
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Debes adjuntar un archivo." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  const { data: duplicateFile, error: duplicateLookupError } = await supabase
    .from("invoice_files")
    .select("invoice_id")
    .eq("user_id", user.id)
    .eq("sha256", sha256)
    .maybeSingle();

  if (duplicateLookupError) {
    return NextResponse.json({ error: "No se pudo validar duplicado." }, { status: 500 });
  }

  if (duplicateFile?.invoice_id) {
    return NextResponse.json({ invoice_id: duplicateFile.invoice_id, status: "duplicate" });
  }

  const { data: createdInvoice, error: createInvoiceError } = await supabase
    .from("invoices")
    .insert({
      user_id: user.id,
      status: "pending",
      source: "upload",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (createInvoiceError || !createdInvoice?.id) {
    return NextResponse.json({ error: "No se pudo crear la factura." }, { status: 500 });
  }

  const invoiceId = createdInvoice.id;
  const extension = getExtension(file.name, file.type);
  const storagePath = `${user.id}/${invoiceId}/original.${extension}`;

  const { error: uploadError } = await supabase.storage.from("invoices").upload(storagePath, fileBuffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    await supabase.from("invoices").delete().eq("id", invoiceId).eq("user_id", user.id);
    return NextResponse.json({ error: "No se pudo subir el archivo." }, { status: 500 });
  }

  const { error: insertFileError } = await supabase.from("invoice_files").insert({
    invoice_id: invoiceId,
    user_id: user.id,
    storage_bucket: "invoices",
    storage_path: storagePath,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    sha256,
  });

  if (insertFileError) {
    await supabase.storage.from("invoices").remove([storagePath]);
    await supabase.from("invoices").delete().eq("id", invoiceId).eq("user_id", user.id);
    return NextResponse.json({ error: "No se pudo guardar metadata del archivo." }, { status: 500 });
  }

  return NextResponse.json({ invoice_id: invoiceId, status: "created" });
}
