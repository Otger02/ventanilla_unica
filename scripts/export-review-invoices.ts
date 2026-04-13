import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

const CSV_COLUMNS = [
  "id",
  "supplier_name",
  "invoice_number",
  "total_cop",
  "iva_cop",
  "due_date",
  "payment_status",
  "data_quality_status",
  "data_quality_flags",
  "vat_status",
  "vat_reason",
  "receipts_count",
  "created_at",
] as const;

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const filterUserId = await resolveUserFilter(supabase, process.argv);

  let query = supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, total_cop, iva_cop, due_date, payment_status, data_quality_status, data_quality_flags, vat_status, vat_reason, created_at")
    .or("data_quality_status.neq.ok,vat_status.in.(iva_en_revision,iva_no_usable)")
    .order("created_at", { ascending: false });
  if (filterUserId) query = query.eq("user_id", filterUserId);

  const { data: invoices, error } = await query;

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  const rawRows = (invoices ?? []) as unknown as Record<string, unknown>[];

  // Get receipt counts from invoice_receipts table
  const receiptCounts = await getReceiptsCounts(supabase, rawRows.map((r) => String(r.id)));
  const rows: Record<string, unknown>[] = rawRows.map((r) => ({ ...r, receipts_count: receiptCounts.get(String(r.id)) ?? 0 }));

  if (rows.length === 0) {
    console.log("✅ No invoices need review.\n");
    return;
  }

  const header = CSV_COLUMNS.join(",");
  const csvRows = rows.map((row) =>
    CSV_COLUMNS.map((col) => escapeCsv(row[col])).join(","),
  );
  const csv = [header, ...csvRows].join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const dir = join(process.cwd(), "exports");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `review-invoices-${today}.csv`);
  writeFileSync(filePath, csv, "utf-8");

  console.log(`\n✅ Exported ${rows.length} invoices to: ${filePath}\n`);

  // Quick breakdown
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    const bucket =
      row.data_quality_status !== "ok"
        ? `quality:${row.data_quality_status}`
        : `vat:${row.vat_status}`;
    byReason[bucket] = (byReason[bucket] ?? 0) + 1;
  }
  console.log("─── Breakdown ───");
  for (const [k, v] of Object.entries(byReason).sort()) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }
  console.log("");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
