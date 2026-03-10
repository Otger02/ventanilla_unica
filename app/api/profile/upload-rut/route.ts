import { Buffer } from "node:buffer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

import { getGeminiConfig } from "@/lib/ai/gemini";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Debes adjuntar un archivo (RUT)." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "Archivo demasiado grande." }, { status: 413 });
  }

  const geminiConfig = getGeminiConfig();
  if (!geminiConfig.hasApiKey) {
    return NextResponse.json({ error: "Falta API Key de Gemini" }, { status: 500 });
  }

  const genAI = new GoogleGenerativeAI(geminiConfig.apiKey);
  const model = genAI.getGenerativeModel({
    model: geminiConfig.model,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const prompt = [
    "Eres un asistente tributario experto en Colombia.",
    "Extrae del siguiente RUT los datos solicitados:",
    "- NIT completo incluyendo guión y dígito de verificación (Ej: 901918043-6) (Casilla 5 y 6)",
    "- Nombre o Razón Social completa tal y como aparece en la Casilla 35 o equivalente.",
    "- Todos los códigos numéricos de la Casilla 53 (Responsabilidades, Calidades y Atributos).",
    "- Actividad Económica Principal (Código CIIU, Casilla 46).",
    "- Tipo de Entidad: Identifica si es 'Entidad Sin Ánimo de Lucro' (ESAL), 'Régimen Especial', 'Sociedad Comercial', 'Persona Natural', etc.",
    "Devuélvelo estrictamente en JSON con este esquema:",
    `{
      "nit_con_dv": "string (con el guion, ej: 901918043-6)",
      "nit_solo_numeros": "string (solo numeros para busquedas)",
      "nombre_razon_social": "string",
      "codigos_responsabilidades": ["string", "string"],
      "actividad_economica_ciiu": "string",
      "tipo_entidad": "string"
    }`
  ].join("\\n");

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType: file.type,
        },
      },
      {
        text: prompt,
      },
    ]);

    const rawMsg = result.response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(rawMsg);
    } catch {
      // Intentar limpiar code blocks
      const clean = rawMsg.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
      parsed = JSON.parse(clean);
    }

    const { nit_con_dv, nit_solo_numeros, nombre_razon_social, codigos_responsabilidades, actividad_economica_ciiu, tipo_entidad } = parsed;

    // Aceptar cualquier forma de NIT
    const extractedNit = nit_solo_numeros || nit_con_dv?.split('-')[0] || parsed.nit;

    if (!extractedNit || !nombre_razon_social) {
      return NextResponse.json({ error: "No se pudo extraer el NIT o el Nombre del RUT." }, { status: 400 });
    }

    const codes = Array.isArray(codigos_responsabilidades) ? codigos_responsabilidades : [];

    const mappedData = {
      user_id: user.id,
      nit: extractedNit,
      nit_dv: nit_con_dv,
      nombre_razon_social,
      actividad_economica: actividad_economica_ciiu,
      tipo_entidad,
      es_esal: tipo_entidad?.toLowerCase().includes("sin ánimo de lucro") || tipo_entidad?.toLowerCase().includes("régimen especial") || codes.includes("04"),
      impuesto_sobre_la_renta: codes.includes("05"),
      retencion_en_la_fuente: codes.includes("07"),
      autorretenedor: codes.includes("15"),
      responsable_de_iva: codes.includes("48"),
      regimen_simple: codes.includes("47"),
      gran_contribuyente: codes.includes("13"),
      responsabilidades_raw: codes,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert(mappedData, { onConflict: "user_id" });

    if (upsertError) {
      return NextResponse.json({ error: "Error al actualizar el perfil en la base de datos.", details: upsertError }, { status: 500 });
    }

    return NextResponse.json({ success: true, profile: mappedData });

  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error procesando el RUT" }, { status: 500 });
  }
}
