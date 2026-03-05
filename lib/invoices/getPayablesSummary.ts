import "server-only";

import type { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type PayableInvoiceRow = {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  due_date: string | null;
  total_cop: number | null;
  payment_status: "unpaid" | "scheduled" | "paid";
};

type PayableType = "impuesto" | "servicio";

type TopPayableInvoice = {
  id: string;
  supplier_name: string;
  invoice_number: string | null;
  due_date: string | null;
  total_cop: number;
  type: PayableType;
};

function detectPayableType(params: {
  supplierName: string;
  invoiceNumber: string | null;
}): PayableType {
  const normalized = `${params.supplierName} ${params.invoiceNumber ?? ""}`.toLowerCase();

  const taxKeywords = [
    "dian",
    "impuesto",
    "iva",
    "retefuente",
    "retencion",
    "reteica",
    "ica",
    "reteiva",
  ];

  const matchedTaxKeyword = taxKeywords.some((keyword) => normalized.includes(keyword));
  return matchedTaxKeyword ? "impuesto" : "servicio";
}

function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAmount(value: number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return 0;
}

function buildDayRangeUtc(baseDateUtc: Date, daysAhead: number): { start: Date; end: Date } {
  const start = new Date(baseDateUtc);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + daysAhead);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

export function buildPayablesSummaryFromRows(rows: PayableInvoiceRow[], topLimit = 10) {
  const nowUtc = new Date();
  nowUtc.setUTCHours(0, 0, 0, 0);

  const next7Days = buildDayRangeUtc(nowUtc, 7);
  const next30Days = buildDayRangeUtc(nowUtc, 30);

  const normalizedRows = rows.map((row) => {
    const amount = normalizeAmount(row.total_cop);
    const parsedDueDate = typeof row.due_date === "string" ? parseIsoDate(row.due_date) : null;
    const supplierName = row.supplier_name?.trim() || "Proveedor sin nombre";
    const invoiceNumber = row.invoice_number?.trim() || null;
    const payableType = detectPayableType({
      supplierName,
      invoiceNumber,
    });

    return {
      id: row.id,
      supplier_name: supplierName,
      invoice_number: invoiceNumber,
      due_date: row.due_date,
      total_cop: amount,
      parsed_due_date: parsedDueDate,
      type: payableType,
    };
  });

  const overdueInvoices = normalizedRows.filter(
    (row) => row.parsed_due_date !== null && row.parsed_due_date < nowUtc,
  );

  const dueNext7Days = normalizedRows.filter(
    (row) => row.parsed_due_date !== null && row.parsed_due_date >= next7Days.start && row.parsed_due_date <= next7Days.end,
  );

  const dueNext30Days = normalizedRows.filter(
    (row) => row.parsed_due_date !== null && row.parsed_due_date >= next30Days.start && row.parsed_due_date <= next30Days.end,
  );

  const topUnpaidInvoices: TopPayableInvoice[] = normalizedRows
    .map(({ id, supplier_name, invoice_number, due_date, total_cop, type }) => ({
      id,
      supplier_name,
      invoice_number,
      due_date,
      total_cop,
      type,
    }))
    .slice(0, topLimit);

  const impuestoTotal = normalizedRows
    .filter((row) => row.type === "impuesto")
    .reduce((sum, row) => sum + row.total_cop, 0);

  const servicioTotal = normalizedRows
    .filter((row) => row.type === "servicio")
    .reduce((sum, row) => sum + row.total_cop, 0);

  return {
    top_limit: topLimit,
    unpaid_count: normalizedRows.length,
    unpaid_total: normalizedRows.reduce((sum, row) => sum + row.total_cop, 0),
    overdue_count: overdueInvoices.length,
    overdue_total: overdueInvoices.reduce((sum, row) => sum + row.total_cop, 0),
    due_next_7d_total: dueNext7Days.reduce((sum, row) => sum + row.total_cop, 0),
    due_next_30d_total: dueNext30Days.reduce((sum, row) => sum + row.total_cop, 0),
    by_type: {
      impuesto: impuestoTotal,
      servicio: servicioTotal,
    },
    top_unpaid_invoices: topUnpaidInvoices,
  };
}

export async function getPayablesSummary(params: {
  supabase: SupabaseClient;
  userId: string;
  topLimit?: number;
}) {
  const { supabase, userId, topLimit = 10 } = params;

  const { data, error } = await supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, due_date, total_cop, payment_status")
    .eq("user_id", userId)
    .eq("payment_status", "unpaid")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return {
      top_limit: topLimit,
      unpaid_count: 0,
      unpaid_total: 0,
      overdue_count: 0,
      overdue_total: 0,
      due_next_7d_total: 0,
      due_next_30d_total: 0,
      by_type: {
        impuesto: 0,
        servicio: 0,
      },
      top_unpaid_invoices: [] as TopPayableInvoice[],
      note: "No se pudo consultar cuentas por pagar.",
      error_code: "payables_query_error",
    };
  }

  const rows = (data ?? []) as PayableInvoiceRow[];
  return buildPayablesSummaryFromRows(rows, topLimit);
}
