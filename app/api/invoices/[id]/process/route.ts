import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  // Validación de API Key Directa
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
    // 1. Obtener datos de la factura
    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }

    // 2. Procesar con Gemini (Simulación de análisis profundo)
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `Analiza esta factura para contabilidad:
    Proveedor: ${invoice.supplier_name}
    Total: ${invoice.total_cop}
    Fecha: ${invoice.due_date}

    Responde un breve resumen de 1 frase sobre qué tipo de gasto parece ser.`;

    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    // 3. Actualizar metadatos (ejemplo)
    // Aquí podrías guardar el resumen en una columna 'notes' o similar

    return NextResponse.json({ success: true, analysis: summary });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error procesando factura";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
