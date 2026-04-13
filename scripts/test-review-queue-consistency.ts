/**
 * Test that classifyInvoices() (pure) and getReviewQueue() (DB) produce
 * identical results for the same user.
 *
 * Usage:
 *   npm run test:review-queue-consistency -- --user-email <email>
 *   npm run test:review-queue-consistency -- --user-id <uuid>
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolveUserFilter } from "./lib/resolve-user-filter";
import { getReceiptsCounts } from "../lib/invoices/getReceiptsCounts";
import { getReviewQueue } from "../lib/invoices/getReviewQueue";
import {
  classifyInvoices,
  REVIEW_PRIORITY_ORDER,
  type ClassifyInvoiceRow,
  type ReviewQueueItem,
} from "../lib/invoices/review-queue-core";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function itemKey(item: ReviewQueueItem): string {
  return `${item.invoice_id}|${item.priority}|${item.reason}|${item.available_actions.join(",")}|${item.badge_color}`;
}

async function main() {
  const filterUserId = await resolveUserFilter(supabase, process.argv);
  if (!filterUserId) {
    console.error("Usage: npm run test:review-queue-consistency -- --user-email <email> | --user-id <uuid>");
    process.exit(1);
  }

  console.log("\n=== REVIEW QUEUE CONSISTENCY TEST ===\n");

  // Path A: getReviewQueue() — the DB orchestrator
  const dbResult = await getReviewQueue({ supabase, userId: filterUserId });

  // Path B: manual query + classifyInvoices() — same path as chat route
  const { data: rawInvoices, error } = await supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, total_cop, iva_cop, due_date, payment_status, data_quality_status, vat_status")
    .eq("user_id", filterUserId);

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  const rows = (rawInvoices ?? []) as ClassifyInvoiceRow[];
  const receiptCounts = await getReceiptsCounts(supabase, rows.map((r) => r.id));
  const pureResult = classifyInvoices(rows, receiptCounts);

  // Compare
  let failures = 0;

  // 1. Same total count
  if (dbResult.total !== pureResult.total) {
    console.error(`FAIL: total count differs — DB: ${dbResult.total}, pure: ${pureResult.total}`);
    failures++;
  } else {
    console.log(`  total count: ${dbResult.total} (match)`);
  }

  // 2. Same items count
  if (dbResult.items.length !== pureResult.items.length) {
    console.error(`FAIL: items length differs — DB: ${dbResult.items.length}, pure: ${pureResult.items.length}`);
    failures++;
  } else {
    console.log(`  items length: ${dbResult.items.length} (match)`);
  }

  // 3. Same order and content
  const maxLen = Math.max(dbResult.items.length, pureResult.items.length);
  for (let i = 0; i < maxLen; i++) {
    const dbItem = dbResult.items[i];
    const pureItem = pureResult.items[i];

    if (!dbItem || !pureItem) {
      console.error(`FAIL: item[${i}] missing — DB: ${dbItem ? "present" : "missing"}, pure: ${pureItem ? "present" : "missing"}`);
      failures++;
      continue;
    }

    const dbKey = itemKey(dbItem);
    const pureKey = itemKey(pureItem);

    if (dbKey !== pureKey) {
      console.error(`FAIL: item[${i}] differs`);
      console.error(`  DB:   ${dbKey}`);
      console.error(`  Pure: ${pureKey}`);
      failures++;
    }
  }

  // 4. Verify priority order is correct
  for (let i = 1; i < pureResult.items.length; i++) {
    const prev = REVIEW_PRIORITY_ORDER[pureResult.items[i - 1].priority];
    const curr = REVIEW_PRIORITY_ORDER[pureResult.items[i].priority];
    if (curr < prev) {
      console.error(`FAIL: sort order broken at item[${i}] — ${pureResult.items[i - 1].priority}(${prev}) before ${pureResult.items[i].priority}(${curr})`);
      failures++;
    }
  }

  // 5. Verify all items have required fields
  for (const item of pureResult.items) {
    if (!item.invoice_id) { console.error(`FAIL: missing invoice_id`); failures++; }
    if (!item.priority) { console.error(`FAIL: missing priority for ${item.invoice_id}`); failures++; }
    if (!item.reason) { console.error(`FAIL: missing reason for ${item.invoice_id}`); failures++; }
    if (!item.available_actions || item.available_actions.length === 0) {
      console.error(`FAIL: missing available_actions for ${item.invoice_id}`);
      failures++;
    }
    if (!item.badge_color) { console.error(`FAIL: missing badge_color for ${item.invoice_id}`); failures++; }
  }

  // 6. Print distribution
  const byPriority: Record<string, number> = {};
  for (const item of pureResult.items) {
    byPriority[item.priority] = (byPriority[item.priority] ?? 0) + 1;
  }
  console.log("\n─── Distribution ───");
  for (const [p, c] of Object.entries(byPriority).sort()) {
    console.log(`  ${p.padEnd(20)} ${c}`);
  }

  console.log("");
  if (failures === 0) {
    console.log("  ALL CHECKS PASSED\n");
    process.exit(0);
  } else {
    console.log(`  ${failures} CHECK(S) FAILED\n`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
