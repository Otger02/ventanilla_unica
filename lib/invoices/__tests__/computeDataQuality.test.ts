import { describe, it, expect } from "vitest";
import { computeDataQuality, type DataQualityInput } from "../computeDataQuality";

function make(overrides: Partial<DataQualityInput> = {}): DataQualityInput {
  return {
    confidence: 0.95,
    supplier_name: "Proveedor ABC",
    due_date: "2026-05-01",
    total_cop: 1_000_000,
    subtotal_cop: 840_336,
    iva_cop: 159_664,
    ...overrides,
  };
}

describe("computeDataQuality", () => {
  it("complete valid data → status 'ok'", () => {
    const result = computeDataQuality(make());
    expect(result.status).toBe("ok");
    expect(result.flags.low_confidence).toBe(false);
    expect(result.flags.missing_supplier).toBe(false);
    expect(result.flags.missing_due_date).toBe(false);
    expect(result.flags.suspect_amount).toBe(false);
  });

  it("missing supplier_name → status 'incomplete'", () => {
    const result = computeDataQuality(make({ supplier_name: null }));
    expect(result.status).toBe("incomplete");
    expect(result.flags.missing_supplier).toBe(true);
  });

  it("empty supplier_name → status 'incomplete'", () => {
    const result = computeDataQuality(make({ supplier_name: "  " }));
    expect(result.status).toBe("incomplete");
    expect(result.flags.missing_supplier).toBe(true);
  });

  it("missing due_date → status 'incomplete'", () => {
    const result = computeDataQuality(make({ due_date: null }));
    expect(result.status).toBe("incomplete");
    expect(result.flags.missing_due_date).toBe(true);
  });

  it("total_cop <= 0 → status 'incomplete'", () => {
    const result = computeDataQuality(make({ total_cop: 0 }));
    expect(result.status).toBe("incomplete");
  });

  it("total_cop null → status 'incomplete'", () => {
    const result = computeDataQuality(make({ total_cop: null }));
    expect(result.status).toBe("incomplete");
  });

  it("confidence < 0.7 → status 'suspect'", () => {
    const result = computeDataQuality(make({ confidence: 0.5 }));
    expect(result.status).toBe("suspect");
    expect(result.flags.low_confidence).toBe(true);
  });

  it("subtotal + iva doesn't match total (>5% deviation) → status 'suspect'", () => {
    // subtotal + iva = 500_000 + 100_000 = 600_000; total = 1_000_000 → 40% deviation
    const result = computeDataQuality(
      make({ total_cop: 1_000_000, subtotal_cop: 500_000, iva_cop: 100_000 }),
    );
    expect(result.status).toBe("suspect");
    expect(result.flags.suspect_amount).toBe(true);
  });

  it("missing supplier AND low confidence → 'incomplete' wins over 'suspect'", () => {
    const result = computeDataQuality(
      make({ supplier_name: null, confidence: 0.3 }),
    );
    expect(result.status).toBe("incomplete");
    expect(result.flags.missing_supplier).toBe(true);
    expect(result.flags.low_confidence).toBe(true);
  });
});
