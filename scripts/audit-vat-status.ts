import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { getReceiptsCounts } from "../lib/invoices/getReceiptsCounts";
import { resolveUserFilter } from "./lib/resolve-user-filter";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Row = {
  id: string;
  iva_cop: number | null;
  vat_status: string | null;
  data_quality_status: string | null;
  payment_status: string | null;
};

async function main() {
  const filterUserId = await resolveUserFilter(supabase, process.argv);

  let query = supabase
    .from("invoices")
    .select("id, iva_cop, vat_status, data_quality_status, payment_status");
  if (filterUserId) query = query.eq("user_id", filterUserId);

  const { data: invoices, error } = await query;

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  const rows = (invoices ?? []) as Row[];
  const total = rows.length;

  // Get receipt counts from invoice_receipts table
  const receiptCounts = await getReceiptsCounts(supabase, rows.map((r) => r.id));

  console.log(`\n=== VAT AUDIT SUMMARY — ${total} invoices ===\n`);

  // 1. By vat_status
  const byVat: Record<string, number> = {};
  for (const r of rows) {
    const k = r.vat_status ?? "(null)";
    byVat[k] = (byVat[k] ?? 0) + 1;
  }
  console.log("─── vat_status ───");
  for (const [k, v] of Object.entries(byVat).sort()) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  // 2. By data_quality_status
  const byQuality: Record<string, number> = {};
  for (const r of rows) {
    const k = r.data_quality_status ?? "(null)";
    byQuality[k] = (byQuality[k] ?? 0) + 1;
  }
  console.log("\n─── data_quality_status ───");
  for (const [k, v] of Object.entries(byQuality).sort()) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  // 3. Cross: vat_status × data_quality_status
  const cross: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const vs = r.vat_status ?? "(null)";
    const dq = r.data_quality_status ?? "(null)";
    if (!cross[vs]) cross[vs] = {};
    cross[vs][dq] = (cross[vs][dq] ?? 0) + 1;
  }
  const allDq = [...new Set(rows.map((r) => r.data_quality_status ?? "(null)"))].sort();
  console.log("\n─── vat_status × data_quality_status ───");
  console.log(`  ${"".padEnd(20)} ${allDq.map((d) => d.padEnd(12)).join("")}`);
  for (const [vs, inner] of Object.entries(cross).sort()) {
    const cells = allDq.map((d) => String(inner[d] ?? 0).padEnd(12));
    console.log(`  ${vs.padEnd(20)} ${cells.join("")}`);
  }

  // 4. Key metrics
  const ivaPositive = rows.filter((r) => typeof r.iva_cop === "number" && r.iva_cop > 0).length;
  const ivaNull = rows.filter((r) => r.iva_cop === null || r.iva_cop === undefined).length;
  const ivaZero = total - ivaPositive - ivaNull;
  const vatSinIva = byVat["sin_iva"] ?? 0;
  const vatRevision = byVat["iva_en_revision"] ?? 0;
  const vatNoUsable = byVat["iva_no_usable"] ?? 0;
  const paid = rows.filter((r) => r.payment_status === "paid").length;
  const unpaid = rows.filter((r) => r.payment_status === "unpaid").length;
  const scheduled = rows.filter((r) => r.payment_status === "scheduled").length;
  const withReceipts = rows.filter((r) => (receiptCounts.get(r.id) ?? 0) > 0).length;
  const noReceipts = total - withReceipts;

  console.log("\n─── Key Metrics ───");
  const metrics: [string, number][] = [
    ["iva_cop > 0", ivaPositive],
    ["iva_cop null", ivaNull],
    ["iva_cop = 0", ivaZero],
    ["vat: sin_iva", vatSinIva],
    ["vat: iva_en_revision", vatRevision],
    ["vat: iva_no_usable", vatNoUsable],
    ["payment: paid", paid],
    ["payment: unpaid", unpaid],
    ["payment: scheduled", scheduled],
    ["receipts > 0", withReceipts],
    ["receipts = 0", noReceipts],
  ];
  for (const [label, value] of metrics) {
    console.log(`  ${label.padEnd(24)} ${value}`);
  }

  console.log("");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
