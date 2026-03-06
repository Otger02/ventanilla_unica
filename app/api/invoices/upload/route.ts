import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// 1. Funciones Auxiliares Mínimas (Locales)
function sanitizeFileName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
}

function getExtension(fileName: string, mimeType: string) {
  if (mimeType === "application/pdf") return "pdf";
  const ext = sanitizeFileName(fileName).split(".").pop();
  return ext && /^[a-z0-9]+$/.test(ext) ? ext : "bin";
}

export async function POST(request: Request) {
  console.log("🚀 [UPLOAD-V2] Iniciando proceso...");

  // 2. Validación Directa de Entorno (Sin intermediarios)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ [CRITICAL] GEMINI_API_KEY es undefined en process.env");
    return NextResponse.json(
      { error: "Server Error: Missing API Key configuration" }, 
      { status: 500 }
    );
  }

  // 3. Autenticación Supabase
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Usuario no autenticado" }, { status: 401 });
  }

  try {
    // 4. Procesar Archivo
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Archivo inválido" }, { status: 400 });
    }

    const extension = getExtension(file.name, file.type);
    const detectedMimeType = file.type || (extension === "pdf" ? "application/pdf" : "application/octet-stream");

    if (detectedMimeType !== "application/pdf" && extension !== "pdf") {
      return NextResponse.json({ error: "Solo se permiten archivos PDF" }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

    // 5. Llamada a Gemini (Directa)
    console.log("🤖 Enviando a Gemini Flash...");
    const genAI = new GoogleGenerativeAI(apiKey);
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
            supplier_nit: { type: SchemaType.STRING }
          },
          required: ["supplier_name", "total_cop"],
        },
      },
    });

    const result = await model.generateContent([
      {
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType: detectedMimeType,
        },
      },
      { text: "Extrae datos de esta factura. Si no ves fecha de vencimiento, calcula +30 días." },
    ]);

    const rawText = result.response.text();
    console.log("📥 Gemini Raw Response:", rawText);
    const extracted = JSON.parse(rawText);

    // 6. Guardar en Base de Datos
    const { data: invoice, error: dbError } = await supabase
      .from("invoices")
      .insert({
        user_id: user.id,
        supplier_name: extracted.supplier_name || "Desconocido",
        invoice_number: extracted.invoice_number,
        total_cop: extracted.total_cop || 0,
        due_date: extracted.due_date,
        supplier_tax_id: extracted.supplier_nit,
        status: "unpaid",
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (dbError) throw new Error(`Error DB: ${dbError.message}`);

    // 7. Subir PDF a Storage
    const storagePath = `${user.id}/${invoice.id}/original.${extension}`;
    await supabase.storage.from("invoices").upload(storagePath, fileBuffer, {
      contentType: detectedMimeType,
      upsert: false,
    });
    
    // 8. Registrar Archivo
    await supabase.from("invoice_files").insert({
      invoice_id: invoice.id,
      user_id: user.id,
      storage_bucket: "invoices",
      storage_path: storagePath,
      mime_type: detectedMimeType,
      size_bytes: file.size,
      sha256
    });

    return NextResponse.json({ success: true, invoice });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("🔥 Error en Upload:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
