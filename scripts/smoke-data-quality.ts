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

const TEST_USER_ID = "00000000-0000-0000-0000-000000000099";
const TEST_EMAIL = "smoke-test-data-quality@test.local";

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------

type TestCase = {
  label: string;
  insert: Record<string, unknown>;
  qualityInput: Parameters<typeof computeDataQuality>[0];
  expectedStatus: "ok" | "suspect" | "incomplete";
  expectedFlagKey: string | null; // the flag that should be true, null = all false
};

const testCases: TestCase[] = [
  {
    label: "good",
    insert: {
      supplier_name: "SMOKE Proveedor OK",
      total_cop: 1_500_000,
      subtotal_cop: 1_260_504,
      iva_cop: 239_496,
      due_date: "2026-04-30",
      payment_status: "unpaid",
      source: "smoke-test",
    },
    qualityInput: {
      confidence: 0.95,
      supplier_name: "SMOKE Proveedor OK",
      total_cop: 1_500_000,
      subtotal_cop: 1_260_504,
      iva_cop: 239_496,
      due_date: "2026-04-30",
    },
    expectedStatus: "ok",
    expectedFlagKey: null,
  },
  {
    label: "missing_due_date",
    insert: {
      supplier_name: "SMOKE Sin Fecha",
      total_cop: 2_000_000,
      subtotal_cop: 1_680_672,
      iva_cop: 319_328,
      due_date: null,
      payment_status: "unpaid",
      source: "smoke-test",
    },
    qualityInput: {
      confidence: 0.85,
      supplier_name: "SMOKE Sin Fecha",
      total_cop: 2_000_000,
      subtotal_cop: 1_680_672,
      iva_cop: 319_328,
      due_date: null,
    },
    expectedStatus: "incomplete",
    expectedFlagKey: "missing_due_date",
  },
  {
    label: "suspect_amount",
    insert: {
      supplier_name: "SMOKE Monto Sospechoso",
      total_cop: 500,
      subtotal_cop: null,
      iva_cop: null,
      due_date: "2026-04-25",
      payment_status: "unpaid",
      source: "smoke-test",
    },
    qualityInput: {
      confidence: 0.9,
      supplier_name: "SMOKE Monto Sospechoso",
      total_cop: 500,
      subtotal_cop: null,
      iva_cop: null,
      due_date: "2026-04-25",
    },
    expectedStatus: "suspect",
    expectedFlagKey: "suspect_amount",
  },
  {
    label: "missing_supplier",
    insert: {
      supplier_name: null,
      total_cop: 3_000_000,
      subtotal_cop: null,
      iva_cop: null,
      due_date: "2026-04-20",
      payment_status: "unpaid",
      source: "smoke-test",
    },
    qualityInput: {
      confidence: 0.8,
      supplier_name: null,
      total_cop: 3_000_000,
      subtotal_cop: null,
      iva_cop: null,
      due_date: "2026-04-20",
    },
    expectedStatus: "incomplete",
    expectedFlagKey: "missing_supplier",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let failures = 0;

function check(label: string, expected: unknown, actual: unknown): boolean {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  if (pass) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.log(`  [FAIL] ${label}  expected=${JSON.stringify(expected)}  actual=${JSON.stringify(actual)}`);
    failures++;
  }
  return pass;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  await supabase.from("invoices").delete().eq("user_id", TEST_USER_ID);
  await supabase.auth.admin.deleteUser(TEST_USER_ID);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Data Quality Smoke Test ===\n");

  // Pre-cleanup in case previous run left data
  await cleanup();

  // Create test user (FK on auth.users required)
  const { error: createErr } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: "smoke-test-not-real",
    email_confirm: true,
    user_metadata: { smoke_test: true },
  });

  if (createErr) {
    // User might already exist — try to look them up
    if (!createErr.message.includes("already")) {
      console.error("Could not create test user:", createErr.message);
      process.exit(1);
    }
  }

  // Get the created user's ID (we can't specify the ID via admin API in all versions)
  const { data: userList } = await supabase.auth.admin.listUsers();
  const testUser = userList?.users.find((u) => u.email === TEST_EMAIL);
  if (!testUser) {
    console.error("Test user not found after creation");
    process.exit(1);
  }
  const userId = testUser.id;

  // ------------------------------------------------------------------
  // STEP 1: Insert invoices, compute quality, update
  // ------------------------------------------------------------------
  console.log("1. Invoice quality computation\n");

  const insertedIds: string[] = [];

  for (const tc of testCases) {
    // Insert
    const { data: inserted, error: insertErr } = await supabase
      .from("invoices")
      .insert({ ...tc.insert, user_id: userId })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error(`  [ERROR] Insert failed for ${tc.label}: ${insertErr?.message}`);
      failures++;
      continue;
    }

    insertedIds.push(inserted.id);

    // Compute
    const result = computeDataQuality(tc.qualityInput);

    // Update
    const { error: updateErr } = await supabase
      .from("invoices")
      .update({
        data_quality_status: result.status,
        data_quality_flags: result.flags,
      })
      .eq("id", inserted.id);

    if (updateErr) {
      console.error(`  [ERROR] Update failed for ${tc.label}: ${updateErr.message}`);
      failures++;
      continue;
    }

    // Read back
    const { data: row } = await supabase
      .from("invoices")
      .select("data_quality_status, data_quality_flags")
      .eq("id", inserted.id)
      .single();

    check(
      `${tc.label} → ${tc.expectedStatus}`,
      tc.expectedStatus,
      row?.data_quality_status
    );

    if (tc.expectedFlagKey) {
      const flagValue = (row?.data_quality_flags as Record<string, boolean>)?.[tc.expectedFlagKey];
      check(
        `${tc.label} flag ${tc.expectedFlagKey} = true`,
        true,
        flagValue
      );
    }
  }

  // ------------------------------------------------------------------
  // STEP 2: Dashboard review_needed_count
  // ------------------------------------------------------------------
  console.log("\n2. Dashboard summary validation\n");

  const { data: allInvoices } = await supabase
    .from("invoices")
    .select("data_quality_status")
    .eq("user_id", userId);

  const reviewNeededCount = (allInvoices ?? []).filter(
    (r) => r.data_quality_status && r.data_quality_status !== "ok"
  ).length;

  check("review_needed_count = 3", 3, reviewNeededCount);

  // ------------------------------------------------------------------
  // STEP 3: Chat context filtering
  // ------------------------------------------------------------------
  console.log("\n3. Chat context filtering validation\n");

  const { data: rawInvoices } = await supabase
    .from("invoices")
    .select("id, supplier_name, total_cop, due_date, payment_status, data_quality_status")
    .eq("user_id", userId);

  const incompleteCount = (rawInvoices ?? []).filter(
    (inv) => inv.data_quality_status === "incomplete"
  ).length;
  const suspectCount = (rawInvoices ?? []).filter(
    (inv) => inv.data_quality_status === "suspect"
  ).length;
  const pendingList = (rawInvoices ?? []).filter(
    (inv) => inv.data_quality_status !== "incomplete"
  );
  const warningCount = incompleteCount + suspectCount;

  check("incomplete excluded = 2", 2, incompleteCount);
  check("pending list length = 2 (good + suspect)", 2, pendingList.length);
  check("suspect in pending list", true, pendingList.some((inv) => inv.data_quality_status === "suspect"));
  check("warning_count = 3", 3, warningCount);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  const totalChecks = failures === 0 ? "all" : `${failures} failed`;
  console.log(
    `\n=== ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} (${totalChecks}) ===\n`
  );
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures > 0 ? 1 : 0);
  });
