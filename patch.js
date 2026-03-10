const fs = require('fs');
let content = fs.readFileSync('app/api/receipts/upload/route.ts', 'utf-8');

content = content.replace(/type UploadReceiptContext = \{\s*params: Promise<\{\s*id: string;\s*\}>;\s*\};\s*/m, '');

content = content.replace(/export async function POST\(request: Request, context: UploadReceiptContext\) \{[\s\S]*?const supabase = await createServerSupabaseClient\(\);/m, 
\export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const formData = await request.formData();
  let invoiceId = formData.get("invoiceId")?.toString() || null;
\);

content = content.replace(/type AuditResult = \{[\s\S]*?\};/m, 
\	ype AuditResult = {
  match: boolean;
  confidence: number;
  reason: string;
  monto_pagado: number | null;
  fecha_pago: string | null;
  referencia: string | null;
};\);

content = content.replace(/function parseAuditResult\(raw: string\): AuditResult \| null \{[\s\S]*?return \{[\s\S]*?\};\n\}/m, 
\unction parseAuditResult(raw: string): AuditResult | null {
  const parsed = parseAuditJson(raw);
  if (!parsed) return null;

  const confidenceRaw = parsed.confidence;
  const confidence = typeof confidenceRaw === "number" ? confidenceRaw : Number(confidenceRaw);

  const montoPagado = parsed.monto_pagado ? Number(parsed.monto_pagado) : null;

  return {
    match: Boolean(parsed.match),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "Sin razón provista por auditor IA.",
    monto_pagado: montoPagado,
    fecha_pago: parsed.fecha_pago ? String(parsed.fecha_pago) : null,
    referencia: parsed.referencia ? String(parsed.referencia) : null,
  };
}\);

content = content.replace(/const prompt = \[[\s\S]*?\]\.join\("\\\\n"\);/m, 
\const prompt = [
    "Eres un auditor de comprobantes de pago en Colombia.",
    "Compara esta evidencia (recibo) con los datos esperados de la factura y decide si corresponde.",
    "Además, debes extraer: monto_pagado, fecha_pago y referencia.",
    "Responde SOLO JSON con este esquema:",
    '{"match": boolean, "confidence": number, "reason": string, "monto_pagado": number, "fecha_pago": "YYYY-MM-DD", "referencia": "string"}',
    "Datos esperados:",
    \\\- Proveedor: \\\\,
    \\\- Factura: \\\\,
    \\\- Monto exacto COP: \\\\,
    \\\- Fecha límite: \\\\,
  ].join("\\\\n");\);

content = content.replace(/const \{ data: invoice, error: invoiceError \} = await supabase\s*\.from\("invoices"\)\s*\.select\("id, user_id, payment_status, paid_at, total_cop, supplier_name, invoice_number, due_date"\)\s*\.eq\("id", invoiceId\)\s*\.eq\("user_id", user\.id\)\s*\.maybeSingle\(\);[\s\S]*?if \(!invoice\) \{\s*return NextResponse\.json\(\{ error: "Factura no encontrada\." \}, \{ status: 404 \}\);\s*\}/m, 
\if (!invoiceId) {
    return NextResponse.json({ error: "No se proporcionó invoiceId." }, { status: 400 });
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
  }\);

content = content.replace(/const formData = await request\.formData\(\);\n  const file = formData\.get\("file"\);/, 
\const file = formData.get("file");\);

fs.writeFileSync('app/api/receipts/upload/route.ts', content, 'utf-8');
console.log('Done!');
