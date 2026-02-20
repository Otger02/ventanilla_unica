type UserTaxProfileCO = {
  persona_type: "natural" | "juridica" | "unknown";
  regimen: "simple" | "ordinario" | "unknown";
  vat_responsible: "yes" | "no" | "unknown";
};

type MonthlyTaxInputsCO = {
  income_cop: number;
  deductible_expenses_cop: number;
  withholdings_cop: number;
  vat_collected_cop: number;
};

type ProvisionRiskLevel = "high" | "medium" | "low";

type MonthlyProvisionSuccess = {
  ok: true;
  breakdown: {
    ivaProvision: number;
    base: number;
    rentaProvision: number;
    totalProvision: number;
    riskLevel: ProvisionRiskLevel;
  };
};

type MonthlyProvisionError = {
  ok: false;
  error: string;
};

export type MonthlyProvisionResult = MonthlyProvisionSuccess | MonthlyProvisionError;

export function calculateMonthlyProvisionCO(
  profile: UserTaxProfileCO,
  inputs: MonthlyTaxInputsCO,
): MonthlyProvisionResult {
  if (profile.persona_type !== "natural") {
    return {
      ok: false,
      error: "Solo se soporta persona natural en esta version MVP.",
    };
  }

  const ivaProvision =
    profile.vat_responsible === "yes"
      ? Math.max(inputs.vat_collected_cop - inputs.withholdings_cop, 0)
      : 0;

  const base = Math.max(inputs.income_cop - inputs.deductible_expenses_cop, 0);

  // TODO: Aproximacion simplificada MVP. Reemplazar por reglas tributarias completas.
  const rentaRate =
    profile.regimen === "simple" ? 0.05 : profile.regimen === "ordinario" ? 0.1 : 0.08;

  const rentaProvision = base * rentaRate;
  const totalProvision = rentaProvision + ivaProvision;

  let riskLevel: ProvisionRiskLevel = "low";

  if (totalProvision > 0 && inputs.income_cop === 0) {
    riskLevel = "high";
  } else if (totalProvision > 0 && base < 0.2 * inputs.income_cop) {
    riskLevel = "medium";
  }

  return {
    ok: true,
    breakdown: {
      ivaProvision,
      base,
      rentaProvision,
      totalProvision,
      riskLevel,
    },
  };
}
