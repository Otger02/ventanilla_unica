import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { computeVatStatus } from "../lib/invoices/computeVatStatus";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const limit = Number(process.argv[2]) || Infinity;
  const BATCH = 100;
  let offset = 0;
  let processed = 0;
  const stats = { usable: 0, review: 0, blocked: 0, sin_iva: 0 };

  console.log(`Backfilling VAT status (limit: ${limit === Infinity ? "all" : limit})...\n`);

  while (processed < limit) {
    const take = Math.min(BATCH, limit - processed);
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("id, iva_cop, payment_status, data_quality_status")
      .range(offset, offset + take - 1)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Query error:", error.message);
      break;
    }

    if (!invoices || invoices.length === 0) break;

    for (const inv of invoices) {
      // Count receipts for this invoice
      const { count } = await supabase
        .from("invoice_receipts")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", inv.id);

      const result = computeVatStatus({
        iva_cop: typeof inv.iva_cop === "number" ? inv.iva_cop : null,
        payment_status: inv.payment_status ?? null,
        receipts_count: count ?? 0,
        data_quality_status: inv.data_quality_status ?? null,
      });

      const { error: updateError } = await supabase
        .from("invoices")
        .update({
          vat_status: result.vat_status,
          vat_reason: result.vat_reason,
          vat_amount_usable_cop: result.vat_amount_usable_cop,
          vat_amount_review_cop: result.vat_amount_review_cop,
          vat_amount_blocked_cop: result.vat_amount_blocked_cop,
        })
        .eq("id", inv.id);

      if (updateError) {
        console.warn(`  ⚠️  ${inv.id}: ${updateError.message}`);
      }

      if (result.vat_status === "iva_usable") stats.usable++;
      else if (result.vat_status === "iva_en_revision") stats.review++;
      else if (result.vat_status === "iva_no_usable") stats.blocked++;
      else stats.sin_iva++;

      processed++;
    }

    console.log(`  Processed ${processed} invoices...`);
    offset += invoices.length;
    if (invoices.length < take) break;
  }

  console.log(`\n✅ Done. ${processed} invoices backfilled.`);
  console.log(`   Usable: ${stats.usable}`);
  console.log(`   En revisión: ${stats.review}`);
  console.log(`   Bloqueado: ${stats.blocked}`);
  console.log(`   Sin IVA: ${stats.sin_iva}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
