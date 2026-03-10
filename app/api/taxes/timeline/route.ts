import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiConfig } from "@/lib/ai/gemini";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile || !profile.nit) {
      return NextResponse.json({ error: "Falta configurar NIT en el perfil (RUT)." }, { status: 404 });
    }

    const nit = profile.nit;
    const ultimoDigito = nit.slice(-1);
    
    const responsabilidades = [];
    if (profile.impuesto_sobre_la_renta) responsabilidades.push("Impuesto sobre la renta");
    if (profile.retencion_en_la_fuente) responsabilidades.push("Retención en la fuente");
    if (profile.autorretenedor) responsabilidades.push("Autorretenedor");
    if (profile.responsable_de_iva) responsabilidades.push("Responsable de IVA");
    if (profile.regimen_simple) responsabilidades.push("Régimen Simple");
    if (profile.gran_contribuyente) responsabilidades.push("Gran Contribuyente");

    const geminiConfig = getGeminiConfig();
    if (!geminiConfig.hasApiKey) {
      return NextResponse.json({ error: "Llave de Gemini no configurada." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(geminiConfig.apiKey);
    const model = genAI.getGenerativeModel({ 
      model: geminiConfig.model,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const currentDate = "2026-03-09";
    const prompt = `Actúas como un experto en el calendario tributario de Colombia DIAN para el año 2026.
Teniendo en cuenta que la fecha actual es ${currentDate}, necesitamos los próximos 3 plazos o vencimientos tributarios que apliquen ESPECÍFICAMENTE a este contribuyente:
- NIT: ${nit} (Último dígito: ${ultimoDigito})
- Responsabilidades fiscales: ${responsabilidades.join(", ")}

Instrucciones:
1. Revisa las reglas generales de vencimientos en Colombia (IVA, Retefuente, Renta) para 2026 según el último dígito del NIT (${ultimoDigito}).
2. Descarta las responsabilidades que este NIT NO tenga.
3. Devuelve los próximos 3 eventos exactamente a partir de ${currentDate} en formato JSON.

Estructura estricta:
[
  {
    "title": "Nombre de la obligación (ej. Declaración de IVA Bimestral)",
    "dueDate": "YYYY-MM-DD",
    "description": "Breve explicación u obligación aplicable al dígito ${ultimoDigito}"
  }
]`;

    // Optionally pass the calendar file if we have it uploaded, or just rely on model knowledge for MVP
    // Here we rely on the internal knowledge, as requested: "puedes pedirle a Gemini una mini-API que devuelva los próximos 3 eventos del calendario para ese NIT".

    const result = await model.generateContent([{ text: prompt }]);
    const rawMsg = result.response.text();
    let events = [];
    try {
      events = JSON.parse(rawMsg);
    } catch {
      const clean = rawMsg.replace(/```json/g, "").replace(/```/g, "").trim();
      events = JSON.parse(clean);
    }

    return NextResponse.json({ success: true, events });
  } catch (error) {
    return NextResponse.json({ error: "Error calculando próximos vencimientos." }, { status: 500 });
  }
}
