import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { getReviewQueue, type ReviewQueueItem } from "@/lib/invoices/getReviewQueue";
import { getReceiptsCounts } from "@/lib/invoices/getReceiptsCounts";
import { buildPaymentPlan, type WeeklyPaymentPlan } from "@/lib/invoices/getPaymentPlan";
import { computePortfolioReadiness, type PortfolioReadiness } from "@/lib/invoices/computeReadinessScore";
import { computeWeeklyGoals, type WeeklyGoalsSummary } from "@/lib/invoices/getWeeklyGoals";
import { computeInactionScenarios, type InactionSummary } from "@/lib/invoices/getInactionScenarios";
import { getTopPriorityActions } from "@/lib/invoices/review-queue-core";
import {
  applyPreferencesToActions,
  applyPreferencesToGoals,
  DEFAULT_PREFERENCES,
  type OperatingPreferences,
} from "@/lib/invoices/applyOperatingPreferences";
import type { OperationalNote } from "@/lib/notes/types";

// ─── Types ───

export type DashboardSummary = {
  total_unpaid_cop: number;
  overdue_count: number;
  overdue_total_cop: number;
  due_next_7d_total: number;
  due_next_30d_total: number;
  paid_this_month_total: number;
  review_needed_count: number;
};

export type AlertItem = {
  id: string;
  type: "overdue" | "due_soon" | "quality" | "no_receipt" | "scheduled_tomorrow" | "vat_review" | "vat_blocked";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  invoice_id: string;
};

export type VatSummary = {
  month: string;
  total_invoices_with_vat: number;
  vat_usable_cop: number;
  vat_review_cop: number;
  vat_blocked_cop: number;
  invoices_usable_count: number;
  invoices_review_count: number;
  invoices_blocked_count: number;
  invoices_without_vat_count: number;
};

export type SharedDashboardData = {
  summary: DashboardSummary;
  alerts: AlertItem[];
  alertCounts: { total: number; critical: number; warning: number; info: number };
  vatSummary: VatSummary | null;
  reviewQueue: ReviewQueueItem[];
  topActions: ReviewQueueItem[];
  weeklyPlan: WeeklyPaymentPlan | null;
  weeklyGoals: WeeklyGoalsSummary | null;
  inactionSummary: InactionSummary | null;
  portfolioReadiness: PortfolioReadiness | null;
  deltaScore: number | null;
  operatingPrefs: OperatingPreferences;
  notes: OperationalNote[];
};

// ─── Helpers (same logic as API routes, no auth) ───

function computeSummary(invoices: Array<{ total_cop: number | null; due_date: string | null; payment_status: string; paid_at: string | null; data_quality_status: string | null }>): DashboardSummary {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const next7d = new Date(now);
  next7d.setDate(next7d.getDate() + 7);
  const next30d = new Date(now);
  next30d.setDate(next30d.getDate() + 30);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let totalUnpaidCop = 0;
  let overdueCount = 0;
  let overdueTotalCop = 0;
  let dueNext7dTotal = 0;
  let dueNext30dTotal = 0;
  let paidThisMonthTotal = 0;
  let reviewNeededCount = 0;

  for (const row of invoices) {
    const amount = typeof row.total_cop === "number" ? row.total_cop : 0;
    if (row.data_quality_status && row.data_quality_status !== "ok") reviewNeededCount++;
    if (row.payment_status === "paid") {
      if (row.paid_at) {
        const paidDate = new Date(row.paid_at);
        if (paidDate >= monthStart) paidThisMonthTotal += amount;
      }
      continue;
    }
    totalUnpaidCop += amount;
    if (row.due_date) {
      const due = new Date(row.due_date + "T00:00:00");
      if (due < now) { overdueCount++; overdueTotalCop += amount; }
      else if (due <= next7d) dueNext7dTotal += amount;
      else if (due <= next30d) dueNext30dTotal += amount;
    }
  }

  return { total_unpaid_cop: totalUnpaidCop, overdue_count: overdueCount, overdue_total_cop: overdueTotalCop, due_next_7d_total: dueNext7dTotal, due_next_30d_total: dueNext30dTotal, paid_this_month_total: paidThisMonthTotal, review_needed_count: reviewNeededCount };
}

function computeAlerts(invoices: Array<{ id: string; supplier_name: string | null; total_cop: number | null; due_date: string | null; payment_status: string; scheduled_payment_date: string | null; data_quality_status: string | null; vat_status: string | null; iva_cop: number | null }>, receiptCounts: Map<string, number>): { alerts: AlertItem[]; counts: { total: number; critical: number; warning: number; info: number } } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const in3d = new Date(now);
  in3d.setDate(in3d.getDate() + 3);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const fmt = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

  const alerts: AlertItem[] = [];
  let nextId = 1;

  for (const row of invoices) {
    const label = row.supplier_name || `Factura ${row.id.slice(0, 8)}`;
    const amount = typeof row.total_cop === "number" ? fmt(row.total_cop) : null;

    if (row.payment_status !== "paid" && row.due_date) {
      const due = new Date(row.due_date + "T00:00:00");
      if (due < now) {
        const diffDays = Math.ceil((now.getTime() - due.getTime()) / 86_400_000);
        alerts.push({ id: String(nextId++), type: "overdue", severity: "critical", title: `${label} vencida`, description: `Venció hace ${diffDays} día${diffDays !== 1 ? "s" : ""}${amount ? ` · ${amount}` : ""}`, invoice_id: row.id });
      } else if (due >= now && due <= in3d) {
        const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
        alerts.push({ id: String(nextId++), type: "due_soon", severity: "warning", title: `${label} vence pronto`, description: `Vence en ${diffDays} día${diffDays !== 1 ? "s" : ""}${amount ? ` · ${amount}` : ""}`, invoice_id: row.id });
      }
    }
    if (row.data_quality_status && row.data_quality_status !== "ok") {
      alerts.push({ id: String(nextId++), type: "quality", severity: row.data_quality_status === "incomplete" ? "warning" : "info", title: `${label} — datos ${row.data_quality_status === "incomplete" ? "incompletos" : "sospechosos"}`, description: "Revisar y corregir datos de la factura", invoice_id: row.id });
    }
    if (row.payment_status === "paid" && (receiptCounts.get(row.id) ?? 0) === 0) {
      alerts.push({ id: String(nextId++), type: "no_receipt", severity: "info", title: `${label} sin comprobante`, description: "Pagada pero sin comprobante adjunto", invoice_id: row.id });
    }
    if (row.payment_status === "scheduled" && row.scheduled_payment_date) {
      const sched = new Date(row.scheduled_payment_date + "T00:00:00");
      if (sched >= now && sched <= tomorrow) {
        alerts.push({ id: String(nextId++), type: "scheduled_tomorrow", severity: "info", title: `${label} programada para mañana`, description: `Pago programado${amount ? ` · ${amount}` : ""}`, invoice_id: row.id });
      }
    }
    if (row.vat_status === "iva_en_revision" && typeof row.iva_cop === "number" && row.iva_cop > 0) {
      const ivaFmt = fmt(row.iva_cop);
      alerts.push({ id: String(nextId++), type: "vat_review", severity: "info", title: `${label} — IVA en revisión`, description: `${ivaFmt} de IVA pendiente de soporte`, invoice_id: row.id });
    }
    if (row.vat_status === "iva_no_usable" && typeof row.iva_cop === "number" && row.iva_cop > 0) {
      const ivaFmt = fmt(row.iva_cop);
      alerts.push({ id: String(nextId++), type: "vat_blocked", severity: "warning", title: `${label} — IVA bloqueado`, description: `${ivaFmt} de IVA no usable por datos incompletos`, invoice_id: row.id });
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    alerts,
    counts: {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      info: alerts.filter((a) => a.severity === "info").length,
    },
  };
}

function computeVatSummary(invoices: Array<{ vat_status: string | null; vat_amount_usable_cop: number | null; vat_amount_review_cop: number | null; vat_amount_blocked_cop: number | null; iva_cop: number | null; created_at: string }>): VatSummary | null {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = new Date(year, month, 1).toISOString();
  const monthEnd = new Date(year, month + 1, 1).toISOString();
  const monthLabel = `${year}-${String(month + 1).padStart(2, "0")}`;

  const rows = invoices.filter((r) => r.created_at >= monthStart && r.created_at < monthEnd);

  let vatUsableCop = 0, vatReviewCop = 0, vatBlockedCop = 0;
  let usableCount = 0, reviewCount = 0, blockedCount = 0, withoutVatCount = 0;

  for (const row of rows) {
    switch (row.vat_status) {
      case "iva_usable": vatUsableCop += Number(row.vat_amount_usable_cop) || 0; usableCount++; break;
      case "iva_en_revision": vatReviewCop += Number(row.vat_amount_review_cop) || 0; reviewCount++; break;
      case "iva_no_usable": vatBlockedCop += Number(row.vat_amount_blocked_cop) || 0; blockedCount++; break;
      default: withoutVatCount++; break;
    }
  }

  const totalWithVat = usableCount + reviewCount + blockedCount;
  if (totalWithVat === 0) return null;

  return { month: monthLabel, total_invoices_with_vat: totalWithVat, vat_usable_cop: vatUsableCop, vat_review_cop: vatReviewCop, vat_blocked_cop: vatBlockedCop, invoices_usable_count: usableCount, invoices_review_count: reviewCount, invoices_blocked_count: blockedCount, invoices_without_vat_count: withoutVatCount };
}

// ─── Main fetcher ───

export async function fetchOwnerDashboardData(
  ownerUserId: string,
): Promise<SharedDashboardData> {
  const supabase = createServiceRoleClient();

  // Parallel: invoices (full), review queue, readiness, preferences
  const [invoicesResult, reviewResult, readinessResult, prefsResult, notesResult] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, supplier_name, invoice_number, total_cop, iva_cop, due_date, payment_status, paid_at, scheduled_payment_date, data_quality_status, vat_status, vat_amount_usable_cop, vat_amount_review_cop, vat_amount_blocked_cop, created_at, assigned_to_label")
      .eq("user_id", ownerUserId),
    getReviewQueue({ supabase, userId: ownerUserId }),
    supabase
      .from("readiness_snapshots")
      .select("portfolio_score, healthy_count, warning_count, critical_count, created_at")
      .eq("user_id", ownerUserId)
      .order("created_at", { ascending: false })
      .limit(2),
    supabase
      .from("user_operating_preferences")
      .select("preferred_action_style, preferred_weekly_focus, preferred_schedule_day, max_weekly_execution_count, preferred_view_mode, notes")
      .eq("user_id", ownerUserId)
      .maybeSingle(),
    supabase
      .from("operational_notes")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const allInvoices = invoicesResult.data ?? [];

  // Summary KPIs
  const summary = computeSummary(allInvoices);

  // Alerts (need receipt counts for the no_receipt alerts)
  const receiptCounts = await getReceiptsCounts(supabase, allInvoices.map((r) => r.id));
  const { alerts, counts: alertCounts } = computeAlerts(allInvoices, receiptCounts);

  // VAT
  const vatSummary = computeVatSummary(allInvoices);

  // Review queue derived data
  const items = reviewResult.items;
  const plan = buildPaymentPlan(items);
  const rawGoals = computeWeeklyGoals(items);
  const inaction = computeInactionScenarios(items, plan, rawGoals);
  const portfolioReadiness = computePortfolioReadiness(items.map((i) => ({ score: i.readiness_score, level: i.readiness_level, reason: i.readiness_reason })));

  // Operating preferences
  const prefs: OperatingPreferences = prefsResult.data
    ? (prefsResult.data as OperatingPreferences)
    : DEFAULT_PREFERENCES;

  const topActions = applyPreferencesToActions(getTopPriorityActions(items), prefs);
  const weeklyGoals: WeeklyGoalsSummary = { ...rawGoals, goals: applyPreferencesToGoals(rawGoals.goals, prefs) };

  // Readiness delta
  const snapshots = readinessResult.data ?? [];
  const deltaScore = snapshots.length >= 2
    ? (snapshots[0] as { portfolio_score: number }).portfolio_score - (snapshots[1] as { portfolio_score: number }).portfolio_score
    : null;

  return {
    summary,
    alerts,
    alertCounts,
    vatSummary,
    reviewQueue: items,
    topActions,
    weeklyPlan: plan,
    weeklyGoals,
    inactionSummary: inaction,
    portfolioReadiness,
    deltaScore,
    operatingPrefs: prefs,
    notes: (notesResult.data ?? []) as OperationalNote[],
  };
}
