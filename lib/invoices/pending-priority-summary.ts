import "server-only";

import type { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type InvoicePendingRow = {
  id: string;
  supplier_name: string | null;
  total_cop: number | null;
  due_date: string | null;
  status: "pending" | "scheduled" | "paid" | "disputed";
};

type PendingInvoiceItem = {
  id: string;
  supplier_name: string;
  total_cop: number;
  due_date: string | null;
  days_to_due: number | null;
  overdue: boolean;
  status: "pending" | "scheduled";
};

type WeeklyTotalItem = {
  week_start: string;
  week_end: string;
  invoice_count: number;
  total_cop: number;
};

function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getStartOfWeekUtc(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diffToMonday);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function getDaysFromTodayUtc(dueDate: Date, nowUtc: Date): number {
  const due = new Date(dueDate);
  due.setUTCHours(0, 0, 0, 0);
  const current = new Date(nowUtc);
  current.setUTCHours(0, 0, 0, 0);

  const diffMs = due.getTime() - current.getTime();
  return Math.floor(diffMs / 86_400_000);
}

export async function getPendingInvoicesPrioritySummary(params: {
  supabase: SupabaseClient;
  userId: string;
  topLimit?: number;
}) {
  const { supabase, userId, topLimit = 7 } = params;

  const { data, error } = await supabase
    .from("invoices")
    .select("id, supplier_name, total_cop, due_date, status")
    .eq("user_id", userId)
    .in("status", ["pending", "scheduled"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    return {
      top_limit: topLimit,
      pending_total_cop: 0,
      pending_count: 0,
      overdue_count: 0,
      overdue_total_cop: 0,
      weekly_totals: [] as WeeklyTotalItem[],
      top_pending_invoices: [] as PendingInvoiceItem[],
      overdue_invoices: [] as PendingInvoiceItem[],
      note: "No se pudo consultar facturas pendientes.",
      error_code: "invoices_query_error",
    };
  }

  const rows = (data ?? []) as InvoicePendingRow[];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const normalized = rows.map((row) => {
    const normalizedTotal = typeof row.total_cop === "number" && Number.isFinite(row.total_cop) ? row.total_cop : 0;
    const dueDate = typeof row.due_date === "string" ? parseIsoDate(row.due_date) : null;
    const daysToDue = dueDate ? getDaysFromTodayUtc(dueDate, today) : null;
    const overdue = typeof daysToDue === "number" ? daysToDue < 0 : false;

    return {
      id: row.id,
      supplier_name: row.supplier_name?.trim() || "Proveedor sin nombre",
      total_cop: normalizedTotal,
      due_date: row.due_date,
      days_to_due: daysToDue,
      overdue,
      status: row.status === "scheduled" ? "scheduled" : "pending",
    } satisfies PendingInvoiceItem;
  });

  const pendingTotalCop = normalized.reduce((sum, item) => sum + item.total_cop, 0);

  const overdueInvoices = normalized
    .filter((item) => item.overdue)
    .sort((left, right) => {
      if (left.due_date && right.due_date) {
        return left.due_date.localeCompare(right.due_date);
      }

      if (left.due_date) {
        return -1;
      }

      if (right.due_date) {
        return 1;
      }

      return 0;
    });

  const weeklyTotalsMap = new Map<string, WeeklyTotalItem>();

  for (const invoice of normalized) {
    if (!invoice.due_date) {
      continue;
    }

    const parsedDueDate = parseIsoDate(invoice.due_date);
    if (!parsedDueDate) {
      continue;
    }

    const weekStart = getStartOfWeekUtc(parsedDueDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    const key = toIsoDate(weekStart);
    const existing = weeklyTotalsMap.get(key);

    if (existing) {
      existing.invoice_count += 1;
      existing.total_cop += invoice.total_cop;
      continue;
    }

    weeklyTotalsMap.set(key, {
      week_start: toIsoDate(weekStart),
      week_end: toIsoDate(weekEnd),
      invoice_count: 1,
      total_cop: invoice.total_cop,
    });
  }

  const weeklyTotals = [...weeklyTotalsMap.values()].sort((left, right) =>
    left.week_start.localeCompare(right.week_start),
  );

  return {
    top_limit: topLimit,
    pending_total_cop: pendingTotalCop,
    pending_count: normalized.length,
    overdue_count: overdueInvoices.length,
    overdue_total_cop: overdueInvoices.reduce((sum, item) => sum + item.total_cop, 0),
    weekly_totals: weeklyTotals,
    top_pending_invoices: normalized.slice(0, topLimit),
    overdue_invoices: overdueInvoices.slice(0, topLimit),
  };
}
