import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { computeDataQuality } from "../lib/invoices/computeDataQuality";
import { computeVatStatus } from "../lib/invoices/computeVatStatus";

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
  total_cop: number | null;
  subtotal_cop: number | null;
  iva_cop: number | null;
  due_date: string | null;
  payment_status: string | null;
  data_quality_status: string | null;
  data_quality_flags: Record<string, boolean> | null;
  vat_status: string | null;
  vat_reason: string | null;
  vat_amount_usable_cop: number | null;
  vat_amount_review_cop: number | null;
  vat_amount_blocked_cop: number | null;
  extraction_confidence: Record<string, unknown> | null;
};

async function recomputeOne(inv: InvoiceRow, dryRun: boolean): Promise<boolean> {
  // Get confidence
  const ec = inv.extraction_confidence;
  const confidence =
    ec && typeof ec === "object" && typeof (ec as Record<string, unknown>).overall === "number"
      ? (ec as Record<string, unknown>).overall as number
      : null;

  // Recompute quality
  const newQuality = computeDataQuality({
    confidence,
    supplier_name: inv.supplier_name,
    due_date: inv.due_date,
    total_cop: inv.total_cop,
    subtotal_cop: typeof inv.subtotal_cop === "number" ? inv.subtotal_cop : null,
    iva_cop: typeof inv.iva_cop === "number" ? inv.iva_cop : null,
  });

  // Count receipts
  const { count: receiptsCount } = await supabase
    .from("invoice_receipts")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", inv.id);

  // Recompute VAT
  const newVat = computeVatStatus({
    iva_cop: typeof inv.iva_cop === "number" ? inv.iva_cop : null,
    payment_status: inv.payment_status,
    receipts_count: receiptsCount ?? 0,
    data_quality_status: newQuality.status,
  });

  const qualityChanged = newQuality.status !== inv.data_quality_status;
  const vatChanged = newVat.vat_status !== inv.vat_status;
  const anyChange = qualityChanged || vatChanged;

  if (anyChange) {
    const shortId = inv.id.slice(0, 8);
    const parts: string[] = [];
    if (qualityChanged) {
      parts.push(`quality: ${inv.data_quality_status} → ${newQuality.status}`);
    }
    if (vatChanged) {
      parts.push(`vat: ${inv.vat_status} → ${newVat.vat_status}`);
    }
    console.log(`  ${dryRun ? "WOULD UPDATE" : "UPDATED"} ${shortId}  ${parts.join(" | ")}`);
  }

  if (!dryRun && anyChange) {
    const { error } = await supabase
      .from("invoices")
      .update({
        data_quality_status: newQuality.status,
        data_quality_flags: newQuality.flags,
        vat_status: newVat.vat_status,
        vat_reason: newVat.vat_reason,
        vat_amount_usable_cop: newVat.vat_amount_usable_cop,
        vat_amount_review_cop: newVat.vat_amount_review_cop,
        vat_amount_blocked_cop: newVat.vat_amount_blocked_cop,
      })
      .eq("id", inv.id);

    if (error) {
      console.warn(`    ⚠️  Update failed: ${error.message}`);
      return false;
    }
  }

  return anyChange;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const invoiceId = args.find((a) => !a.startsWith("--"));

  if (!all && !invoiceId) {
    console.error("Usage:");
    console.error("  npm run recompute:invoice -- <invoice_id>");
    console.error("  npm run recompute:invoice -- <invoice_id> --dry-run");
    console.error("  npm run recompute:invoice -- --all --dry-run");
    console.error("  npm run recompute:invoice -- --all");
    process.exit(1);
  }

  const SELECT_COLS = "id, supplier_name, total_cop, subtotal_cop, iva_cop, due_date, payment_status, data_quality_status, data_quality_flags, vat_status, vat_reason, vat_amount_usable_cop, vat_amount_review_cop, vat_amount_blocked_cop, extraction_confidence";

  if (all) {
    console.log(`\n=== RECOMPUTE ${dryRun ? "(DRY RUN)" : ""} — all invoices ===\n`);

    const BATCH = 100;
    let offset = 0;
    let processed = 0;
    let changed = 0;

    while (true) {
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select(SELECT_COLS)
        .range(offset, offset + BATCH - 1)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Query error:", error.message);
        break;
      }

      if (!invoices || invoices.length === 0) break;

      for (const inv of invoices as InvoiceRow[]) {
        const didChange = await recomputeOne(inv, dryRun);
        if (didChange) changed++;
        processed++;
      }

      offset += invoices.length;
      if (invoices.length < BATCH) break;
    }

    console.log(`\n✅ Processed: ${processed}, Changed: ${changed}${dryRun ? " (dry run, no writes)" : ""}\n`);
  } else {
    console.log(`\n=== RECOMPUTE ${dryRun ? "(DRY RUN)" : ""} — ${invoiceId} ===\n`);

    const { data: inv, error } = await supabase
      .from("invoices")
      .select(SELECT_COLS)
      .eq("id", invoiceId)
      .maybeSingle();

    if (error) {
      console.error("Query error:", error.message);
      process.exit(1);
    }

    if (!inv) {
      console.error(`Invoice not found: ${invoiceId}`);
      process.exit(1);
    }

    const didChange = await recomputeOne(inv as InvoiceRow, dryRun);
    console.log(didChange ? "" : "  No changes needed.");
    console.log("");
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
