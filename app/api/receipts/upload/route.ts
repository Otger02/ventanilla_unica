import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

import { getGeminiConfig } from "@/lib/ai/gemini";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_RECEIPT_SIZE_BYTES = 15 * 1024 * 1024;

const SUPPORTED_RECEIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SUPPORTED_RECEIPT_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

type AuditResult = {
  match: boolean;
  confidence: number;
  reason: string;
  monto_pagado: number | null;
  fecha_pago: string | null;
  referencia: string | null;
};

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function hasSupportedExtension(fileName: string) {
  const normalized = fileName.toLowerCase();
  return SUPPORTED_RECEIPT_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function parseAuditJson(raw: string): Record<string, unknown> | null {
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

function parseAuditResult(raw: string): AuditResult | null {
  const parsed = parseAuditJson(raw);
  if (!parsed) {
    return null;
  }

  const confidenceRaw = parsed.confidence;
  const confidence = typeof confidenceRaw === "number" ? confidenceRaw : Number(confidenceRaw);
  const detectedAmountRaw = parsed.detected_amount;
  const detectedAmount =
    detectedAmountRaw === null || detectedAmountRaw === undefined
      ? null
      : typeof detectedAmountRaw === "number"
        ? detectedAmountRaw
        : Number(detectedAmountRaw);

  return {
    match: Boolean(parsed.match),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "Sin razón provista por auditor IA.",
    detected_amount: Number.isFinite(detectedAmount ?? NaN) ? Math.round(detectedAmount as number) : null,
  };
}

async function auditReceiptWithGemini(params: {
  fileBuffer: Buffer;
  mimeType: string;
  expectedSupplierName: string | null;
  expectedInvoiceNumber: string | null;
  expectedTotalCop: number | null;
  expectedDueDate: string | null;
}) {
  const geminiConfig = getGeminiConfig();

  if (!geminiConfig.hasApiKey) {
    return {
      error: "Configuración incompleta: falta Gemini API key (GEMINI_API_KEY).",
      code: "config_missing_gemini_api_key",
    } as const;
  }

  const genAI = new GoogleGenerativeAI(geminiConfig.apiKey);
  const model = genAI.getGenerativeModel({
    model: geminiConfig.model,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const prompt = [
    "Eres un auditor de comprobantes de pago en Colombia.",
    "Analiza esta evidencia (recibo) con los datos esperados de la factura y decide si corresponde.",
    "Adem�s, DEBES extraer: monto_pagado, fecha_pago y referencia (n�mero de transacci�n o comprobante).",
    "Responde SOLO JSON con este esquema:",
    `{"match": boolean, "confidence": number, "reason": string, "monto_pagado": number, "fecha_pago": "YYYY-MM-DD", "referencia": "string"}`,
    "Datos esperados del pago:",
    `- Proveedor: ${params.expectedSupplierName ?? "No disponible"}`,
    `- Factura: ${params.expectedInvoiceNumber ?? "No disponible"}`,
    `- Monto exacto COP: ${params.expectedTotalCop ?? "No disponible"}`,
    `- Fecha l�mite: ${params.expectedDueDate ?? "No disponible"}`,
  ].join("\n");

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          data: params.fileBuffer.toString("base64"),
          mimeType: params.mimeType,
        },
      },
      {
        text: prompt,
      },
    ]);

    const raw = result.response.text();
    const parsed = parseAuditResult(raw);

    if (!parsed) {
      return {
        error: "Gemini devolvió una respuesta inválida para auditoría.",
        code: "gemini_invalid_json_response",
      } as const;
    }

    return {
      audit: parsed,
    } as const;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Error auditando comprobante con Gemini.",
      code: "gemini_audit_error",
    } as const;
  }
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const formData = await request.formData();
  const invoiceId = formData.get("invoiceId")?.toString();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, user_id, payment_status, paid_at, total_cop, supplier_name, invoice_number, due_date")
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

  if (!SUPPORTED_RECEIPT_MIME_TYPES.has(file.type) || !hasSupportedExtension(file.name)) {
    return NextResponse.json({ error: "Solo se permiten PDF o imágenes JPG/PNG/WEBP." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

  const auditResult = await auditReceiptWithGemini({
    fileBuffer,
    mimeType: file.type,
    expectedSupplierName: invoice.supplier_name,
    expectedInvoiceNumber: invoice.invoice_number,
    expectedTotalCop: invoice.total_cop,
    expectedDueDate: invoice.due_date,
  });

  if ("error" in auditResult) {
    return NextResponse.json(
      {
        error: auditResult.error,
        code: auditResult.code,
      },
      { status: 502 },
    );
  }

  if (!auditResult.audit.match) {
    return NextResponse.json(
      {
        error: `Validación fallida: ${auditResult.audit.reason}`,
        audit: auditResult.audit,
      },
      { status: 400 },
    );
  }

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
    audit: auditResult.audit,
  });
}
