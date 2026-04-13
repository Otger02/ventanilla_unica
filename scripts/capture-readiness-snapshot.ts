/**
 * capture-readiness-snapshot.ts — Capture a portfolio readiness snapshot.
 *
 * Usage:
 *   npm run capture:readiness-snapshot
 *   npm run capture:readiness-snapshot -- --user-email user@example.com
 *   npm run capture:readiness-snapshot -- --user-id <uuid>
 *
 * Without filter: captures for ALL users who have invoices.
 * With filter: captures for a single user.
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { classifyInvoices, type ClassifyInvoiceRow } from "../lib/invoices/review-queue-core";
import { getReceiptsCounts } from "../lib/invoices/getReceiptsCounts";
import { computePortfolioReadiness } from "../lib/invoices/computeReadinessScore";
import { resolveUserFilter } from "./lib/resolve-user-filter";

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

async function captureForUser(userId: string): Promise<boolean> {
  // Fetch invoices
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, total_cop, iva_cop, due_date, payment_status, data_quality_status, vat_status")
    .eq("user_id", userId);

  if (error) {
    console.error(`  Error fetching invoices for ${userId}: ${error.message}`);
    return false;
  }

  const rows = (invoices ?? []) as ClassifyInvoiceRow[];
  if (rows.length === 0) {
    console.log(`  ${userId}: no invoices, skipping`);
    return false;
  }

  // Get receipt counts
  const receiptCounts = await getReceiptsCounts(supabase, rows.map((r) => r.id));

  // Classify and compute portfolio readiness
  const { items } = classifyInvoices(rows, receiptCounts);
  const portfolio = computePortfolioReadiness(
    items.map((i) => ({
      score: i.readiness_score,
      level: i.readiness_level,
      reason: i.readiness_reason,
    }))
  );

  // Insert snapshot
  const { error: insertError } = await supabase
    .from("readiness_snapshots")
    .insert({
      user_id: userId,
      portfolio_score: portfolio.score,
      healthy_count: portfolio.breakdown.healthy,
      warning_count: portfolio.breakdown.warning,
      critical_count: portfolio.breakdown.critical,
    });

  if (insertError) {
    console.error(`  Error inserting snapshot for ${userId}: ${insertError.message}`);
    return false;
  }

  console.log(`  ${userId}: score=${portfolio.score} (${portfolio.level}) — ${items.length} items in queue`);
  return true;
}

async function main() {
  console.log("\n=== Capture Readiness Snapshot ===\n");

  const filteredUserId = await resolveUserFilter(supabase, process.argv);

  if (filteredUserId) {
    // Single user
    const ok = await captureForUser(filteredUserId);
    console.log(ok ? "\nDone." : "\nFailed.");
    process.exit(ok ? 0 : 1);
  }

  // All users: get distinct user_ids from invoices
  const { data: userRows, error } = await supabase
    .from("invoices")
    .select("user_id")
    .limit(1000);

  if (error) {
    console.error("Error fetching users:", error.message);
    process.exit(1);
  }

  const userIds = [...new Set((userRows ?? []).map((r: { user_id: string }) => r.user_id))];
  console.log(`Found ${userIds.length} user(s) with invoices\n`);

  let success = 0;
  for (const uid of userIds) {
    const ok = await captureForUser(uid);
    if (ok) success++;
  }

  console.log(`\nDone: ${success}/${userIds.length} snapshots captured.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
