import { createHash } from "node:crypto";

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
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

type InvoiceExtractionResult = {
  supplier_name: string;
  invoice_number: string | null;
  total_cop: number;
  due_date: string;
  supplier_nit: string | null;
};

function parseExtractionJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFenceMatch?.[1]) {
    candidates.push(codeFenceMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeExtraction(raw: string): InvoiceExtractionResult | null {
  const parsed = parseExtractionJson(raw);
  if (!parsed) {
    return null;
  }

  const supplierName =
    typeof parsed.supplier_name === "string" && parsed.supplier_name.trim().length > 0
      ? parsed.supplier_name.trim()
      : null;

  const invoiceNumber =
    typeof parsed.invoice_number === "string" && parsed.invoice_number.trim().length > 0
      ? parsed.invoice_number.trim()
      : null;

  const supplierNit =
    typeof parsed.supplier_nit === "string" && parsed.supplier_nit.trim().length > 0
      ? parsed.supplier_nit.trim()
      : null;

  const totalRaw = parsed.total_cop;
  const totalCop = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);

  const dueDate =
    typeof parsed.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.due_date.trim())
      ? parsed.due_date.trim()
      : null;

  if (!supplierName || !Number.isFinite(totalCop) || totalCop <= 0 || !dueDate) {
    return null;
  }

  return {
    supplier_name: supplierName,
    invoice_number: invoiceNumber,
    total_cop: Math.round(totalCop),
    due_date: dueDate,
    supplier_nit: supplierNit,
  };
}

async function extractInvoiceWithGemini(params: {
  fileBuffer: Buffer;
  mimeType: string;
}) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey || geminiApiKey.trim().length === 0) {
    return {
      error: "Configuración incompleta: GEMINI_API_KEY no está definida.",
      code: "config_missing_gemini_api_key",
    } as const;
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          supplier_name: { type: SchemaType.STRING },
          invoice_number: { type: SchemaType.STRING },
          total_cop: { type: SchemaType.NUMBER },
          due_date: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
          supplier_nit: { type: SchemaType.STRING },
        },
        required: ["supplier_name", "total_cop", "due_date"],
      },
    },
  });

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          data: params.fileBuffer.toString("base64"),
          mimeType: params.mimeType || "application/pdf",
        },
      },
      {
        text: "Extrae los datos fiscales de esta factura colombiana. Si no hay fecha de vencimiento explícita, calcula 30 días desde la emisión.",
      },
    ]);

    const raw = result.response.text();
    const normalized = normalizeExtraction(raw);

    if (!normalized) {
      return {
        error: "Gemini no devolvió un JSON válido con los campos requeridos de factura.",
        code: "gemini_invoice_extraction_invalid",
      } as const;
    }

    return {
      extraction: normalized,
    } as const;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Error extrayendo datos de factura con Gemini.",
      code: "gemini_invoice_extraction_error",
    } as const;
  }
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

  const extractionResult = await extractInvoiceWithGemini({
    fileBuffer,
    mimeType: file.type || "application/pdf",
  });

  if ("error" in extractionResult) {
    return NextResponse.json(
      {
        error: extractionResult.error,
        code: extractionResult.code,
      },
      { status: 502 },
    );
  }

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
      payment_status: "unpaid",
      supplier_name: extractionResult.extraction.supplier_name,
      supplier_tax_id: extractionResult.extraction.supplier_nit,
      invoice_number: extractionResult.extraction.invoice_number,
      total_cop: extractionResult.extraction.total_cop,
      due_date: extractionResult.extraction.due_date,
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
