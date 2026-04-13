/**
 * Weekly Payment Plan — pure classification + async wrapper.
 *
 * Takes already-classified ReviewQueueItems and buckets them into
 * must_pay / should_schedule / should_review for the current week.
 *
 * No LLM, no I/O in the pure function — only data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewQueueItem } from "./review-queue-core";
import { getReviewQueue } from "./getReviewQueue";

// ─── Types ──────────────────────────────────────────────────────────

export type CashProjection = {
  current_cash?: number;
  after_must_pay: number;
  after_schedule: number;
};

export type CashScenario = {
  outflow_now: number;
  outflow_scheduled: number;
  resulting_cash?: number;
  label: string;
};

export type CashScenarios = {
  do_nothing: CashScenario;
  pay_urgent_only: CashScenario;
  pay_and_schedule: CashScenario;
};

export type WeeklyPaymentPlan = {
  this_week: {
    must_pay: ReviewQueueItem[];
    should_schedule: ReviewQueueItem[];
    should_review: ReviewQueueItem[];
  };
  totals: {
    must_pay_total: number;
    upcoming_total: number;
  };
  cash_projection: CashProjection;
  cash_scenarios: CashScenarios;
};

// ─── Constants ──────────────────────────────────────────────────────

const MAX_PER_BUCKET = 5;
const MS_PER_DAY = 86_400_000;
const THREE_DAYS = 3 * MS_PER_DAY;
const SEVEN_DAYS = 7 * MS_PER_DAY;

// ─── Helpers ────────────────────────────────────────────────────────

function parseDue(due: string | null): Date | null {
  if (!due) return null;
  const d = new Date(due + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function sumTotal(items: ReviewQueueItem[]): number {
  return items.reduce((acc, i) => acc + (i.total_cop ?? 0), 0);
}

function sortByDueAsc(a: ReviewQueueItem, b: ReviewQueueItem): number {
  const da = parseDue(a.due_date)?.getTime() ?? Infinity;
  const db = parseDue(b.due_date)?.getTime() ?? Infinity;
  return da - db;
}

// ─── Cash scenarios ─────────────────────────────────────────────────

export function buildCashScenarios(
  plan: WeeklyPaymentPlan,
  currentCash?: number,
): CashScenarios {
  const { must_pay_total, upcoming_total } = plan.totals;
  const hasCash = currentCash != null && Number.isFinite(currentCash);

  return {
    do_nothing: {
      outflow_now: 0,
      outflow_scheduled: 0,
      ...(hasCash ? { resulting_cash: currentCash } : {}),
      label: "No hacer nada",
    },
    pay_urgent_only: {
      outflow_now: must_pay_total,
      outflow_scheduled: 0,
      ...(hasCash ? { resulting_cash: currentCash - must_pay_total } : {}),
      label: "Pagar solo lo urgente",
    },
    pay_and_schedule: {
      outflow_now: must_pay_total,
      outflow_scheduled: upcoming_total,
      ...(hasCash ? { resulting_cash: currentCash - must_pay_total - upcoming_total } : {}),
      label: "Pagar + programar todo",
    },
  };
}

// ─── Pure classification ────────────────────────────────────────────

export function buildPaymentPlan(
  items: ReviewQueueItem[],
  currentCash?: number,
): WeeklyPaymentPlan {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const nowMs = now.getTime();
  const threeDaysOut = nowMs + THREE_DAYS;
  const sevenDaysOut = nowMs + SEVEN_DAYS;

  const mustPayIds = new Set<string>();
  const mustPayAll: ReviewQueueItem[] = [];
  const shouldScheduleAll: ReviewQueueItem[] = [];
  const shouldReviewAll: ReviewQueueItem[] = [];

  // ── must_pay: overdue OR due <= 3 days, pay_now not blocked, has pay_now action
  for (const item of items) {
    if (!item.available_actions.includes("pay_now")) continue;
    if (item.action_confidence.pay_now?.level === "blocked") continue;

    const dueMs = parseDue(item.due_date)?.getTime();
    const isOverdue = item.priority === "overdue";
    const isDueSoon = dueMs != null && dueMs <= threeDaysOut;

    if (isOverdue || isDueSoon) {
      mustPayAll.push(item);
      mustPayIds.add(item.invoice_id);
    }
  }

  // ── should_schedule: due <= 7 days, schedule_payment not blocked, not in must_pay
  for (const item of items) {
    if (mustPayIds.has(item.invoice_id)) continue;
    if (!item.available_actions.includes("schedule_payment")) continue;
    if (item.action_confidence.schedule_payment?.level === "blocked") continue;

    const dueMs = parseDue(item.due_date)?.getTime();
    if (dueMs != null && dueMs <= sevenDaysOut) {
      shouldScheduleAll.push(item);
    }
  }

  // ── should_review: incomplete/suspect/vat_revision, not in prior buckets
  const scheduleIds = new Set(shouldScheduleAll.map((i) => i.invoice_id));
  for (const item of items) {
    if (mustPayIds.has(item.invoice_id)) continue;
    if (scheduleIds.has(item.invoice_id)) continue;

    if (
      item.priority === "incomplete" ||
      item.priority === "suspect" ||
      item.priority === "vat_revision"
    ) {
      shouldReviewAll.push(item);
    }
  }

  // ── Sort + slice
  mustPayAll.sort(sortByDueAsc);
  shouldScheduleAll.sort(sortByDueAsc);
  shouldReviewAll.sort(sortByDueAsc);

  const mustPayTotal = sumTotal(mustPayAll);
  const upcomingTotal = sumTotal(shouldScheduleAll);

  // ── Cash projection (conservative: only outflows, no income estimation)
  const hasCash = currentCash != null && Number.isFinite(currentCash);
  const afterMustPay = hasCash ? currentCash - mustPayTotal : -mustPayTotal;
  const afterSchedule = afterMustPay - upcomingTotal;

  return {
    this_week: {
      must_pay: mustPayAll.slice(0, MAX_PER_BUCKET),
      should_schedule: shouldScheduleAll.slice(0, MAX_PER_BUCKET),
      should_review: shouldReviewAll.slice(0, MAX_PER_BUCKET),
    },
    totals: {
      must_pay_total: mustPayTotal,
      upcoming_total: upcomingTotal,
    },
    cash_projection: {
      ...(hasCash ? { current_cash: currentCash } : {}),
      after_must_pay: afterMustPay,
      after_schedule: afterSchedule,
    },
    // Built inline to avoid a second pass — same data, just 3 perspectives
    cash_scenarios: {
      do_nothing: {
        outflow_now: 0,
        outflow_scheduled: 0,
        ...(hasCash ? { resulting_cash: currentCash } : {}),
        label: "No hacer nada",
      },
      pay_urgent_only: {
        outflow_now: mustPayTotal,
        outflow_scheduled: 0,
        ...(hasCash ? { resulting_cash: currentCash - mustPayTotal } : {}),
        label: "Pagar solo lo urgente",
      },
      pay_and_schedule: {
        outflow_now: mustPayTotal,
        outflow_scheduled: upcomingTotal,
        ...(hasCash ? { resulting_cash: currentCash - mustPayTotal - upcomingTotal } : {}),
        label: "Pagar + programar todo",
      },
    },
  };
}

// ─── Async wrapper (server-only) ────────────────────────────────────

export async function getPaymentPlan(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<WeeklyPaymentPlan> {
  const { items } = await getReviewQueue(params);
  return buildPaymentPlan(items);
}
