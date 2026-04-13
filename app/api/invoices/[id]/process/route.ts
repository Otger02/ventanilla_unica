import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { computeDataQuality } from "@/lib/invoices/computeDataQuality";
import { computeVatStatus } from "@/lib/invoices/computeVatStatus";
import { logInvoiceActivity } from "@/lib/invoices/logInvoiceActivity";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta configuración de IA" }, { status: 500 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id: invoiceId } = await context.params;

  try {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            supplier_name: { type: SchemaType.STRING },
            total_cop: { type: SchemaType.NUMBER },
            due_date: { type: SchemaType.STRING, description: "YYYY-MM-DD or empty" },
            expense_type: { type: SchemaType.STRING, description: "Category: servicios, arriendo, impuesto, nomina, tecnologia, marketing, otro" },
            summary: { type: SchemaType.STRING, description: "1-sentence analysis" },
            confidence: { type: SchemaType.NUMBER, description: "0.0 to 1.0" },
          },
          required: ["supplier_name", "total_cop", "summary", "confidence"],
        },
      },
    });

    const prompt = `Analiza esta factura colombiana y extrae/confirma datos:
    Proveedor actual: ${invoice.supplier_name ?? "desconocido"}
    Total actual: ${invoice.total_cop ?? "desconocido"}
    Fecha vencimiento actual: ${invoice.due_date ?? "desconocido"}

    Confirma o corrige supplier_name, total_cop y due_date.
    Clasifica el tipo de gasto (expense_type) y da un resumen de 1 frase.
    Indica tu nivel de confianza (confidence) de 0.0 a 1.0.`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: "La IA no devolvió JSON válido" }, { status: 502 });
    }

    const updatedSupplier = typeof extracted.supplier_name === "string" && extracted.supplier_name.trim()
      ? extracted.supplier_name.trim()
      : invoice.supplier_name;
    const updatedTotal = typeof extracted.total_cop === "number" && extracted.total_cop > 0
      ? extracted.total_cop
      : invoice.total_cop;
    const rawDueDate = typeof extracted.due_date === "string" ? extracted.due_date.trim() : "";
    const updatedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDueDate) ? rawDueDate : invoice.due_date;
    const confidence = typeof extracted.confidence === "number" ? extracted.confidence : null;

    const extractionRaw = {
      status: "processed",
      extracted_fields: extracted,
      confidence: { overall: confidence },
    };

    // --- Data quality flags ---
    const { status: dataQualityStatus, flags: dataQualityFlags } = computeDataQuality({
      confidence,
      supplier_name: updatedSupplier,
      due_date: updatedDueDate,
      total_cop: updatedTotal,
      subtotal_cop: typeof invoice.subtotal_cop === "number" ? invoice.subtotal_cop : null,
      iva_cop: typeof invoice.iva_cop === "number" ? invoice.iva_cop : null,
    });

    // --- VAT classification ---
    const { count: receiptsCount } = await supabase
      .from("invoice_receipts")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", invoiceId);

    const vatResult = computeVatStatus({
      iva_cop: typeof invoice.iva_cop === "number" ? invoice.iva_cop : null,
      payment_status: invoice.payment_status ?? null,
      receipts_count: receiptsCount ?? 0,
      data_quality_status: dataQualityStatus,
    });

    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        supplier_name: updatedSupplier,
        total_cop: updatedTotal,
        due_date: updatedDueDate,
        extracted_at: new Date().toISOString(),
        extraction_raw: extractionRaw,
        extraction_confidence: { overall: confidence },
        data_quality_status: dataQualityStatus,
        data_quality_flags: dataQualityFlags,
        vat_status: vatResult.vat_status,
        vat_reason: vatResult.vat_reason,
        vat_amount_usable_cop: vatResult.vat_amount_usable_cop,
        vat_amount_review_cop: vatResult.vat_amount_review_cop,
        vat_amount_blocked_cop: vatResult.vat_amount_blocked_cop,
      })
      .eq("id", invoiceId)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: "Error guardando análisis: " + updateError.message }, { status: 500 });
    }

    await logInvoiceActivity(supabase, {
      invoice_id: invoiceId,
      user_id: user.id,
      activity: "processed",
      metadata: { confidence, data_quality_status: dataQualityStatus },
    });

    return NextResponse.json({ success: true, status: "processed", analysis: extracted });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error procesando factura";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
