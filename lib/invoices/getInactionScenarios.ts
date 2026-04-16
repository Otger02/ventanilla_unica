/**
 * getInactionScenarios.ts — Pure function that computes week-level inaction scenarios.
 *
 * Answers: "What happens if the user does nothing this week?"
 * Pure, no I/O.
 */

import type { ReviewQueueItem } from "./review-queue-core";
import type { WeeklyPaymentPlan } from "./getPaymentPlan";
import type { WeeklyGoalsSummary } from "./getWeeklyGoals";

// ─── Types ───

export type InactionKind =
  | "do_nothing"
  | "skip_urgent"
  | "skip_review"
  | "skip_receipts";

export type InactionScenario = {
  kind: InactionKind;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  likely_effects: string[];
};

export type InactionSummary = {
  scenarios: InactionScenario[];
  headline: string;
};

// ─── Main ───

export function computeInactionScenarios(
  items: ReviewQueueItem[],
  plan: WeeklyPaymentPlan | null,
  goals: WeeklyGoalsSummary | null,
): InactionSummary {
  const scenarios: InactionScenario[] = [];

  const overdueCount = items.filter((i) => i.priority === "overdue").length;
  const incompleteCount = items.filter((i) => i.priority === "incomplete").length;
  const suspectCount = items.filter((i) => i.priority === "suspect").length;
  const noReceiptCount = items.filter((i) => i.priority === "no_receipt").length;

  const mustPayCount = plan?.this_week.must_pay.length ?? 0;
  const mustPayTotal = plan?.totals.must_pay_total ?? 0;

  // ─── do_nothing: overall inaction ───
  if (overdueCount > 0 || mustPayCount > 0) {
    const totalUrgent = overdueCount + mustPayCount;
    const effects: string[] = [];

    if (overdueCount > 0) {
      effects.push(`${overdueCount} factura${overdueCount !== 1 ? "s" : ""} acumularán mora e intereses`);
    }
    if (mustPayTotal > 0) {
      effects.push(`$${mustPayTotal.toLocaleString("es-CO")} en pagos urgentes quedarán sin resolver`);
    }
    effects.push("Tu score de salud operativa bajará significativamente");

    scenarios.push({
      kind: "do_nothing",
      title: "No hacer nada esta semana",
      description: `Tienes ${totalUrgent} factura${totalUrgent !== 1 ? "s" : ""} urgente${totalUrgent !== 1 ? "s" : ""}. Ignorarlas tendrá consecuencias directas.`,
      severity: overdueCount >= 3 ? "critical" : "warning",
      likely_effects: effects,
    });
  }

  // ─── skip_urgent: ignore must-pay items ───
  if (mustPayCount > 0) {
    const effects: string[] = [];
    effects.push(`${mustPayCount} factura${mustPayCount !== 1 ? "s" : ""} pasarán a estado vencido`);
    if (mustPayTotal > 0) {
      effects.push(`Riesgo de mora sobre $${mustPayTotal.toLocaleString("es-CO")}`);
    }
    effects.push("Relación con proveedores puede deteriorarse");

    scenarios.push({
      kind: "skip_urgent",
      title: "Ignorar pagos urgentes",
      description: `Si no pagas las ${mustPayCount} factura${mustPayCount !== 1 ? "s" : ""} que vencen esta semana, pasarán a vencidas.`,
      severity: mustPayCount >= 3 ? "critical" : "warning",
      likely_effects: effects,
    });
  }

  // ─── skip_review: ignore incomplete/suspect ───
  const reviewableCount = incompleteCount + suspectCount;
  if (reviewableCount > 0) {
    const effects: string[] = [];
    if (incompleteCount > 0) {
      effects.push(`${incompleteCount} factura${incompleteCount !== 1 ? "s" : ""} seguirán bloqueadas por datos faltantes`);
    }
    if (suspectCount > 0) {
      effects.push(`${suspectCount} factura${suspectCount !== 1 ? "s" : ""} con datos sospechosos pueden causar pagos incorrectos`);
    }
    effects.push("No podrás operar correctamente sobre estas facturas");

    scenarios.push({
      kind: "skip_review",
      title: "No revisar facturas con problemas",
      description: `${reviewableCount} factura${reviewableCount !== 1 ? "s" : ""} necesitan revisión. Sin corregirlas, quedan inutilizables.`,
      severity: reviewableCount >= 5 ? "critical" : "warning",
      likely_effects: effects,
    });
  }

  // ─── skip_receipts: ignore missing receipts ───
  if (noReceiptCount > 0) {
    const effects: string[] = [];
    effects.push(`${noReceiptCount} pago${noReceiptCount !== 1 ? "s" : ""} quedarán sin soporte ante la DIAN`);
    effects.push("Riesgo de que la DIAN rechace deducciones fiscales");
    if (noReceiptCount >= 5) {
      effects.push("Acumular más comprobantes pendientes dificulta la conciliación");
    }

    scenarios.push({
      kind: "skip_receipts",
      title: "No subir comprobantes pendientes",
      description: `${noReceiptCount} pago${noReceiptCount !== 1 ? "s" : ""} sin comprobante. La DIAN puede objetar estas deducciones.`,
      severity: noReceiptCount >= 5 ? "critical" : "warning",
      likely_effects: effects,
    });
  }

  // ─── Headline ───
  const hasCritical = scenarios.some((s) => s.severity === "critical");
  const totalScenarios = scenarios.length;
  let headline: string;

  if (hasCritical) {
    headline = "No actuar esta semana tiene consecuencias serias";
  } else if (totalScenarios > 0) {
    headline = "Hay riesgos si pospones estas tareas";
  } else {
    headline = "Tu operación está al día — sigue así";
  }

  return { scenarios, headline };
}
