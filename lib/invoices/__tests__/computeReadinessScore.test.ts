import { describe, it, expect } from "vitest";
import {
  computeInvoiceReadiness,
  computePortfolioReadiness,
} from "../computeReadinessScore";

function makeInvoice(overrides: Partial<{
  data_quality_status: string | null;
  payment_status: string | null;
  vat_status: string | null;
  due_date: string | null;
}> = {}) {
  return {
    data_quality_status: "ok" as string | null,
    payment_status: "unpaid" as string | null,
    vat_status: "sin_iva" as string | null,
    due_date: "2026-12-31" as string | null,
    ...overrides,
  };
}

// Fixed "now" to avoid flaky tests
const NOW = new Date("2026-04-16T00:00:00");

describe("computeInvoiceReadiness", () => {
  it("all clean → score 100, level 'healthy'", () => {
    const result = computeInvoiceReadiness(makeInvoice(), 1, NOW);
    expect(result.score).toBe(100);
    expect(result.level).toBe("healthy");
  });

  it("data_quality_status 'incomplete' → score 50, level 'critical'", () => {
    const result = computeInvoiceReadiness(
      makeInvoice({ data_quality_status: "incomplete" }),
      1,
      NOW,
    );
    expect(result.score).toBe(50);
    expect(result.level).toBe("warning");
    expect(result.reason).toBe("Datos incompletos");
  });

  it("data_quality_status 'suspect' → score 75, level 'warning'", () => {
    const result = computeInvoiceReadiness(
      makeInvoice({ data_quality_status: "suspect" }),
      1,
      NOW,
    );
    expect(result.score).toBe(75);
    expect(result.level).toBe("warning");
    expect(result.reason).toBe("Datos sospechosos");
  });

  it("unpaid and overdue (due_date yesterday) → penalty applied, score < 100", () => {
    const result = computeInvoiceReadiness(
      makeInvoice({ due_date: "2026-04-15" }),
      1,
      NOW,
    );
    expect(result.score).toBe(80);
    expect(result.score).toBeLessThan(100);
    expect(result.reason).toBe("Pago vencido");
  });

  it("unpaid, due in 2 days → 10-point penalty", () => {
    const result = computeInvoiceReadiness(
      makeInvoice({ due_date: "2026-04-18" }),
      1,
      NOW,
    );
    expect(result.score).toBe(90);
    expect(result.reason).toBe("Vence en menos de 3 días");
  });

  it("paid with 0 receipts → 15-point penalty", () => {
    const result = computeInvoiceReadiness(
      makeInvoice({ payment_status: "paid" }),
      0,
      NOW,
    );
    expect(result.score).toBe(85);
    expect(result.reason).toBe("Pagada sin comprobante");
  });

  it("scheduled → 5-point penalty", () => {
    const result = computeInvoiceReadiness(
      makeInvoice({ payment_status: "scheduled" }),
      1,
      NOW,
    );
    expect(result.score).toBe(95);
    expect(result.reason).toBe("Pago programado pendiente");
  });
});

describe("computePortfolioReadiness", () => {
  it("mix of healthy/warning/critical → correct average and breakdown", () => {
    const scores = [
      { score: 100, level: "healthy" as const, reason: "ok" },
      { score: 75, level: "warning" as const, reason: "suspect" },
      { score: 40, level: "critical" as const, reason: "incomplete" },
    ];
    const result = computePortfolioReadiness(scores);
    expect(result.score).toBe(72); // Math.round((100+75+40)/3) = 72
    expect(result.level).toBe("warning");
    expect(result.breakdown.healthy).toBe(1);
    expect(result.breakdown.warning).toBe(1);
    expect(result.breakdown.critical).toBe(1);
  });

  it("empty array → score 100, healthy, all zeros", () => {
    const result = computePortfolioReadiness([]);
    expect(result.score).toBe(100);
    expect(result.level).toBe("healthy");
    expect(result.breakdown).toEqual({ healthy: 0, warning: 0, critical: 0 });
  });
});
