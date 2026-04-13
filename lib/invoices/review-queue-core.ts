/**
 * review-queue-core.ts — Single source of truth for invoice review queue logic.
 *
 * Every consumer (API, chat, dashboard) MUST use these functions and types.
 * No classification, prioritization, or action logic should exist elsewhere.
 */

import { computeActionConfidence, type ConfidenceResult } from "./computeActionConfidence";
import { computeInvoiceReadiness, type ReadinessLevel, type ReadinessScore } from "./computeReadinessScore";
export type { ConfidenceLevel, ConfidenceResult } from "./computeActionConfidence";
export type { ReadinessLevel, ReadinessScore } from "./computeReadinessScore";

// ─── Types ───

export type ReviewPriority = "overdue" | "incomplete" | "suspect" | "vat_revision" | "no_receipt";

export type ReviewAction = "pay_now" | "review_invoice" | "upload_receipt" | "schedule_payment";

export type ClassifyInvoiceRow = {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  total_cop: number | null;
  iva_cop: number | null;
  due_date: string | null;
  payment_status: string | null;
  data_quality_status: string | null;
  vat_status: string | null;
};

export type ReviewQueueItem = {
  invoice_id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  total_cop: number | null;
  iva_cop: number | null;
  due_date: string | null;
  payment_status: string | null;
  data_quality_status: string | null;
  vat_status: string | null;
  priority: ReviewPriority;
  reason: string;
  consequence_if_ignored: string;
  recommended_resolution: string;
  readiness_score: number;
  readiness_level: ReadinessLevel;
  readiness_reason: string;
  available_actions: ReviewAction[];
  action_confidence: Record<ReviewAction, ConfidenceResult>;
  badge_color: "red" | "orange" | "blue" | "grey";
};

// ─── Constants (single source) ───

export const REVIEW_PRIORITY_ORDER: Record<ReviewPriority, number> = {
  overdue: 0,
  incomplete: 1,
  suspect: 2,
  vat_revision: 3,
  no_receipt: 4,
};

export const PRIORITY_LABELS: Record<ReviewPriority, string> = {
  overdue: "Vencida",
  incomplete: "Incompleta",
  suspect: "Sospechosa",
  vat_revision: "IVA en revisión",
  no_receipt: "Sin comprobante",
};

export const ACTION_LABELS: Record<ReviewAction, string> = {
  pay_now: "Pagar",
  review_invoice: "Revisar",
  upload_receipt: "Comprobante",
  schedule_payment: "Programar",
};

// ─── Confidence helper ───

function buildConfidenceMap(
  row: ClassifyInvoiceRow,
  actions: ReviewAction[],
): Record<ReviewAction, ConfidenceResult> {
  return Object.fromEntries(
    actions.map((a) => [a, computeActionConfidence(row, a)]),
  ) as Record<ReviewAction, ConfidenceResult>;
}

// ─── Classification (single function) ───

export function classifyInvoice(
  row: ClassifyInvoiceRow,
  receiptsCount: number,
  now: Date,
): ReviewQueueItem | null {
  const readiness = computeInvoiceReadiness(row, receiptsCount, now);
  const base = {
    invoice_id: row.id,
    supplier_name: row.supplier_name,
    invoice_number: row.invoice_number,
    total_cop: row.total_cop,
    iva_cop: row.iva_cop,
    due_date: row.due_date,
    payment_status: row.payment_status,
    data_quality_status: row.data_quality_status,
    vat_status: row.vat_status,
    readiness_score: readiness.score,
    readiness_level: readiness.level,
    readiness_reason: readiness.reason,
  };

  // Priority 1: Overdue unpaid
  if (row.payment_status !== "paid" && row.due_date) {
    const due = new Date(row.due_date + "T00:00:00");
    if (due < now) {
      const days = Math.ceil((now.getTime() - due.getTime()) / 86_400_000);
      const actions: ReviewAction[] = ["pay_now", "schedule_payment"];
      return {
        ...base,
        priority: "overdue",
        reason: `Vencida hace ${days} día${days !== 1 ? "s" : ""}`,
        consequence_if_ignored: "Riesgo de mora e intereses por pago tardío",
        recommended_resolution: "Paga hoy o prográmala si no puedes pagar ahora",
        available_actions: actions,
        action_confidence: buildConfidenceMap(row, actions),
        badge_color: "red",
      };
    }
  }

  // Priority 2: Incomplete data quality
  if (row.data_quality_status === "incomplete") {
    const actions: ReviewAction[] = ["review_invoice"];
    return {
      ...base,
      priority: "incomplete",
      reason: "Datos incompletos — revisar proveedor, fecha o monto",
      consequence_if_ignored: "No podrás pagar ni programar correctamente esta factura",
      recommended_resolution: "Completa los datos faltantes antes de pagar o usar su IVA",
      available_actions: actions,
      action_confidence: buildConfidenceMap(row, actions),
      badge_color: "red",
    };
  }

  // Priority 3: Suspect data quality
  if (row.data_quality_status === "suspect") {
    const actions: ReviewAction[] = ["review_invoice"];
    return {
      ...base,
      priority: "suspect",
      reason: "Datos sospechosos — posible error de OCR o monto inconsistente",
      consequence_if_ignored: "Un error no corregido puede causar pagos incorrectos o problemas con la DIAN",
      recommended_resolution: "Revisa monto y datos clave antes de tomar acción",
      available_actions: actions,
      action_confidence: buildConfidenceMap(row, actions),
      badge_color: "orange",
    };
  }

  // Priority 4: VAT in revision
  if (row.vat_status === "iva_en_revision" && typeof row.iva_cop === "number" && row.iva_cop > 0) {
    if (receiptsCount === 0) {
      const actions: ReviewAction[] = ["upload_receipt", "review_invoice"];
      return {
        ...base,
        priority: "vat_revision",
        reason: "IVA en revisión — falta comprobante de pago",
        consequence_if_ignored: "No podrás descontar este IVA en tu declaración",
        recommended_resolution: "Sube comprobante o revisa soporte antes de usar este IVA",
        available_actions: actions,
        action_confidence: buildConfidenceMap(row, actions),
        badge_color: "orange",
      };
    }
    const actions: ReviewAction[] = ["review_invoice"];
    return {
      ...base,
      priority: "vat_revision",
      reason: "IVA en revisión — verificar datos de la factura",
      consequence_if_ignored: "El IVA seguirá bloqueado para descuento fiscal",
      recommended_resolution: "Sube comprobante o revisa soporte antes de usar este IVA",
      available_actions: actions,
      action_confidence: buildConfidenceMap(row, actions),
      badge_color: "orange",
    };
  }

  // Priority 5: Paid without receipt
  if (row.payment_status === "paid" && receiptsCount === 0) {
    const actions: ReviewAction[] = ["upload_receipt"];
    return {
      ...base,
      priority: "no_receipt",
      reason: "Pagada sin comprobante adjunto",
      consequence_if_ignored: "Sin soporte, la DIAN puede rechazar la deducción",
      recommended_resolution: "Sube el comprobante para dejar el pago soportado",
      available_actions: actions,
      action_confidence: buildConfidenceMap(row, actions),
      badge_color: "blue",
    };
  }

  return null;
}

// ─── Batch classification (pure, synchronous) ───

export function classifyInvoices(
  rows: ClassifyInvoiceRow[],
  receiptCounts: Map<string, number>,
): { items: ReviewQueueItem[]; total: number } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const items: ReviewQueueItem[] = [];
  for (const row of rows) {
    const item = classifyInvoice(row, receiptCounts.get(row.id) ?? 0, now);
    if (item) items.push(item);
  }

  items.sort((a, b) => REVIEW_PRIORITY_ORDER[a.priority] - REVIEW_PRIORITY_ORDER[b.priority]);

  return { items, total: items.length };
}

// ─── Top priority actions (pure, synchronous) ───

export function getTopPriorityActions(
  items: ReviewQueueItem[],
  max = 3,
): ReviewQueueItem[] {
  return [...items]
    .sort((a, b) => {
      // 1. readiness_score ASC (worst first)
      if (a.readiness_score !== b.readiness_score) return a.readiness_score - b.readiness_score;
      // 2. overdue first
      const aOverdue = a.priority === "overdue" ? 0 : 1;
      const bOverdue = b.priority === "overdue" ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      // 3. due_date closest first (null last)
      const aDue = a.due_date ? new Date(a.due_date + "T00:00:00").getTime() : Infinity;
      const bDue = b.due_date ? new Date(b.due_date + "T00:00:00").getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      // 4. confidence safe first (safe=0, review=1, blocked=2)
      const confOrder: Record<string, number> = { safe: 0, review: 1, blocked: 2 };
      const primaryA = a.available_actions[0];
      const primaryB = b.available_actions[0];
      const confA = confOrder[a.action_confidence[primaryA]?.level ?? "review"] ?? 1;
      const confB = confOrder[b.action_confidence[primaryB]?.level ?? "review"] ?? 1;
      return confA - confB;
    })
    .slice(0, max);
}
