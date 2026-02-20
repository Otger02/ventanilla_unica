type UserTaxProfileCO = {
  persona_type: "natural" | "juridica" | "unknown";
  regimen: "simple" | "ordinario" | "unknown";
  vat_responsible: "yes" | "no" | "unknown";
  provision_style: "conservative" | "balanced" | "aggressive";
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
    ivaMethod: "vat_collected_as_proxy";
    ivaNote: string;
    base: number;
    rentaProvision: number;
    rentaMethod: "simplified_monthly_provision";
    rentaRateBase: number;
    provisionStyle: "conservative" | "balanced" | "aggressive";
    provisionFactor: number;
    rentaNote: string;
    withholdingsNote: string;
    totalProvision: number;
    cashAfterProvision: number;
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

  const ivaProvision = profile.vat_responsible === "yes" ? inputs.vat_collected_cop : 0;

  const base = Math.max(inputs.income_cop - inputs.deductible_expenses_cop, 0);

  const rentaRateBase =
    profile.regimen === "simple" ? 0.05 : profile.regimen === "ordinario" ? 0.1 : 0.08;
  const provisionFactor =
    profile.provision_style === "conservative"
      ? 1.25
      : profile.provision_style === "aggressive"
        ? 0.75
        : 1.0;

  const rentaProvision = base * rentaRateBase * provisionFactor;
  const totalProvision = rentaProvision + ivaProvision;
  const cashAfterProvision = inputs.income_cop - inputs.deductible_expenses_cop - totalProvision;

  let riskLevel: ProvisionRiskLevel = "low";

  if (cashAfterProvision < 0) {
    riskLevel = "high";
  } else if (cashAfterProvision < 0.15 * inputs.income_cop) {
    riskLevel = "medium";
  }

  return {
    ok: true,
    breakdown: {
      ivaProvision,
      ivaMethod: "vat_collected_as_proxy",
      ivaNote:
        "Estimación simplificada: IVA cobrado del mes como provisión. No aplica descuentos por retenciones sin clasificar.",
      base,
      rentaProvision,
      rentaMethod: "simplified_monthly_provision",
      rentaRateBase,
      provisionStyle: profile.provision_style,
      provisionFactor,
      rentaNote:
        "Estimación simplificada para separar caja; no es cálculo definitivo de impuesto.",
      withholdingsNote:
        "Retenciones pueden corresponder a renta/IVA/ICA; se usan para ajuste posterior cuando se clasifiquen.",
      totalProvision,
      cashAfterProvision,
      riskLevel,
    },
  };
}
