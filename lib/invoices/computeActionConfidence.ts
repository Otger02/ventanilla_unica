/**
 * computeActionConfidence.ts — Deterministic confidence engine for review actions.
 *
 * Pure function: given invoice data + action, returns whether the action is
 * SAFE to execute, needs REVIEW first, or is BLOCKED by missing data.
 *
 * No LLM, no I/O. The LLM only communicates the result.
 */

import type { ReviewAction } from "./review-queue-core";

// ─── Types ───

export type ConfidenceLevel = "safe" | "review" | "blocked";

export type ConfidenceResult = {
  level: ConfidenceLevel;
  reason: string;
};

/** Minimal invoice shape needed for confidence computation. */
export type ConfidenceInput = {
  data_quality_status: string | null;
  vat_status: string | null;
  payment_status: string | null;
  due_date: string | null;
  supplier_name?: string | null;
};

// ─── Helpers ───

function isEmpty(v: string | null | undefined): boolean {
  return !v || v.trim().length === 0;
}

// ─── Main ───

export function computeActionConfidence(
  invoice: ConfidenceInput,
  action: ReviewAction,
): ConfidenceResult {
  switch (action) {
    case "pay_now":
      return payNowConfidence(invoice);
    case "schedule_payment":
      return schedulePaymentConfidence(invoice);
    case "review_invoice":
      return { level: "safe", reason: "Siempre disponible" };
    case "upload_receipt":
      return uploadReceiptConfidence(invoice);
    default:
      return { level: "review", reason: "Acción desconocida" };
  }
}

// ─── Per-action rules ───

function payNowConfidence(inv: ConfidenceInput): ConfidenceResult {
  // Blocked: critical data missing
  if (
    inv.data_quality_status === "incomplete" ||
    isEmpty(inv.supplier_name) ||
    isEmpty(inv.due_date)
  ) {
    return { level: "blocked", reason: "Datos incompletos para ejecutar pago" };
  }

  // Review: data uncertain
  if (
    inv.data_quality_status === "suspect" ||
    inv.vat_status === "iva_en_revision"
  ) {
    return { level: "review", reason: "Revisar datos antes de pagar" };
  }

  // Safe: verified data
  if (
    inv.data_quality_status === "ok" &&
    inv.vat_status !== "iva_no_usable"
  ) {
    return { level: "safe", reason: "Datos verificados" };
  }

  // Fallback: conservative
  return { level: "review", reason: "Verificar datos antes de proceder" };
}

function schedulePaymentConfidence(inv: ConfidenceInput): ConfidenceResult {
  if (inv.data_quality_status === "incomplete") {
    return { level: "blocked", reason: "Datos incompletos" };
  }

  if (inv.vat_status === "iva_en_revision") {
    return { level: "review", reason: "IVA pendiente de revisión" };
  }

  if (
    inv.data_quality_status === "ok" ||
    inv.data_quality_status === "suspect"
  ) {
    return { level: "safe", reason: "Programación permitida" };
  }

  return { level: "review", reason: "Verificar datos antes de programar" };
}

function uploadReceiptConfidence(inv: ConfidenceInput): ConfidenceResult {
  if (inv.payment_status === "paid") {
    return { level: "safe", reason: "Factura pagada, comprobante pendiente" };
  }
  return { level: "blocked", reason: "Primero se debe registrar el pago" };
}
