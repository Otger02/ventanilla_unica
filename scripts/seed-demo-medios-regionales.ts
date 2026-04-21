import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Load .env.local before anything else
dotenv.config({ path: ".env.local" });

// ─── Env validation ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMO_EMAIL = "otger.hellgames@gmail.com";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Seed: Demo Medios Regionales S.A.S. ===\n");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // JS months are 0-indexed

  // ── Pre-flight: wipe existing demo data for this account (keep the auth user) ─
  console.log("Pre-flight: Checking for existing demo data...");
  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("❌ Failed to list users:", listErr.message);
    process.exit(1);
  }
  const existing = userList?.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) {
    console.log(`  Found user ${DEMO_EMAIL} — wiping demo data...`);
    const tables = [
      "user_operating_preferences",
      "readiness_snapshots",
      "monthly_tax_inputs_co",
      "user_tax_profile_co",
      "invoices",
      "profiles",
    ];
    for (const table of tables) {
      await supabase.from(table).delete().eq("user_id", existing.id);
    }
    console.log("  Cleanup done.");
  }

  // ── STEP 1: Resolve auth user (must already exist) ───────────────────────────
  console.log("\nStep 1: Resolving auth user...");
  const demoUser = userList?.users.find((u) => u.email === DEMO_EMAIL);
  if (!demoUser) {
    console.error(`❌ Step 1 failed: no auth user found for ${DEMO_EMAIL}`);
    console.error("   Create the account first (sign-up or dashboard), then re-run.");
    process.exit(1);
  }

  const DEMO_USER_ID = demoUser.id;
  console.log(`  ✓ User found: ${DEMO_EMAIL} (${DEMO_USER_ID.slice(0, 8)}...)`);

  // ── STEP 2: RUT profile ──────────────────────────────────────────────────────
  // Note: profiles table uses "nombre_razon_social", not "razon_social"
  console.log("\nStep 2: Inserting profile (RUT)...");
  const { error: profileErr } = await supabase.from("profiles").insert({
    user_id: DEMO_USER_ID,
    nit: "9012345678",
    nombre_razon_social: "MEDIOS REGIONALES S.A.S.",
    impuesto_sobre_la_renta: true,
    retencion_en_la_fuente: true,
    autorretenedor: false,
    responsable_de_iva: true,
    regimen_simple: false,
    gran_contribuyente: false,
  });
  if (profileErr) {
    console.error("❌ Step 2 failed:", profileErr.message);
    process.exit(1);
  }
  console.log("  ✓ Profile inserted.");

  // ── STEP 3: Tax profile ──────────────────────────────────────────────────────
  console.log("\nStep 3: Inserting tax profile...");
  const { error: taxProfileErr } = await supabase.from("user_tax_profile_co").insert({
    user_id: DEMO_USER_ID,
    persona_type: "juridica",
    taxpayer_type: "juridica",
    regimen: "ordinario",
    vat_responsible: "yes",
    vat_periodicity: "bimestral",
    monthly_fixed_costs_cop: 8000000,
    monthly_payroll_cop: 12000000,
    monthly_debt_payments_cop: 3500000,
    provision_style: "balanced",
    municipality: "Bogotá D.C.",
  });
  if (taxProfileErr) {
    console.error("❌ Step 3 failed:", taxProfileErr.message);
    process.exit(1);
  }
  console.log("  ✓ Tax profile inserted.");

  // ── STEP 4: Monthly tax input ────────────────────────────────────────────────
  console.log(`\nStep 4: Inserting monthly tax input (${currentYear}-${currentMonth})...`);
  const { error: taxInputErr } = await supabase.from("monthly_tax_inputs_co").insert({
    user_id: DEMO_USER_ID,
    year: currentYear,
    month: currentMonth,
    income_cop: 45000000,
    deductible_expenses_cop: 18000000,
    withholdings_cop: 2200000,
    vat_collected_cop: 8550000,
  });
  if (taxInputErr) {
    console.error("❌ Step 4 failed:", taxInputErr.message);
    process.exit(1);
  }
  console.log("  ✓ Monthly tax input inserted.");

  // ── STEP 5: Invoices ─────────────────────────────────────────────────────────
  console.log("\nStep 5: Inserting invoices...");

  const invoices = [
    // Invoice 1 — VENCIDA, urgente
    {
      user_id: DEMO_USER_ID,
      supplier_name: "Tecnología Broadcast Ltda.",
      invoice_number: "FV-2024-0892",
      total_cop: 4760000,
      subtotal_cop: 4000000,
      iva_cop: 760000,
      due_date: fmtDate(addDays(today, -12)),
      payment_status: "unpaid",
      data_quality_status: "ok",
      vat_status: "iva_en_revision",
    },
    // Invoice 2 — VENCIDA, segundo en prioridad
    {
      user_id: DEMO_USER_ID,
      supplier_name: "Inmobiliaria Estudio Centro S.A.",
      invoice_number: "AR-2024-0341",
      total_cop: 6500000,
      subtotal_cop: 6500000,
      iva_cop: 0,
      due_date: fmtDate(addDays(today, -5)),
      payment_status: "unpaid",
      data_quality_status: "ok",
      vat_status: "sin_iva",
    },
    // Invoice 3 — PRÓXIMA, vence en 4 días
    {
      user_id: DEMO_USER_ID,
      supplier_name: "Contenidos Digitales del Caribe S.A.S.",
      invoice_number: "FE-2024-1103",
      total_cop: 2856000,
      subtotal_cop: 2400000,
      iva_cop: 456000,
      due_date: fmtDate(addDays(today, 4)),
      payment_status: "unpaid",
      data_quality_status: "ok",
      vat_status: "iva_en_revision",
    },
    // Invoice 4 — PAGADA sin comprobante
    {
      user_id: DEMO_USER_ID,
      supplier_name: "Servicios Gráficos Andinos S.A.S.",
      invoice_number: "FV-2024-0778",
      total_cop: 1190000,
      subtotal_cop: 1000000,
      iva_cop: 190000,
      due_date: fmtDate(addDays(today, -20)),
      payment_status: "paid",
      data_quality_status: "ok",
      vat_status: "iva_en_revision",
    },
    // Invoice 5 — INCOMPLETA, datos faltantes
    {
      user_id: DEMO_USER_ID,
      supplier_name: "Producciones XYZ",
      invoice_number: null,
      total_cop: 3500000,
      subtotal_cop: null,
      iva_cop: null,
      due_date: null,
      payment_status: "unpaid",
      data_quality_status: "incomplete",
      vat_status: "iva_no_usable",
    },
  ];

  const { data: invoiceData, error: invoiceErr } = await supabase
    .from("invoices")
    .insert(invoices)
    .select("id");
  if (invoiceErr) {
    console.error("❌ Step 5 failed:", invoiceErr.message);
    process.exit(1);
  }
  console.log(`  ✓ Inserted ${invoiceData?.length ?? 0} invoices.`);

  // ── STEP 6: Readiness snapshots ──────────────────────────────────────────────
  // Note: table requires healthy_count, warning_count, critical_count (not null)
  // Using plausible values that are consistent with the portfolio_score
  console.log("\nStep 6: Inserting readiness snapshots...");
  const snapshots = [
    {
      user_id: DEMO_USER_ID,
      portfolio_score: 58,
      healthy_count: 1,
      warning_count: 2,
      critical_count: 2,
      created_at: addDays(today, -7).toISOString(),
    },
    {
      user_id: DEMO_USER_ID,
      portfolio_score: 52,
      healthy_count: 1,
      warning_count: 1,
      critical_count: 3,
      created_at: addDays(today, -14).toISOString(),
    },
  ];

  const { data: snapshotData, error: snapshotErr } = await supabase
    .from("readiness_snapshots")
    .insert(snapshots)
    .select("id");
  if (snapshotErr) {
    console.error("❌ Step 6 failed:", snapshotErr.message);
    process.exit(1);
  }
  console.log(`  ✓ Inserted ${snapshotData?.length ?? 0} snapshots (delta: -6 → negative trend).`);

  // ── STEP 7: Operating preferences ───────────────────────────────────────────
  // Note: preferred_weekly_focus check constraint allows only: 'cash', 'compliance', 'cleanup'
  // 'pagos_urgentes' is not valid per DB constraint — using 'cash' (closest semantic match)
  console.log("\nStep 7: Inserting operating preferences...");
  const { error: prefsErr } = await supabase.from("user_operating_preferences").insert({
    user_id: DEMO_USER_ID,
    preferred_action_style: "balanced",
    preferred_weekly_focus: "cash", // 'pagos_urgentes' is not a valid enum value; 'cash' is the closest
    preferred_view_mode: "owner",
  });
  if (prefsErr) {
    console.error("❌ Step 7 failed:", prefsErr.message);
    process.exit(1);
  }
  console.log("  ✓ Operating preferences inserted.");

  // ── STEP 8: Verify and report ────────────────────────────────────────────────
  console.log("\nStep 8: Verifying inserts...");

  const [
    { data: profileCheck },
    { data: taxProfileCheck },
    { data: taxInputCheck },
    { data: invoiceCheck },
    { data: snapshotCheck },
    { data: prefsCheck },
  ] = await Promise.all([
    supabase.from("profiles").select("user_id").eq("user_id", DEMO_USER_ID).maybeSingle(),
    supabase.from("user_tax_profile_co").select("user_id").eq("user_id", DEMO_USER_ID).maybeSingle(),
    supabase.from("monthly_tax_inputs_co").select("id").eq("user_id", DEMO_USER_ID).maybeSingle(),
    supabase.from("invoices").select("id").eq("user_id", DEMO_USER_ID),
    supabase.from("readiness_snapshots").select("id").eq("user_id", DEMO_USER_ID),
    supabase.from("user_operating_preferences").select("user_id").eq("user_id", DEMO_USER_ID).maybeSingle(),
  ]);

  console.log(`
=== Verification Report ===
  Auth user found:        yes  (${DEMO_USER_ID.slice(0, 8)}...)
  Profile inserted:       ${profileCheck ? "yes" : "NO ❌"}
  Tax profile inserted:   ${taxProfileCheck ? "yes" : "NO ❌"}
  Monthly input inserted: ${taxInputCheck ? "yes" : "NO ❌"}
  Invoices inserted:      ${invoiceCheck?.length ?? 0}  (expect 5)
  Snapshots inserted:     ${snapshotCheck?.length ?? 0}  (expect 2)
  Preferences inserted:   ${prefsCheck ? "yes" : "NO ❌"}
`);

  console.log("Demo account ready.");
  console.log(`Email:    ${DEMO_EMAIL}`);
  console.log("Login at: /login");
  console.log();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
