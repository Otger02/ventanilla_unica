import { describe, it, expect } from "vitest";
import { calculateMonthlyProvisionCO } from "../calculators/colombia/monthlyProvision";

describe("calculateMonthlyProvisionCO — juridica + ordinario", () => {
  const baseProfile = {
    persona_type: "juridica" as const,
    regimen: "ordinario" as const,
    vat_responsible: "yes" as const,
    provision_style: "balanced" as const,
  };

  it("with IVA and withholdings → correct breakdown", () => {
    const result = calculateMonthlyProvisionCO(baseProfile, {
      income_cop: 10_000_000,
      deductible_expenses_cop: 3_000_000,
      withholdings_cop: 500_000,
      vat_collected_cop: 1_900_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const b = result.breakdown as any;
    expect(b.method).toBe("mvp_juridica_ordinario_v1");
    expect(b.iva_to_separate).toBe(1_900_000);
    // ingreso_base = 10M - 1.9M = 8.1M
    expect(b.ingreso_base_sin_iva).toBe(8_100_000);
    // utilidad = 8.1M - 3M = 5.1M
    expect(b.utilidad_estimada).toBe(5_100_000);
    // renta_bruta = 5.1M * 0.35 = 1_785_000
    expect(b.renta_bruta_estimada).toBe(1_785_000);
    // renta_neta = max(1_785_000 - 500_000, 0) = 1_285_000
    expect(b.renta_neta_estimada).toBe(1_285_000);
    // total = 1_900_000 + 1_285_000 = 3_185_000
    expect(b.total_provision_mvp).toBe(3_185_000);
  });

  it("with zero IVA → iva_to_separate is 0", () => {
    const result = calculateMonthlyProvisionCO(baseProfile, {
      income_cop: 5_000_000,
      deductible_expenses_cop: 1_000_000,
      withholdings_cop: 200_000,
      vat_collected_cop: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const b = result.breakdown as any;
    expect(b.iva_to_separate).toBe(0);
    // ingreso_base = 5M - 0 = 5M; utilidad = 5M - 1M = 4M
    // renta_bruta = 4M * 0.35 = 1_400_000; renta_neta = 1_400_000 - 200_000 = 1_200_000
    expect(b.total_provision_mvp).toBe(1_200_000);
  });

  it("withholdings exceed renta → renta_neta is 0", () => {
    const result = calculateMonthlyProvisionCO(baseProfile, {
      income_cop: 3_000_000,
      deductible_expenses_cop: 2_000_000,
      withholdings_cop: 500_000,
      vat_collected_cop: 570_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const b = result.breakdown as any;
    // ingreso_base = 3M - 570K = 2_430_000; utilidad = 2_430_000 - 2M = 430_000
    // renta_bruta = 430_000 * 0.35 = 150_500; renta_neta = max(150_500 - 500_000, 0) = 0
    expect(b.renta_neta_estimada).toBe(0);
    expect(b.total_provision_mvp).toBe(570_000); // only IVA
  });
});

describe("calculateMonthlyProvisionCO — persona natural (existing behavior)", () => {
  it("natural + ordinario → successful natural breakdown", () => {
    const result = calculateMonthlyProvisionCO(
      {
        persona_type: "natural",
        regimen: "ordinario",
        vat_responsible: "yes",
        provision_style: "balanced",
      },
      {
        income_cop: 10_000_000,
        deductible_expenses_cop: 3_000_000,
        withholdings_cop: 500_000,
        vat_collected_cop: 1_900_000,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const b = result.breakdown as any;
    // Natural path uses ivaProvision/rentaProvision fields
    expect(b.ivaProvision).toBe(1_900_000);
    expect(b.rentaMethod).toBe("simplified_monthly_provision");
    expect(typeof b.totalProvision).toBe("number");
  });
});
