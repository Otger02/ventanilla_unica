import { describe, it, expect } from "vitest";
import { computeVatStatus, type VatStatusInput } from "../computeVatStatus";

function make(overrides: Partial<VatStatusInput> = {}): VatStatusInput {
  return {
    iva_cop: 190_000,
    payment_status: "unpaid",
    receipts_count: 1,
    data_quality_status: "ok",
    ...overrides,
  };
}

describe("computeVatStatus", () => {
  it("rule 1: iva_cop null → 'sin_iva'", () => {
    const result = computeVatStatus(make({ iva_cop: null }));
    expect(result.vat_status).toBe("sin_iva");
    expect(result.vat_amount_usable_cop).toBe(0);
    expect(result.vat_amount_review_cop).toBe(0);
    expect(result.vat_amount_blocked_cop).toBe(0);
  });

  it("rule 1: iva_cop 0 → 'sin_iva'", () => {
    const result = computeVatStatus(make({ iva_cop: 0 }));
    expect(result.vat_status).toBe("sin_iva");
  });

  it("rule 2: data_quality_status 'incomplete' → 'iva_no_usable', full amount blocked", () => {
    const result = computeVatStatus(make({ data_quality_status: "incomplete" }));
    expect(result.vat_status).toBe("iva_no_usable");
    expect(result.vat_amount_blocked_cop).toBe(190_000);
    expect(result.vat_amount_usable_cop).toBe(0);
    expect(result.vat_amount_review_cop).toBe(0);
  });

  it("rule 3: data_quality_status 'suspect' → 'iva_en_revision', full amount in review", () => {
    const result = computeVatStatus(make({ data_quality_status: "suspect" }));
    expect(result.vat_status).toBe("iva_en_revision");
    expect(result.vat_amount_review_cop).toBe(190_000);
    expect(result.vat_amount_usable_cop).toBe(0);
    expect(result.vat_amount_blocked_cop).toBe(0);
  });

  it("rule 4: quality 'ok' but receipts_count 0 → 'iva_en_revision'", () => {
    const result = computeVatStatus(make({ receipts_count: 0 }));
    expect(result.vat_status).toBe("iva_en_revision");
    expect(result.vat_amount_review_cop).toBe(190_000);
  });

  it("rule 5: quality 'ok' and receipts_count > 0 → 'iva_usable', full amount usable", () => {
    const result = computeVatStatus(make());
    expect(result.vat_status).toBe("iva_usable");
    expect(result.vat_amount_usable_cop).toBe(190_000);
    expect(result.vat_amount_review_cop).toBe(0);
    expect(result.vat_amount_blocked_cop).toBe(0);
  });
});
