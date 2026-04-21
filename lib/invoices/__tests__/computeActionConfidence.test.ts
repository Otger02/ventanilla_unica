import { describe, it, expect } from "vitest";
import { computeActionConfidence, type ConfidenceInput } from "../computeActionConfidence";

function make(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    data_quality_status: "ok",
    vat_status: "sin_iva",
    payment_status: "unpaid",
    due_date: "2026-05-01",
    supplier_name: "Proveedor ABC",
    ...overrides,
  };
}

describe("computeActionConfidence", () => {
  describe("pay_now", () => {
    it("data_quality 'incomplete' → 'blocked'", () => {
      const result = computeActionConfidence(
        make({ data_quality_status: "incomplete" }),
        "pay_now",
      );
      expect(result.level).toBe("blocked");
    });

    it("data_quality 'suspect' → 'review'", () => {
      const result = computeActionConfidence(
        make({ data_quality_status: "suspect" }),
        "pay_now",
      );
      expect(result.level).toBe("review");
    });

    it("quality 'ok', vat not blocked → 'safe'", () => {
      const result = computeActionConfidence(make(), "pay_now");
      expect(result.level).toBe("safe");
    });
  });

  describe("schedule_payment", () => {
    it("'incomplete' → 'blocked'", () => {
      const result = computeActionConfidence(
        make({ data_quality_status: "incomplete" }),
        "schedule_payment",
      );
      expect(result.level).toBe("blocked");
    });

    it("'ok' → 'safe'", () => {
      const result = computeActionConfidence(make(), "schedule_payment");
      expect(result.level).toBe("safe");
    });
  });

  describe("upload_receipt", () => {
    it("payment_status 'paid' → 'safe'", () => {
      const result = computeActionConfidence(
        make({ payment_status: "paid" }),
        "upload_receipt",
      );
      expect(result.level).toBe("safe");
    });

    it("payment_status 'unpaid' → 'blocked'", () => {
      const result = computeActionConfidence(
        make({ payment_status: "unpaid" }),
        "upload_receipt",
      );
      expect(result.level).toBe("blocked");
    });
  });

  describe("review_invoice", () => {
    it("always → 'safe'", () => {
      const result = computeActionConfidence(
        make({ data_quality_status: "incomplete" }),
        "review_invoice",
      );
      expect(result.level).toBe("safe");
    });
  });
});
