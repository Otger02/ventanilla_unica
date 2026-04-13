import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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

// ─── Constants ───────────────────────────────────────────────────────────────

const SANDBOX_EMAIL = "sandbox-operadora-andina@example.com";
const SANDBOX_PASSWORD = "sandbox-2026-not-real";
const COMPANY_NAME = "Operadora Andina Digital SAS";
const COMPANY_NIT = "901234567";
const COMPANY_NIT_DV = "8";

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(42);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return rng() * (max - min) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtTimestamp(d: Date): string {
  return d.toISOString();
}

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

// ─── Supplier catalog ────────────────────────────────────────────────────────

type Supplier = {
  name: string;
  taxId: string;
  prefix: string;
  minAmount: number;
  maxAmount: number;
  hasIva: boolean;
  monthlyFreq: number;
  portalUrl?: string;
};

const SUPPLIERS: Supplier[] = [
  { name: "CloudCol SAS", taxId: "900111222-1", prefix: "CC", minAmount: 800_000, maxAmount: 3_000_000, hasIva: true, monthlyFreq: 3, portalUrl: "https://portal.cloudcol.co/pagos" },
  { name: "Fibra Digital Colombia SAS", taxId: "900222333-4", prefix: "FDC", minAmount: 100_000, maxAmount: 300_000, hasIva: true, monthlyFreq: 5 },
  { name: "HerramientasDev SAS", taxId: "900333444-7", prefix: "HD", minAmount: 200_000, maxAmount: 1_000_000, hasIva: true, monthlyFreq: 4, portalUrl: "https://herramientasdev.co/facturacion" },
  { name: "Contaplus Asesores SAS", taxId: "800444555-2", prefix: "CPA", minAmount: 1_000_000, maxAmount: 3_000_000, hasIva: true, monthlyFreq: 1 },
  { name: "Bufete Jurídico Andino SAS", taxId: "800555666-9", prefix: "BJA", minAmount: 500_000, maxAmount: 5_000_000, hasIva: true, monthlyFreq: 1 },
  { name: "Espacio Cowork Bogotá SAS", taxId: "901666777-3", prefix: "ECB", minAmount: 500_000, maxAmount: 2_000_000, hasIva: true, monthlyFreq: 2 },
  { name: "Agencia Pixel Norte SAS", taxId: "901777888-6", prefix: "APN", minAmount: 300_000, maxAmount: 2_000_000, hasIva: true, monthlyFreq: 3 },
  { name: "MensaExpress Ltda", taxId: "800888999-5", prefix: "MEX", minAmount: 50_000, maxAmount: 200_000, hasIva: true, monthlyFreq: 8 },
  { name: "Suministros y Logística del Valle", taxId: "900999000-8", prefix: "SLV", minAmount: 200_000, maxAmount: 800_000, hasIva: true, monthlyFreq: 5 },
  { name: "Papelería y Miscelánea El Punto", taxId: "12345678-9", prefix: "PEP", minAmount: 20_000, maxAmount: 150_000, hasIva: false, monthlyFreq: 10 },
  { name: "Carlos Vargas Consultoría", taxId: "98765432-1", prefix: "CVC", minAmount: 500_000, maxAmount: 3_000_000, hasIva: false, monthlyFreq: 2 },
  { name: "DataSync Tools Inc", taxId: "EXT-00001", prefix: "DST", minAmount: 150_000, maxAmount: 800_000, hasIva: false, monthlyFreq: 6 },
];

// ─── Generate raw invoices with monthly cycles ──────────────────────────────

type RawInvoice = {
  supplier: Supplier;
  issueDate: Date;
  seqNum: number;
};

function generateRawInvoices(): RawInvoice[] {
  const invoices: RawInvoice[] = [];
  const MONTHS = 5; // dec 2025 – apr 2026

  for (const supplier of SUPPLIERS) {
    // Base date: early Dec 2025 + random offset per supplier
    const baseDate = addDays(new Date(2025, 11, 1), randInt(0, 15));
    let seq = 1;

    for (let month = 0; month < MONTHS; month++) {
      for (let f = 0; f < supplier.monthlyFreq; f++) {
        const dayOffset = month * 30 + f * Math.floor(30 / supplier.monthlyFreq);
        const jitter = randInt(-3, 3);
        const issueDate = addDays(baseDate, dayOffset + jitter);

        // Only generate if issue_date is before today + 5 days
        if (issueDate <= addDays(TODAY, 5)) {
          invoices.push({ supplier, issueDate, seqNum: seq++ });
        }
      }
    }
  }

  return invoices;
}

// ─── Bucket assignment types ────────────────────────────────────────────────

type Bucket = "incomplete" | "suspect" | "ok_unpaid" | "paid" | "scheduled";

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Sandbox Seed: Operadora Andina Digital SAS ===\n");

  // ── Step 0: Reset existing sandbox ──
  console.log("Step 0: Checking for existing sandbox...");
  const { data: userList } = await supabase.auth.admin.listUsers();
  const existingUser = userList?.users.find((u) => u.email === SANDBOX_EMAIL);
  if (existingUser) {
    console.log("  Found existing sandbox, cleaning up...");
    for (const table of ["invoice_activity_log", "invoice_receipts", "invoice_files", "invoices", "profiles"]) {
      await supabase.from(table).delete().eq("user_id", existingUser.id);
    }
    await supabase.auth.admin.deleteUser(existingUser.id);
    console.log("  Cleanup done.");
  }

  // ── Step 1: Create auth user ──
  console.log("Step 1: Creating auth user...");
  const { error: createErr } = await supabase.auth.admin.createUser({
    email: SANDBOX_EMAIL,
    password: SANDBOX_PASSWORD,
    email_confirm: true,
    user_metadata: { sandbox: true },
  });
  if (createErr) {
    console.error("Error creating user:", createErr.message);
    process.exit(1);
  }

  const { data: freshList } = await supabase.auth.admin.listUsers();
  const sandboxUser = freshList?.users.find((u) => u.email === SANDBOX_EMAIL);
  if (!sandboxUser) {
    console.error("Could not find created sandbox user");
    process.exit(1);
  }
  const userId = sandboxUser.id;
  console.log(`  User: ${SANDBOX_EMAIL} (${userId})`);

  // ── Step 2: Create profile ──
  console.log("Step 2: Creating profile...");
  // Try full profile with extension columns; fall back to base if migration wasn't run
  const fullProfile = {
    user_id: userId,
    nit: COMPANY_NIT,
    nit_dv: COMPANY_NIT_DV,
    nombre_razon_social: COMPANY_NAME,
    responsable_de_iva: true,
    impuesto_sobre_la_renta: true,
    retencion_en_la_fuente: true,
    autorretenedor: false,
    regimen_simple: false,
    gran_contribuyente: false,
    responsabilidades_raw: ["O-13", "O-15", "O-23", "O-47"],
    actividad_economica: "6201",
    tipo_entidad: "SAS",
    es_esal: false,
  };
  const baseProfile = {
    user_id: userId,
    nit: COMPANY_NIT,
    nombre_razon_social: COMPANY_NAME,
    responsable_de_iva: true,
    impuesto_sobre_la_renta: true,
    retencion_en_la_fuente: true,
    autorretenedor: false,
    regimen_simple: false,
    gran_contribuyente: false,
    responsabilidades_raw: ["O-13", "O-15", "O-23", "O-47"],
  };

  const { error: profileErr } = await supabase.from("profiles").insert(fullProfile);
  if (profileErr) {
    if (profileErr.message.includes("column") && profileErr.message.includes("schema cache")) {
      console.log("  Extension columns not in DB, using base profile...");
      const { error: baseErr } = await supabase.from("profiles").insert(baseProfile);
      if (baseErr) {
        console.error("Error creating base profile:", baseErr.message);
        process.exit(1);
      }
    } else {
      console.error("Error creating profile:", profileErr.message);
      process.exit(1);
    }
  }

  // ── Step 3: Generate invoices ──
  console.log("Step 3: Generating invoices...");
  const rawInvoices = generateRawInvoices();
  const total = rawInvoices.length;
  console.log(`  Generated ${total} raw invoices from supplier cycles.`);

  // Assign buckets
  const incompleteCount = Math.round(total * 0.40);
  const suspectCount = Math.round(total * 0.25);
  const paidCount = Math.round(total * 0.125);
  const scheduledCount = Math.round(total * 0.10);
  const okUnpaidCount = total - incompleteCount - suspectCount - paidCount - scheduledCount;

  const buckets: Bucket[] = [
    ...Array(incompleteCount).fill("incomplete" as Bucket),
    ...Array(suspectCount).fill("suspect" as Bucket),
    ...Array(okUnpaidCount).fill("ok_unpaid" as Bucket),
    ...Array(paidCount).fill("paid" as Bucket),
    ...Array(scheduledCount).fill("scheduled" as Bucket),
  ];
  shuffle(buckets);

  // Build invoice rows
  type InvoiceRow = Record<string, unknown>;
  type ReceiptDecision = { index: number; invoiceNumber: string };

  const invoiceRows: InvoiceRow[] = [];
  const receiptDecisions: ReceiptDecision[] = [];
  let receiptCounter = 0;

  // Counters for summary
  const counts = {
    quality: { ok: 0, suspect: 0, incomplete: 0 },
    payment: { unpaid: 0, scheduled: 0, paid: 0 },
    vat: { iva_usable: 0, iva_en_revision: 0, iva_no_usable: 0, sin_iva: 0 },
    receipts: 0,
    overdue: 0,
    dueSoon: 0,
  };

  for (let i = 0; i < total; i++) {
    const raw = rawInvoices[i];
    const bucket = buckets[i];
    const sup = raw.supplier;

    // ── Amounts ──
    let subtotal = Math.round(randInt(sup.minAmount, sup.maxAmount) / 1000) * 1000;
    let iva = sup.hasIva ? Math.round(subtotal * 0.19) : 0;
    let totalCop: number | null = subtotal + iva;

    // ── Dates ──
    const issueDate = raw.issueDate;
    let dueDate: Date | null = addDays(issueDate, randInt(15, 45));
    const extractedAt = addDays(issueDate, randInt(0, 3));

    // ── Invoice number ──
    const invoiceNumber = `${sup.prefix}-${fmtDate(issueDate).slice(0, 7).replace("-", "")}-${String(raw.seqNum).padStart(4, "0")}`;

    // ── Confidence & corruption ──
    let confidence: number | null = randFloat(0.75, 0.99);
    let supplierName: string | null = sup.name;
    let supplierTaxId: string | null = sup.taxId;

    switch (bucket) {
      case "suspect": {
        if (rng() < 0.5) {
          // Low confidence
          confidence = randFloat(0.40, 0.69);
        } else {
          // Amount mismatch (>5%)
          const mismatch = randInt(Math.ceil(totalCop * 0.06), Math.ceil(totalCop * 0.20));
          totalCop = subtotal + iva + mismatch;
        }
        break;
      }
      case "incomplete": {
        const subType = rng();
        if (subType < 0.33) {
          supplierName = null;
          supplierTaxId = null;
        } else if (subType < 0.66) {
          dueDate = null;
        } else {
          // null or 0 guarantees computeDataQuality → "incomplete"
          totalCop = rng() < 0.5 ? null : 0;
        }
        break;
      }
      // ok_unpaid, paid, scheduled: no corruption
    }

    // ── Compute data quality (pure function) ──
    const qualityResult = computeDataQuality({
      confidence,
      supplier_name: supplierName,
      due_date: dueDate ? fmtDate(dueDate) : null,
      total_cop: totalCop,
      subtotal_cop: subtotal,
      iva_cop: iva,
    });

    counts.quality[qualityResult.status]++;

    // ── Payment status ──
    let paymentStatus: "unpaid" | "scheduled" | "paid" = "unpaid";
    let invoiceStatus: "pending" | "scheduled" | "paid" = "pending";
    let paidAt: Date | null = null;
    let scheduledPaymentDate: Date | null = null;
    let paymentMethod: string | null = null;
    let paymentNotes: string | null = null;
    let lastPaymentOpenedAt: Date | null = null;

    if (bucket === "paid") {
      paymentStatus = "paid";
      invoiceStatus = "paid";
      const payBase = dueDate ?? addDays(issueDate, 30);
      paidAt = addDays(payBase, randInt(-5, 10));
      paymentMethod = pick(["transfer", "transfer", "transfer", "pse", "pse", "cash", "other"]);
      scheduledPaymentDate = addDays(paidAt, -randInt(1, 7));
      lastPaymentOpenedAt = addDays(paidAt, -randInt(0, 3));
      if (rng() < 0.5) {
        paymentNotes = pick([
          "Pago quincenal proveedores",
          "Transferencia Bancolombia ref automatica",
          "PSE exitoso",
          "Pago anticipado por descuento",
          "Consignación directa",
        ]);
      }
    } else if (bucket === "scheduled") {
      paymentStatus = "scheduled";
      invoiceStatus = "scheduled";
      // Spread scheduled dates: some tomorrow, some near, some further
      if (rng() < 0.15) {
        scheduledPaymentDate = addDays(TODAY, 1); // tomorrow!
      } else {
        scheduledPaymentDate = addDays(TODAY, randInt(2, 30));
      }
      if (rng() < 0.3) {
        lastPaymentOpenedAt = addDays(extractedAt, randInt(1, 10));
      }
    }

    counts.payment[paymentStatus]++;

    // ── Receipt decision (30% of paid → keep iva_usable low) ──
    let hasReceipt = false;
    if (bucket === "paid") {
      hasReceipt = rng() < 0.30;
      if (hasReceipt) {
        receiptDecisions.push({ index: i, invoiceNumber });
        receiptCounter++;
      }
    }
    const receiptsCount = hasReceipt ? 1 : 0;
    counts.receipts += receiptsCount;

    // ── Compute VAT status (pure function) ──
    const vatResult = computeVatStatus({
      iva_cop: iva,
      payment_status: paymentStatus,
      receipts_count: receiptsCount,
      data_quality_status: qualityResult.status,
    });

    counts.vat[vatResult.vat_status]++;

    // ── Overdue / due soon tracking ──
    if (paymentStatus === "unpaid" && dueDate) {
      if (dueDate < TODAY) counts.overdue++;
      const in3d = addDays(TODAY, 3);
      if (dueDate >= TODAY && dueDate <= in3d) counts.dueSoon++;
    }

    // ── Payment URL / portal URL ──
    let paymentUrl: string | null = null;
    let supplierPortalUrl: string | null = null;
    if (sup.portalUrl && rng() < 0.30) supplierPortalUrl = sup.portalUrl;
    if (rng() < 0.15) paymentUrl = `https://pse.ejemplo.co/pago/${invoiceNumber}`;

    // ── Extraction metadata ──
    const extractionRaw = {
      status: "processed",
      extracted_fields: {
        supplier_name: supplierName ?? "",
        total_cop: totalCop ?? 0,
        due_date: dueDate ? fmtDate(dueDate) : "",
        expense_type: pick(["servicios", "tecnologia", "marketing", "otro", "arriendo"]),
        summary: `Factura ${invoiceNumber} de ${supplierName ?? "proveedor desconocido"}.`,
        confidence: confidence ?? 0,
      },
      confidence: { overall: confidence ?? 0 },
    };

    invoiceRows.push({
      user_id: userId,
      supplier_name: supplierName,
      supplier_tax_id: supplierTaxId,
      invoice_number: invoiceNumber,
      issue_date: fmtDate(issueDate),
      due_date: dueDate ? fmtDate(dueDate) : null,
      subtotal_cop: subtotal,
      iva_cop: iva,
      total_cop: totalCop,
      currency: "COP",
      source: "upload",
      status: invoiceStatus,
      payment_status: paymentStatus,
      scheduled_payment_date: scheduledPaymentDate ? fmtDate(scheduledPaymentDate) : null,
      paid_at: paidAt ? fmtTimestamp(paidAt) : null,
      payment_method: paymentMethod,
      payment_notes: paymentNotes,
      payment_url: paymentUrl,
      supplier_portal_url: supplierPortalUrl,
      last_payment_opened_at: lastPaymentOpenedAt ? fmtTimestamp(lastPaymentOpenedAt) : null,
      extracted_at: fmtTimestamp(extractedAt),
      extraction_confidence: { overall: confidence ?? 0 },
      extraction_raw: extractionRaw,
      data_quality_status: qualityResult.status,
      data_quality_flags: qualityResult.flags,
      vat_status: vatResult.vat_status,
      vat_reason: vatResult.vat_reason,
      vat_amount_usable_cop: vatResult.vat_amount_usable_cop,
      vat_amount_review_cop: vatResult.vat_amount_review_cop,
      vat_amount_blocked_cop: vatResult.vat_amount_blocked_cop,
    });
  }

  // ── Step 4: Batch-insert invoices ──
  console.log("Step 4: Inserting invoices...");
  const BATCH = 100;
  const insertedIds: string[] = [];

  for (let offset = 0; offset < invoiceRows.length; offset += BATCH) {
    const batch = invoiceRows.slice(offset, offset + BATCH);
    const { data, error } = await supabase
      .from("invoices")
      .insert(batch)
      .select("id");
    if (error) {
      console.error(`Error inserting invoices batch at offset ${offset}:`, error.message);
      process.exit(1);
    }
    for (const row of data ?? []) {
      insertedIds.push(row.id);
    }
  }
  console.log(`  Inserted ${insertedIds.length} invoices.`);

  // ── Step 5: Insert receipts ──
  console.log("Step 5: Inserting receipts...");
  const receiptRows = receiptDecisions.map((rd) => {
    const invoiceId = insertedIds[rd.index];
    return {
      user_id: userId,
      invoice_id: invoiceId,
      sha256: createHash("sha256").update(`sandbox-receipt-${invoiceId}`).digest("hex"),
      storage_path: `invoice_receipts/${userId}/${invoiceId}/comprobante.pdf`,
      original_filename: `comprobante_pago_${rd.invoiceNumber}.pdf`,
    };
  });

  if (receiptRows.length > 0) {
    const { error: receiptErr } = await supabase.from("invoice_receipts").insert(receiptRows);
    if (receiptErr) {
      console.error("Error inserting receipts:", receiptErr.message);
      process.exit(1);
    }
  }
  console.log(`  Inserted ${receiptRows.length} receipts.`);

  // ── Step 6: Insert activity log ──
  console.log("Step 6: Inserting activity log...");
  type ActivityRow = {
    invoice_id: string;
    user_id: string;
    activity: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };

  const activityRows: ActivityRow[] = [];
  const receiptIndexSet = new Set(receiptDecisions.map((rd) => rd.index));

  for (let i = 0; i < total; i++) {
    const raw = rawInvoices[i];
    const bucket = buckets[i];
    const invoiceId = insertedIds[i];
    const extractedAt = addDays(raw.issueDate, randInt(0, 3));

    // All invoices: uploaded + processed
    activityRows.push({
      invoice_id: invoiceId,
      user_id: userId,
      activity: "uploaded",
      metadata: {},
      created_at: fmtTimestamp(addDays(extractedAt, 0)), // same-ish as extracted
    });

    activityRows.push({
      invoice_id: invoiceId,
      user_id: userId,
      activity: "processed",
      metadata: {},
      created_at: fmtTimestamp(new Date(extractedAt.getTime() + 60_000)), // +1 min
    });

    // Scheduled invoices
    if (bucket === "scheduled") {
      activityRows.push({
        invoice_id: invoiceId,
        user_id: userId,
        activity: "scheduled",
        metadata: {},
        created_at: fmtTimestamp(addDays(extractedAt, randInt(1, 5))),
      });
    }

    // Paid invoices
    if (bucket === "paid") {
      activityRows.push({
        invoice_id: invoiceId,
        user_id: userId,
        activity: "scheduled",
        metadata: {},
        created_at: fmtTimestamp(addDays(extractedAt, randInt(1, 5))),
      });

      const paidAt = invoiceRows[i].paid_at as string;
      activityRows.push({
        invoice_id: invoiceId,
        user_id: userId,
        activity: "marked_paid",
        metadata: { method: invoiceRows[i].payment_method },
        created_at: paidAt,
      });
    }

    // Receipt uploaded
    if (receiptIndexSet.has(i)) {
      const paidAt = new Date(invoiceRows[i].paid_at as string);
      activityRows.push({
        invoice_id: invoiceId,
        user_id: userId,
        activity: "receipt_uploaded",
        metadata: {},
        created_at: fmtTimestamp(addDays(paidAt, randInt(0, 2))),
      });
    }

    // ~10% manually edited
    if (rng() < 0.10) {
      activityRows.push({
        invoice_id: invoiceId,
        user_id: userId,
        activity: "manually_edited",
        metadata: { field: pick(["supplier_name", "total_cop", "due_date"]), reason: "Corrección OCR" },
        created_at: fmtTimestamp(addDays(extractedAt, randInt(1, 10))),
      });
    }
  }

  // Batch insert activity log
  for (let offset = 0; offset < activityRows.length; offset += BATCH) {
    const batch = activityRows.slice(offset, offset + BATCH);
    const { error } = await supabase.from("invoice_activity_log").insert(batch);
    if (error) {
      console.error(`Error inserting activity batch at offset ${offset}:`, error.message);
      process.exit(1);
    }
  }
  console.log(`  Inserted ${activityRows.length} activity log entries.`);

  // ── Summary ──
  console.log(`
=== Sandbox Company Seeded ===
User:    ${SANDBOX_EMAIL} (${userId})
Company: ${COMPANY_NAME} (NIT ${COMPANY_NIT}-${COMPANY_NIT_DV})

Invoices:            ${total}
Quality:
  ok:                ${counts.quality.ok}  (${pct(counts.quality.ok, total)})
  suspect:           ${counts.quality.suspect}  (${pct(counts.quality.suspect, total)})
  incomplete:        ${counts.quality.incomplete}  (${pct(counts.quality.incomplete, total)})
VAT:
  iva_usable:        ${counts.vat.iva_usable}
  iva_en_revision:   ${counts.vat.iva_en_revision}
  iva_no_usable:     ${counts.vat.iva_no_usable}
  sin_iva:           ${counts.vat.sin_iva}
Payment:
  unpaid:            ${counts.payment.unpaid}
  scheduled:         ${counts.payment.scheduled}
  paid:              ${counts.payment.paid}
Receipts:            ${counts.receipts}
Activity log:        ${activityRows.length}

Alerts expected:
  overdue:           ~${counts.overdue}
  due_soon:          ~${counts.dueSoon}
  quality:           ~${counts.quality.suspect + counts.quality.incomplete}
  no_receipt:        ~${counts.payment.paid - counts.receipts}
  vat_review:        ~${counts.vat.iva_en_revision}
  vat_blocked:       ~${counts.vat.iva_no_usable}
`);
}

function pct(n: number, total: number): string {
  return `${Math.round((n / total) * 100)}%`;
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
