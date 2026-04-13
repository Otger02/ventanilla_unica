import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { computeDataQuality } from "../lib/invoices/computeDataQuality";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local\n" +
      "Add SUPABASE_SERVICE_ROLE_KEY from Supabase Dashboard > Project Settings > API"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 100;
const limit = parseInt(process.argv[2] ?? "0", 10) || 0;

async function main() {
  console.log("\n=== Backfill Data Quality ===\n");
  if (limit > 0) console.log(`Limit: ${limit} invoices\n`);

  let processed = 0;
  let countOk = 0;
  let countSuspect = 0;
  let countIncomplete = 0;
  let offset = 0;

  while (true) {
    if (limit > 0 && processed >= limit) break;

    const take = limit > 0 ? Math.min(BATCH_SIZE, limit - processed) : BATCH_SIZE;

    const { data: rows, error } = await supabase
      .from("invoices")
      .select("id, supplier_name, total_cop, due_date, subtotal_cop, iva_cop, extraction_confidence, extraction_raw")
      .order("created_at", { ascending: true })
      .range(offset, offset + take - 1);

    if (error) {
      // If extraction columns don't exist yet, retry without them
      if (error.message.includes("extraction_confidence")) {
        console.warn("  Column extraction_confidence missing — run migration 20260226_pr_fact_02_invoice_extraction.sql");
        console.warn("  Proceeding without confidence data (low_confidence flag will be inaccurate)\n");
        const { data: fallbackRows, error: fbErr } = await supabase
          .from("invoices")
          .select("id, supplier_name, total_cop, due_date, subtotal_cop, iva_cop")
          .order("created_at", { ascending: true })
          .range(offset, offset + take - 1);
        if (fbErr || !fallbackRows) {
          console.error("Query error:", fbErr?.message);
          process.exit(1);
        }
        // Process without confidence
        for (const row of fallbackRows) {
          const result = computeDataQuality({
            confidence: null,
            supplier_name: row.supplier_name,
            total_cop: typeof row.total_cop === "number" ? row.total_cop : null,
            subtotal_cop: typeof row.subtotal_cop === "number" ? row.subtotal_cop : null,
            iva_cop: typeof row.iva_cop === "number" ? row.iva_cop : null,
            due_date: row.due_date,
          });
          await supabase.from("invoices").update({ data_quality_status: result.status, data_quality_flags: result.flags }).eq("id", row.id);
          if (result.status === "ok") countOk++;
          else if (result.status === "suspect") countSuspect++;
          else countIncomplete++;
          processed++;
        }
        if (fallbackRows.length < take) break;
        offset += fallbackRows.length;
        process.stdout.write(`  Processed ${processed}...\r`);
        continue;
      }
      console.error("Query error:", error.message);
      process.exit(1);
    }

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const confidence = (() => {
        // Try extraction_confidence.overall first
        if (row.extraction_confidence && typeof row.extraction_confidence === "object") {
          const obj = row.extraction_confidence as Record<string, unknown>;
          if (typeof obj.overall === "number") return obj.overall;
        }
        // Fallback: extraction_raw.confidence.overall
        if (row.extraction_raw && typeof row.extraction_raw === "object") {
          const raw = row.extraction_raw as Record<string, unknown>;
          if (raw.confidence && typeof raw.confidence === "object") {
            const conf = raw.confidence as Record<string, unknown>;
            if (typeof conf.overall === "number") return conf.overall;
          }
        }
        return null;
      })();

      const result = computeDataQuality({
        confidence,
        supplier_name: row.supplier_name,
        total_cop: typeof row.total_cop === "number" ? row.total_cop : null,
        subtotal_cop: typeof row.subtotal_cop === "number" ? row.subtotal_cop : null,
        iva_cop: typeof row.iva_cop === "number" ? row.iva_cop : null,
        due_date: row.due_date,
      });

      const { error: updateErr } = await supabase
        .from("invoices")
        .update({
          data_quality_status: result.status,
          data_quality_flags: result.flags,
        })
        .eq("id", row.id);

      if (updateErr) {
        console.error(`  [ERROR] ${row.id}: ${updateErr.message}`);
        continue;
      }

      if (result.status === "ok") countOk++;
      else if (result.status === "suspect") countSuspect++;
      else countIncomplete++;

      processed++;
    }

    offset += rows.length;
    process.stdout.write(`  Processed ${processed}...\r`);

    if (rows.length < take) break;
  }

  console.log(`\n\nResults:`);
  console.log(`  Total:      ${processed}`);
  console.log(`  OK:         ${countOk}`);
  console.log(`  Suspect:    ${countSuspect}`);
  console.log(`  Incomplete: ${countIncomplete}`);
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
