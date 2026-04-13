/**
 * computeReadinessScore.ts — Pure readiness scoring for invoices and portfolio.
 *
 * Scores how "ready to operate" each invoice is (0..100), based on
 * data quality, payment status, VAT status, and receipt coverage.
 *
 * Pure, no I/O, importable anywhere.
 */

// ─── Types ───

export type ReadinessLevel = "healthy" | "warning" | "critical";

export type ReadinessScore = {
  score: number; // 0..100
  level: ReadinessLevel;
  reason: string;
};

export type PortfolioReadiness = {
  score: number; // 0..100
  level: ReadinessLevel;
  breakdown: {
    healthy: number;
    warning: number;
    critical: number;
  };
};

// ─── Invoice-level scoring ───

type InvoiceInput = {
  data_quality_status: string | null;
  payment_status: string | null;
  vat_status: string | null;
  due_date: string | null;
};

function deriveLevel(score: number): ReadinessLevel {
  if (score >= 80) return "healthy";
  if (score >= 50) return "warning";
  return "critical";
}

export function computeInvoiceReadiness(
  invoice: InvoiceInput,
  receiptsCount: number,
  now?: Date,
): ReadinessScore {
  let score = 100;
  let worstPenalty = 0;
  let reason = "Factura en buen estado";

  const track = (penalty: number, label: string) => {
    score -= penalty;
    if (penalty > worstPenalty) {
      worstPenalty = penalty;
      reason = label;
    }
  };

  // Data quality
  if (invoice.data_quality_status === "incomplete") {
    track(50, "Datos incompletos");
  } else if (invoice.data_quality_status === "suspect") {
    track(25, "Datos sospechosos");
  }

  // Overdue
  if (invoice.payment_status !== "paid" && invoice.due_date) {
    const today = now ?? new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(invoice.due_date + "T00:00:00");
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);

    if (diffDays < 0) {
      track(20, "Pago vencido");
    } else if (diffDays <= 3) {
      track(10, "Vence en menos de 3 días");
    }
  }

  // VAT status
  if (invoice.vat_status === "iva_no_usable") {
    track(15, "IVA no usable");
  } else if (invoice.vat_status === "iva_en_revision") {
    track(10, "IVA en revisión");
  }

  // Paid without receipt
  if (invoice.payment_status === "paid" && receiptsCount === 0) {
    track(15, "Pagada sin comprobante");
  }

  // Scheduled (minor)
  if (invoice.payment_status === "scheduled") {
    track(5, "Pago programado pendiente");
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    level: deriveLevel(score),
    reason,
  };
}

// ─── Portfolio-level scoring ───

export function computePortfolioReadiness(
  scores: ReadinessScore[],
): PortfolioReadiness {
  if (scores.length === 0) {
    return { score: 100, level: "healthy", breakdown: { healthy: 0, warning: 0, critical: 0 } };
  }

  const breakdown = { healthy: 0, warning: 0, critical: 0 };
  let sum = 0;

  for (const s of scores) {
    sum += s.score;
    breakdown[s.level]++;
  }

  const score = Math.round(sum / scores.length);

  return {
    score,
    level: deriveLevel(score),
    breakdown,
  };
}
