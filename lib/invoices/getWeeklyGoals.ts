/**
 * getWeeklyGoals.ts — Pure function that computes weekly operational goals.
 *
 * Analyzes the review queue and returns up to 3 actionable goals
 * with progress tracking. Pure, no I/O.
 */

import type { ReviewQueueItem } from "./review-queue-core";

// ─── Types ───

export type GoalKind =
  | "pay_overdue"
  | "schedule_upcoming"
  | "fix_incomplete"
  | "upload_receipts"
  | "improve_readiness";

export type WeeklyGoal = {
  id: string;
  kind: GoalKind;
  title: string;
  description: string;
  target_count: number;
  current_count: number;
  progress_ratio: number; // 0..1
  recommended_action: string;
  priority: 1 | 2 | 3;
};

export type WeeklyGoalsSummary = {
  goals: WeeklyGoal[];
  headline: string;
};

// ─── Helpers ───

const MAX_GOALS = 3;
const MAX_TARGET = 5;

function makeGoal(
  kind: GoalKind,
  priority: 1 | 2 | 3,
  outstanding: number,
  title: string,
  description: string,
  recommended_action: string,
): WeeklyGoal {
  const target = Math.min(outstanding, MAX_TARGET);
  return {
    id: kind,
    kind,
    title,
    description,
    target_count: target,
    current_count: 0, // outstanding = not yet resolved
    progress_ratio: 0,
    recommended_action,
    priority,
  };
}

// ─── Main ───

export function computeWeeklyGoals(items: ReviewQueueItem[]): WeeklyGoalsSummary {
  const goals: WeeklyGoal[] = [];

  const overdueCount = items.filter((i) => i.priority === "overdue").length;
  const incompleteCount = items.filter((i) => i.priority === "incomplete").length;
  const noReceiptCount = items.filter((i) => i.priority === "no_receipt").length;
  const suspectCount = items.filter((i) => i.priority === "suspect").length;
  const vatRevisionCount = items.filter((i) => i.priority === "vat_revision").length;

  // Items that could be scheduled (upcoming, not overdue)
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcomingCount = items.filter((i) => {
    if (i.priority !== "overdue" && i.due_date && i.payment_status !== "paid") {
      const due = new Date(i.due_date + "T00:00:00");
      const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
      return days >= 0 && days <= 7;
    }
    return false;
  }).length;

  // Priority 1: overdue
  if (overdueCount > 0 && goals.length < MAX_GOALS) {
    goals.push(makeGoal(
      "pay_overdue",
      1,
      overdueCount,
      `Resolver ${Math.min(overdueCount, MAX_TARGET)} factura${Math.min(overdueCount, MAX_TARGET) !== 1 ? "s" : ""} vencida${Math.min(overdueCount, MAX_TARGET) !== 1 ? "s" : ""}`,
      `Tienes ${overdueCount} factura${overdueCount !== 1 ? "s" : ""} vencida${overdueCount !== 1 ? "s" : ""}. Págalas o prográmalas esta semana.`,
      "Ir a vencidas",
    ));
  }

  // Priority 2: incomplete
  if (incompleteCount > 0 && goals.length < MAX_GOALS) {
    goals.push(makeGoal(
      "fix_incomplete",
      2,
      incompleteCount,
      `Completar ${Math.min(incompleteCount, MAX_TARGET)} factura${Math.min(incompleteCount, MAX_TARGET) !== 1 ? "s" : ""} incompleta${Math.min(incompleteCount, MAX_TARGET) !== 1 ? "s" : ""}`,
      `${incompleteCount} factura${incompleteCount !== 1 ? "s" : ""} con datos faltantes. Completa los datos para poder operar.`,
      "Ir a revisión",
    ));
  }

  // Priority 3: no receipt
  if (noReceiptCount > 0 && goals.length < MAX_GOALS) {
    goals.push(makeGoal(
      "upload_receipts",
      3,
      noReceiptCount,
      `Subir ${Math.min(noReceiptCount, MAX_TARGET)} comprobante${Math.min(noReceiptCount, MAX_TARGET) !== 1 ? "s" : ""}`,
      `${noReceiptCount} pago${noReceiptCount !== 1 ? "s" : ""} sin comprobante. Sube los soportes para la DIAN.`,
      "Subir comprobantes",
    ));
  }

  // If still room: schedule upcoming
  if (upcomingCount > 0 && goals.length < MAX_GOALS) {
    goals.push(makeGoal(
      "schedule_upcoming",
      goals.length < 1 ? 1 : (goals.length + 1) as 1 | 2 | 3,
      upcomingCount,
      `Programar ${Math.min(upcomingCount, MAX_TARGET)} factura${Math.min(upcomingCount, MAX_TARGET) !== 1 ? "s" : ""} próxima${Math.min(upcomingCount, MAX_TARGET) !== 1 ? "s" : ""}`,
      `${upcomingCount} factura${upcomingCount !== 1 ? "s" : ""} vence${upcomingCount !== 1 ? "n" : ""} esta semana. Programa los pagos para evitar urgencias.`,
      "Programar pagos",
    ));
  }

  // If still room and there are suspect/vat issues: improve readiness
  if ((suspectCount + vatRevisionCount) > 0 && goals.length < MAX_GOALS) {
    const total = suspectCount + vatRevisionCount;
    goals.push(makeGoal(
      "improve_readiness",
      goals.length < 1 ? 1 : (goals.length + 1) as 1 | 2 | 3,
      total,
      `Mejorar ${Math.min(total, MAX_TARGET)} factura${Math.min(total, MAX_TARGET) !== 1 ? "s" : ""} con alertas`,
      `${total} factura${total !== 1 ? "s" : ""} con datos sospechosos o IVA en revisión.`,
      "Ir a revisión",
    ));
  }

  // Headline
  const criticalCount = overdueCount + incompleteCount;
  let headline: string;
  if (criticalCount >= 3) {
    headline = "Tu prioridad esta semana es reducir riesgo operativo";
  } else if (items.length > 0) {
    headline = "Esta semana puedes consolidar y ordenar";
  } else {
    headline = "Vas bien, mantén la operación ordenada";
  }

  return { goals, headline };
}
