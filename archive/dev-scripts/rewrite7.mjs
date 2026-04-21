import fs from "fs";

let c = fs.readFileSync("app/api/receipts/upload/route.ts", "utf-8");

c = c.replace(/type UploadReceiptContext = \{\s*params: Promise<\{\s*id: string;\s*\}>;\s*\};\s*/, "");
c = c.replace(/export async function POST\(request: Request, context: UploadReceiptContext\) \{[\s\S]*?const supabase = await createServerSupabaseClient\(\);/, "export async function POST(request: Request) {\n  const supabase = await createServerSupabaseClient();\n  const formData = await request.formData();\n  const invoiceId = formData.get(\"invoiceId\")?.toString();");
c = c.replace(/const formData = await request\.formData\(\);\n  const file = formData\.get\("file"\);/, "const file = formData.get(\"file\");");

c = c.replace(/type AuditResult = \{[\s\S]*?\};/m, "type AuditResult = {\n  match: boolean;\n  confidence: number;\n  reason: string;\n  monto_pagado: number | null;\n  fecha_pago: string | null;\n  referencia: string | null;\n};");

c = c.replace(/function parseAuditResult\(raw: string\): AuditResult \| null \{[\s\S]*?return \{[\s\S]*?\};\n\}/m, "function parseAuditResult(raw: string): AuditResult | null {\n  const parsed = parseAuditJson(raw);\n  if (!parsed) return null;\n\n  const confidenceRaw = parsed.confidence;\n  const confidence = typeof confidenceRaw === \"number\" ? confidenceRaw : Number(confidenceRaw);\n  const detectedAmountRaw = parsed.detected_amount;\n  const detectedAmount = detectedAmountRaw === null || detectedAmountRaw === undefined ? null : typeof detectedAmountRaw === \"number\" ? detectedAmountRaw : Number(detectedAmountRaw);\n\n  const montoPagado = parsed.monto_pagado ? Number(parsed.monto_pagado) : detectedAmount;\n\n  return {\n    match: Boolean(parsed.match),\n    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,\n    reason: typeof parsed.reason === \"string\" ? parsed.reason.trim() : \"Sin razón provista por auditor IA.\",\n    monto_pagado: montoPagado,\n    fecha_pago: parsed.fecha_pago ? String(parsed.fecha_pago) : null,\n    referencia: parsed.referencia ? String(parsed.referencia) : null,\n  };\n}");

c = c.replace(/const prompt = \[[\s\S]*?\]\.join\("\\n"\);/m, "const prompt = [\n    \"Eres un auditor de comprobantes de pago en Colombia.\",\n    \"Analiza esta evidencia (recibo) con los datos esperados de la factura y decide si corresponde.\",\n    \"Además, DEBES extraer: monto_pagado, fecha_pago y referencia (número de transacción o comprobante).\",\n    \"Responde SOLO JSON con este esquema:\",\n    `{\"match\": boolean, \"confidence\": number, \"reason\": string, \"monto_pagado\": number, \"fecha_pago\": \"YYYY-MM-DD\", \"referencia\": \"string\"}`,\n    \"Datos esperados del pago:\",\n    `- Proveedor: ${params.expectedSupplierName ?? \"No disponible\"}`,\n    `- Factura: ${params.expectedInvoiceNumber ?? \"No disponible\"}`,\n    `- Monto exacto COP: ${params.expectedTotalCop ?? \"No disponible\"}`,\n    `- Fecha límite: ${params.expectedDueDate ?? \"No disponible\"}`,\n  ].join(\"\\n\");");

c = c.replace(/if \(\!invoiceId\) \{\n    return NextResponse\.json\(\{ error: "Id de factura inválido\." \}, \{ status: 400 \}\);\n  \}/, "if (!invoiceId) { return NextResponse.json({ error: \"Id de factura no provisto.\" }, { status: 400 }); }");

fs.writeFileSync("app/api/receipts/upload/route.ts", c, "utf-8");
console.log("patched!!!");
