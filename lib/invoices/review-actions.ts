/**
 * review-actions.ts — Central action dispatcher layer.
 *
 * Defines metadata, validation, and intent for each ReviewAction.
 * No UI logic here — only rules and helpers consumed by frontend hooks.
 */

import { type ReviewAction, ACTION_LABELS } from "./review-queue-core";
import { computeActionConfidence } from "./computeActionConfidence";

export type { ReviewAction } from "./review-queue-core";
export { ACTION_LABELS } from "./review-queue-core";

// ─── Types ───

/** Minimal invoice context needed to evaluate/run an action. */
export type ReviewActionContext = {
  invoice_id: string;
  payment_status: string | null;
  payment_url: string | null;
  supplier_portal_url: string | null;
  due_date: string | null;
  data_quality_status: string | null;
  vat_status: string | null;
  supplier_name?: string | null;
};

export type ReviewActionResult = {
  success: boolean;
  message: string;
  /** Which modal the UI should open, if any. */
  modal?: "schedule" | "pay_link" | "details" | "receipts";
  /** Whether the caller should refresh operational data afterward. */
  requiresRefresh?: boolean;
};

// ─── Validation ───

/** Can this action be run on this invoice right now? */
export function canRunReviewAction(
  action: ReviewAction,
  ctx: ReviewActionContext,
): boolean {
  switch (action) {
    case "pay_now":
    case "schedule_payment":
      if (ctx.payment_status === "paid") return false;
      break;
    case "review_invoice":
      return true;
    case "upload_receipt":
      break;
    default:
      return false;
  }
  // Blocked confidence = can't run
  const confidence = computeActionConfidence(ctx, action);
  return confidence.level !== "blocked";
}

// ─── Labels & intents ───

export function getReviewActionLabel(action: ReviewAction): string {
  return ACTION_LABELS[action];
}

/** Human-readable description of what the action will do. */
export function getReviewActionIntent(
  action: ReviewAction,
  ctx: ReviewActionContext,
): string {
  switch (action) {
    case "pay_now":
      if (ctx.payment_url || ctx.supplier_portal_url)
        return "Abrir portal de pago";
      return "Configurar link de pago";
    case "schedule_payment":
      if (ctx.payment_status === "scheduled") return "Reprogramar pago";
      return "Programar fecha de pago";
    case "review_invoice":
      return "Revisar y editar datos de la factura";
    case "upload_receipt":
      return "Subir comprobante de pago";
    default:
      return "Acción no reconocida";
  }
}

/** Feedback message after a successful action dispatch. */
export function getActionFeedbackMessage(action: ReviewAction): string {
  switch (action) {
    case "pay_now":
      return "Abriendo portal de pago...";
    case "schedule_payment":
      return "Programando pago...";
    case "review_invoice":
      return "Abriendo detalles...";
    case "upload_receipt":
      return "Abriendo comprobantes...";
    default:
      return "Procesando...";
  }
}

/** Feedback after a mutation completes (not just modal open). */
export function getActionCompletionMessage(action: ReviewAction): string {
  switch (action) {
    case "pay_now":
      return "Cuando termines, marca como pagada o sube comprobante.";
    case "schedule_payment":
      return "Pago programado correctamente.";
    case "review_invoice":
      return "Factura actualizada.";
    case "upload_receipt":
      return "Comprobante subido.";
    default:
      return "Acción completada.";
  }
}
