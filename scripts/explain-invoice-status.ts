import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolveUserFilter } from "./lib/resolve-user-filter";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type InvoiceRow = {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  total_cop: number | null;
  iva_cop: number | null;
  due_date: string | null;
  payment_status: string | null;
  data_quality_status: string | null;
  data_quality_flags: Record<string, boolean> | null;
  vat_status: string | null;
  vat_reason: string | null;
};

function nextStep(row: InvoiceRow, receiptsCount: number): string {
  const flags = row.data_quality_flags ?? {};
  const steps: string[] = [];

  // Quality-based recommendations
  if (flags.missing_supplier) steps.push("Editar factura y añadir proveedor");
  if (flags.missing_due_date) steps.push("Editar factura y añadir fecha de vencimiento");
  if (flags.suspect_amount) steps.push("Revisar monto extraído — posible error de OCR");
  if (flags.low_confidence) steps.push("Revisar datos extraídos — baja confianza del extractor");

  // VAT-based recommendations
  if (row.vat_status === "iva_en_revision") {
    if (receiptsCount === 0) {
      steps.push("Subir comprobante de pago para habilitar IVA");
    }
    if (row.data_quality_status === "suspect") {
      steps.push("Corregir datos sospechosos antes de usar IVA");
    }
  }
  if (row.vat_status === "iva_no_usable") {
    steps.push("Completar datos de la factura antes de considerar el IVA");
  }

  // Payment-based
  if (row.payment_status === "unpaid" && row.due_date) {
    const due = new Date(row.due_date + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (due < now) {
      steps.push("¡Factura vencida! Programar o ejecutar pago urgente");
    }
  }

  return steps.length > 0 ? steps.join("\n    → ") : "Sin acción pendiente";
}

async function main() {
  const filterUserId = await resolveUserFilter(supabase, process.argv);

  // Find invoice_id: first positional arg that isn't a flag or flag value
  const skipFlags = new Set(["--user-email", "--user-id"]);
  let invoiceId: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    if (skipFlags.has(process.argv[i])) { i++; continue; }
    invoiceId = process.argv[i];
    break;
  }

  if (!invoiceId) {
    console.error("Usage: npm run explain:invoice -- <invoice_id> [--user-email <email>] [--user-id <uuid>]");
    process.exit(1);
  }

  let query = supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, total_cop, iva_cop, due_date, payment_status, data_quality_status, data_quality_flags, vat_status, vat_reason")
    .eq("id", invoiceId);
  if (filterUserId) query = query.eq("user_id", filterUserId);

  const { data: invoice, error } = await query.maybeSingle();

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  if (!invoice) {
    console.error(`Invoice not found: ${invoiceId}`);
    process.exit(1);
  }

  const r = invoice as InvoiceRow;
  const flags = r.data_quality_flags ?? {};
  const activeFlags = Object.entries(flags).filter(([, v]) => v).map(([k]) => k);

  // Count receipts from invoice_receipts table
  const { count: receiptsCount } = await supabase
    .from("invoice_receipts")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", r.id);

  console.log(`\n=== INVOICE STATUS EXPLANATION ===\n`);
  console.log(`  ID:               ${r.id}`);
  console.log(`  Proveedor:        ${r.supplier_name ?? "—"}`);
  console.log(`  Factura #:        ${r.invoice_number ?? "—"}`);
  console.log(`  Total COP:        ${r.total_cop ?? "—"}`);
  console.log(`  IVA COP:          ${r.iva_cop ?? "—"}`);
  console.log(`  Vencimiento:      ${r.due_date ?? "—"}`);

  console.log(`\n─── Payment ───`);
  console.log(`  Estado pago:      ${r.payment_status ?? "—"}`);
  console.log(`  Comprobantes:     ${receiptsCount ?? 0}`);

  console.log(`\n─── Data Quality ───`);
  console.log(`  Estado:           ${r.data_quality_status ?? "—"}`);
  console.log(`  Flags activos:    ${activeFlags.length > 0 ? activeFlags.join(", ") : "ninguno"}`);

  console.log(`\n─── IVA / VAT ───`);
  console.log(`  vat_status:       ${r.vat_status ?? "—"}`);
  console.log(`  vat_reason:       ${r.vat_reason ?? "—"}`);

  console.log(`\n─── Siguiente paso recomendado ───`);
  console.log(`    → ${nextStep(r, receiptsCount ?? 0)}`);

  console.log("");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
