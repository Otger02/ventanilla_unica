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
  supplier_name: string | null;
  iva_cop: number | null;
  vat_status: string | null;
  vat_reason: string | null;
  vat_amount_usable_cop: number | null;
  vat_amount_review_cop: number | null;
  vat_amount_blocked_cop: number | null;
  data_quality_status: string | null;
};

type Issue = { id: string; supplier: string; type: string; detail: string };

async function main() {
  const filterUserId = await resolveUserFilter(supabase, process.argv);

  let query = supabase
    .from("invoices")
    .select("id, supplier_name, iva_cop, vat_status, vat_reason, vat_amount_usable_cop, vat_amount_review_cop, vat_amount_blocked_cop, data_quality_status");
  if (filterUserId) query = query.eq("user_id", filterUserId);

  const { data: invoices, error } = await query;

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  const rows = (invoices ?? []) as Row[];
  const issues: Issue[] = [];
  const tag = (r: Row, type: string, detail: string) =>
    issues.push({ id: r.id, supplier: r.supplier_name ?? "—", type, detail });

  // Get receipt counts from invoice_receipts table
  const receiptCounts = await getReceiptsCounts(supabase, rows.map((r) => r.id));

  for (const r of rows) {
    const ivaCop = typeof r.iva_cop === "number" ? r.iva_cop : 0;
    const ivaNull = r.iva_cop === null || r.iva_cop === undefined;

    // iva_cop > 0 but vat_status = sin_iva
    if (ivaCop > 0 && r.vat_status === "sin_iva") {
      tag(r, "iva_positive_but_sin_iva", `iva_cop=${ivaCop}`);
    }

    // iva_cop null/0 but vat_status != sin_iva
    if ((ivaNull || ivaCop <= 0) && r.vat_status !== "sin_iva" && r.vat_status !== null) {
      tag(r, "no_iva_but_status_set", `iva_cop=${r.iva_cop}, vat_status=${r.vat_status}`);
    }

    // data_quality = incomplete but vat_status = iva_usable
    if (r.data_quality_status === "incomplete" && r.vat_status === "iva_usable") {
      tag(r, "incomplete_but_usable", "");
    }

    // data_quality = suspect but vat_status = iva_usable
    if (r.data_quality_status === "suspect" && r.vat_status === "iva_usable") {
      tag(r, "suspect_but_usable", "");
    }

    // receipts = 0 and vat_status = iva_usable
    if ((receiptCounts.get(r.id) ?? 0) === 0 && r.vat_status === "iva_usable") {
      tag(r, "no_receipt_but_usable", "");
    }

    // receipts > 0 and vat_status = iva_en_revision (unexpected)
    if (
      (receiptCounts.get(r.id) ?? 0) > 0 &&
      r.vat_status === "iva_en_revision" &&
      r.data_quality_status === "ok"
    ) {
      tag(r, "has_receipt_ok_quality_but_review", `reason=${r.vat_reason}`);
    }

    // Amount fields don't match iva_cop
    if (ivaCop > 0 && r.vat_status !== "sin_iva") {
      const usable = Number(r.vat_amount_usable_cop) || 0;
      const review = Number(r.vat_amount_review_cop) || 0;
      const blocked = Number(r.vat_amount_blocked_cop) || 0;
      const roundedIva = Math.round(ivaCop);
      const allocated = usable + review + blocked;
      if (allocated !== roundedIva) {
        tag(r, "amount_mismatch", `iva_cop=${roundedIva}, usable+review+blocked=${allocated}`);
      }
    }

    // Empty vat_reason when vat_status is set
    if (r.vat_status && r.vat_status !== "sin_iva" && (!r.vat_reason || r.vat_reason.trim() === "")) {
      tag(r, "missing_vat_reason", `vat_status=${r.vat_status}`);
    }
  }

  console.log(`\n=== VAT CONSISTENCY CHECK — ${rows.length} invoices ===\n`);

  if (issues.length === 0) {
    console.log("✅ No inconsistencies found.\n");
    process.exit(0);
  }

  // Print issues grouped by type
  const byType: Record<string, Issue[]> = {};
  for (const iss of issues) {
    if (!byType[iss.type]) byType[iss.type] = [];
    byType[iss.type].push(iss);
  }

  for (const [type, items] of Object.entries(byType).sort()) {
    console.log(`⚠️  ${type} (${items.length})`);
    for (const item of items.slice(0, 10)) {
      console.log(`    ${item.id.slice(0, 8)}  ${item.supplier.padEnd(25).slice(0, 25)}  ${item.detail}`);
    }
    if (items.length > 10) {
      console.log(`    ... and ${items.length - 10} more`);
    }
    console.log("");
  }

  console.log("─── Summary ───");
  for (const [type, items] of Object.entries(byType).sort()) {
    console.log(`  ${type.padEnd(35)} ${items.length}`);
  }
  console.log(`\n  Total inconsistencies: ${issues.length}\n`);

  process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
