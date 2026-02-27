import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";

import { logInvoiceProcessDebug } from "@/lib/logger";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ProcessRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ExtractedFields = {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  subtotal_cop: number | null;
  iva_cop: number | null;
  total_cop: number | null;
  currency: string | null;
};

type ConfidenceByField = {
  supplier_name: number;
  supplier_tax_id: number;
  invoice_number: number;
  issue_date: number;
  due_date: number;
  subtotal_cop: number;
  iva_cop: number;
  total_cop: number;
  currency: number;
};

function clampConfidence(value: unknown) {
  const asNumber = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(asNumber)) {
    return 0;
  }

  return Math.max(0, Math.min(1, asNumber));
}

function parseDateOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function parseStringOrNull(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNumberOrNull(value: unknown) {
  const asNumber = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(asNumber)) {
    return null;
  }

  return Math.round(asNumber);
}

function parseJsonObject(raw: string) {
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

async function extractPdfTextTextBasedOnly(fileBuffer: Buffer) {
  const parser = new PDFParse({ data: fileBuffer });

  try {
    const parsed = await parser.getText();
    return (parsed.text ?? "").replace(/\s+/g, " ").trim();
  } finally {
    await parser.destroy();
  }
}

async function markNeedsOcr(invoiceId: string, reason: string) {
  const supabase = await createServerSupabaseClient();

  await supabase
    .from("invoices")
    .update({
      extracted_at: null,
      extraction_raw: {
        status: "needs_ocr",
        reason,
        marked_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
}

export async function POST(_request: Request, context: ProcessRouteContext) {
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
    .select("id, user_id")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (invoiceError) {
    return NextResponse.json({ error: "No se pudo consultar la factura." }, { status: 500 });
  }

  if (!invoice) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const { data: invoiceFile, error: fileError } = await supabase
    .from("invoice_files")
    .select("storage_bucket, storage_path, mime_type")
    .eq("invoice_id", invoiceId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fileError) {
    return NextResponse.json({ error: "No se pudo consultar el archivo de factura." }, { status: 500 });
  }

  if (!invoiceFile?.storage_path) {
    return NextResponse.json({ error: "Factura sin archivo asociado." }, { status: 400 });
  }

  if (invoiceFile.mime_type !== "application/pdf") {
    await markNeedsOcr(invoiceId, "unsupported_mime_type");
    logInvoiceProcessDebug({
      invoiceId,
      status: "needs_ocr",
      reason: "unsupported_mime_type",
    });
    return NextResponse.json({ status: "needs_ocr" });
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(invoiceFile.storage_bucket || "invoices")
    .download(invoiceFile.storage_path);

  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: "No se pudo descargar el PDF." }, { status: 500 });
  }

  const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());

  let extractedText = "";

  try {
    extractedText = await extractPdfTextTextBasedOnly(fileBuffer);
  } catch (error) {
    await markNeedsOcr(invoiceId, "pdf_parse_error");
    logInvoiceProcessDebug({
      invoiceId,
      status: "error",
      reason: error instanceof Error ? error.message : "pdf_parse_error",
    });
    return NextResponse.json({ status: "needs_ocr" });
  }

  logInvoiceProcessDebug({
    invoiceId,
    status: "downloaded",
    textLength: extractedText.length,
    textPreview: extractedText.slice(0, 300),
  });

  if (!extractedText || extractedText.length < 20) {
    await markNeedsOcr(invoiceId, "empty_or_scanned_pdf");
    logInvoiceProcessDebug({
      invoiceId,
      status: "needs_ocr",
      textLength: extractedText.length,
      textPreview: extractedText.slice(0, 300),
      reason: "empty_or_scanned_pdf",
    });
    return NextResponse.json({ status: "needs_ocr" });
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  const openAiModel =
    process.env.OPENAI_MODEL_INVOICE?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-5";

  if (!openAiApiKey || openAiApiKey.trim().length === 0) {
    return NextResponse.json(
      {
        error: "Configuración incompleta: OPENAI_API_KEY no está definida.",
        code: "config_missing_openai_api_key",
      },
      { status: 500 },
    );
  }

  const openai = new OpenAI({ apiKey: openAiApiKey });

  let aiResponse: Awaited<ReturnType<typeof openai.responses.create>>;

  try {
    aiResponse = await openai.responses.create({
      model: openAiModel,
      input: [
        {
          role: "system",
          content:
            "Extrae datos de factura electrónica de Colombia y devuelve SOLO JSON válido, sin markdown ni texto adicional.",
        },
        {
          role: "user",
          content: [
            "Extrae estos campos y devuelve null si no están:",
            "supplier_name, supplier_tax_id, invoice_number, issue_date(YYYY-MM-DD), due_date(YYYY-MM-DD), subtotal_cop, iva_cop, total_cop, currency",
            "Incluye confidence por campo (0 a 1) en objeto confidence con las mismas keys.",
            "Reglas de extracción:",
            "1) supplier_name y supplier_tax_id deben corresponder al EMISOR de la factura (no al cliente/comprador).",
            "2) supplier_tax_id debe ser NIT del emisor; limpiar espacios y mantener dígito de verificación si existe.",
            "3) invoice_number debe ser el número de factura (FE/FV/FACTURA No.), no CUFE, no referencia de pago, no orden de compra.",
            "4) Montos en COP enteros sin separadores.",
            "5) Verifica consistencia: total_cop ≈ subtotal_cop + iva_cop. Si hay múltiples candidatos, prioriza el trío que cuadre.",
            "6) Si el IVA es 0 explícito, puede ser válido.",
            "7) Si no estás seguro, devuelve null en ese campo y baja confidence.",
            "Formato exacto:",
            "{\n  \"supplier_name\": null,\n  \"supplier_tax_id\": null,\n  \"invoice_number\": null,\n  \"issue_date\": null,\n  \"due_date\": null,\n  \"subtotal_cop\": null,\n  \"iva_cop\": null,\n  \"total_cop\": null,\n  \"currency\": null,\n  \"confidence\": {\n    \"supplier_name\": 0,\n    \"supplier_tax_id\": 0,\n    \"invoice_number\": 0,\n    \"issue_date\": 0,\n    \"due_date\": 0,\n    \"subtotal_cop\": 0,\n    \"iva_cop\": 0,\n    \"total_cop\": 0,\n    \"currency\": 0\n  }\n}",
            "Texto del PDF:",
            extractedText.slice(0, 24000),
          ].join("\n\n"),
        },
      ],
    });
  } catch {
    return NextResponse.json({ error: "No se pudo ejecutar la extracción con IA." }, { status: 502 });
  }

  const rawOutputText = aiResponse.output_text?.trim() ?? "";
  const parsedJson = parseJsonObject(rawOutputText);

  if (!parsedJson) {
    return NextResponse.json({ error: "No se pudo parsear la extracción del PDF." }, { status: 502 });
  }

  const extractedFields: ExtractedFields = {
    supplier_name: parseStringOrNull(parsedJson.supplier_name),
    supplier_tax_id: parseStringOrNull(parsedJson.supplier_tax_id),
    invoice_number: parseStringOrNull(parsedJson.invoice_number),
    issue_date: parseDateOrNull(parsedJson.issue_date),
    due_date: parseDateOrNull(parsedJson.due_date),
    subtotal_cop: parseNumberOrNull(parsedJson.subtotal_cop),
    iva_cop: parseNumberOrNull(parsedJson.iva_cop),
    total_cop: parseNumberOrNull(parsedJson.total_cop),
    currency: parseStringOrNull(parsedJson.currency),
  };

  const rawConfidence =
    parsedJson.confidence && typeof parsedJson.confidence === "object"
      ? (parsedJson.confidence as Record<string, unknown>)
      : {};

  const confidence: ConfidenceByField = {
    supplier_name: clampConfidence(rawConfidence.supplier_name),
    supplier_tax_id: clampConfidence(rawConfidence.supplier_tax_id),
    invoice_number: clampConfidence(rawConfidence.invoice_number),
    issue_date: clampConfidence(rawConfidence.issue_date),
    due_date: clampConfidence(rawConfidence.due_date),
    subtotal_cop: clampConfidence(rawConfidence.subtotal_cop),
    iva_cop: clampConfidence(rawConfidence.iva_cop),
    total_cop: clampConfidence(rawConfidence.total_cop),
    currency: clampConfidence(rawConfidence.currency),
  };

  const hasTotals =
    extractedFields.subtotal_cop !== null &&
    extractedFields.iva_cop !== null &&
    extractedFields.total_cop !== null;

  let totalConsistencyDelta: number | null = null;
  let totalConsistencyTolerance: number | null = null;
  let lowConfidence = false;

  if (hasTotals) {
    const expectedTotal = (extractedFields.subtotal_cop ?? 0) + (extractedFields.iva_cop ?? 0);
    totalConsistencyDelta = Math.abs((extractedFields.total_cop ?? 0) - expectedTotal);
    totalConsistencyTolerance = Math.max(1000, Math.round(expectedTotal * 0.01));

    if (totalConsistencyDelta > totalConsistencyTolerance) {
      lowConfidence = true;
      confidence.total_cop = Math.min(confidence.total_cop, 0.3);
    }
  }

  const extractionConfidence = {
    ...confidence,
    low_confidence: lowConfidence,
    checks: {
      total_consistency_ok:
        totalConsistencyDelta !== null && totalConsistencyTolerance !== null
          ? totalConsistencyDelta <= totalConsistencyTolerance
          : null,
      total_consistency_delta: totalConsistencyDelta,
      total_consistency_tolerance: totalConsistencyTolerance,
    },
  };

  const extractionRaw = {
    status: "processed",
    model: openAiModel,
    source: "pdf_text",
    extracted_text_length: extractedText.length,
    extracted_text_sha256: createHash("sha256").update(extractedText).digest("hex"),
    text_preview: extractedText.slice(0, 300),
    extracted_fields: extractedFields,
    confidence,
  };

  const extractedAtIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      ...extractedFields,
      extracted_at: extractedAtIso,
      extraction_confidence: extractionConfidence,
      extraction_raw: extractionRaw,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("user_id", user.id);

  if (updateError) {
    logInvoiceProcessDebug({
      invoiceId,
      status: "error",
      textLength: extractedText.length,
      textPreview: extractedText.slice(0, 300),
      reason: "invoice_update_error",
    });
    return NextResponse.json({ error: "No se pudo actualizar la factura procesada." }, { status: 500 });
  }

  logInvoiceProcessDebug({
    invoiceId,
    status: "processed",
    textLength: extractedText.length,
    textPreview: extractedText.slice(0, 300),
  });

  return NextResponse.json({
    status: "processed",
    invoice: {
      id: invoiceId,
      ...extractedFields,
      extracted_at: extractedAtIso,
      extraction_confidence: extractionConfidence,
    },
  });
}
