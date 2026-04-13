/**
 * getBulkRecommendations.ts — Pure function that detects bulk action opportunities.
 *
 * Analyzes the review queue and returns up to 2 BulkRecommendation objects
 * (one schedule_group + one review_group) with confidence summaries.
 *
 * Pure, no I/O, importable in backend and tests.
 */

import type {
  ReviewQueueItem,
  ReviewAction,
  ConfidenceLevel,
  ConfidenceResult,
} from "./review-queue-core";

// ─── Types ───

export type ConfidenceSummary = {
  safe_count: number;
  review_count: number;
  blocked_count: number;
};

export type BulkRecommendation = {
  kind: "schedule_group" | "review_group";
  title: string;
  description: string;
  invoice_ids: string[];
  count: number;
  total_cop: number | null;
  reason: string;
  recommended_resolution: string;
  confidence_summary: ConfidenceSummary;
  overall_confidence: ConfidenceLevel;
};

// ─── Helpers ───

const MIN_GROUP_SIZE = 3;
const DUE_SOON_DAYS = 7;

function sumTotalCop(items: ReviewQueueItem[]): number | null {
  let sum = 0;
  let hasAny = false;
  for (const item of items) {
    if (item.total_cop != null) {
      sum += item.total_cop;
      hasAny = true;
    }
  }
  return hasAny ? sum : null;
}

function buildConfidenceSummary(
  items: ReviewQueueItem[],
  action: ReviewAction,
): ConfidenceSummary {
  const summary: ConfidenceSummary = { safe_count: 0, review_count: 0, blocked_count: 0 };
  for (const item of items) {
    const conf = item.action_confidence[action];
    if (!conf) continue;
    switch (conf.level) {
      case "safe": summary.safe_count++; break;
      case "review": summary.review_count++; break;
      case "blocked": summary.blocked_count++; break;
    }
  }
  return summary;
}

function deriveOverallConfidence(summary: ConfidenceSummary, count: number): ConfidenceLevel {
  if (summary.blocked_count > 0) return "blocked";
  if (summary.review_count > count / 2) return "review";
  return "safe";
}

function formatCOP(v: number): string {
  return "$" + v.toLocaleString("es-CO");
}

// ─── Main ───

export function getBulkRecommendations(items: ReviewQueueItem[]): BulkRecommendation[] {
  const results: BulkRecommendation[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueSoonThreshold = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000);

  // ── Rule A: schedule_group ──
  const scheduleable = items.filter((item) => {
    if (!item.available_actions.includes("schedule_payment")) return false;
    // Overdue or due within 7 days
    if (item.priority === "overdue") return true;
    if (item.due_date) {
      const due = new Date(item.due_date + "T00:00:00");
      return due <= dueSoonThreshold;
    }
    return false;
  });

  if (scheduleable.length >= MIN_GROUP_SIZE) {
    const summary = buildConfidenceSummary(scheduleable, "schedule_payment");
    const overall = deriveOverallConfidence(summary, scheduleable.length);

    // If any blocked, don't recommend this group
    if (summary.blocked_count === 0) {
      const total = sumTotalCop(scheduleable);
      const totalLabel = total != null ? ` (${formatCOP(total)} total)` : "";
      results.push({
        kind: "schedule_group",
        title: `Programar ${scheduleable.length} facturas vencidas o próximas`,
        description: `${scheduleable.length} facturas requieren programación de pago${totalLabel}`,
        invoice_ids: scheduleable.map((i) => i.invoice_id),
        count: scheduleable.length,
        total_cop: total,
        reason: "Vencidas o por vencer en 7 días",
        recommended_resolution: "Programa estas facturas juntas para evitar urgencias esta semana",
        confidence_summary: summary,
        overall_confidence: overall,
      });
    }
  }

  // ── Rule B: review_group ──
  const reviewable = items.filter(
    (item) => item.priority === "incomplete" || item.priority === "suspect",
  );

  if (reviewable.length >= MIN_GROUP_SIZE) {
    const summary = buildConfidenceSummary(reviewable, "review_invoice");
    const overall = deriveOverallConfidence(summary, reviewable.length);

    // review_invoice is always safe, so blocked_count will always be 0
    results.push({
      kind: "review_group",
      title: `Revisar ${reviewable.length} facturas incompletas o sospechosas`,
      description: `${reviewable.length} facturas necesitan revisión de datos`,
      invoice_ids: reviewable.map((i) => i.invoice_id),
      count: reviewable.length,
      total_cop: sumTotalCop(reviewable),
      reason: "Datos incompletos o sospechosos",
      recommended_resolution: "Revísalas en lote antes de intentar pagarlas o usarlas fiscalmente",
      confidence_summary: summary,
      overall_confidence: overall,
    });
  }

  return results;
}
