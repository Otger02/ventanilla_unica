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

type NaturalBreakdown = {
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

type JuridicaOrdinarioBreakdown = {
  iva_to_separate: number;
  ingreso_base_sin_iva: number;
  utilidad_estimada: number;
  renta_bruta_estimada: number;
  renta_neta_estimada: number;
  total_provision_mvp: number;
  method: "mvp_juridica_ordinario_v1";
  notes: string;
};

type MonthlyProvisionSuccess = {
  ok: true;
  breakdown: NaturalBreakdown | JuridicaOrdinarioBreakdown;
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
  // --- Juridica + ordinario: MVP breakdown ---
  if (profile.persona_type === "juridica" && profile.regimen === "ordinario") {
    const ivaToSeparate = inputs.vat_collected_cop > 0 ? inputs.vat_collected_cop : 0;
    const ingresoBaseSinIva = inputs.income_cop - inputs.vat_collected_cop;
    const utilidadEstimada = ingresoBaseSinIva - inputs.deductible_expenses_cop;
    const rentaBrutaEstimada = Math.max(utilidadEstimada, 0) * 0.35;
    const rentaNetaEstimada = Math.max(rentaBrutaEstimada - inputs.withholdings_cop, 0);
    const totalProvisionMvp = ivaToSeparate + rentaNetaEstimada;

    return {
      ok: true,
      breakdown: {
        iva_to_separate: ivaToSeparate,
        ingreso_base_sin_iva: ingresoBaseSinIva,
        utilidad_estimada: utilidadEstimada,
        renta_bruta_estimada: rentaBrutaEstimada,
        renta_neta_estimada: rentaNetaEstimada,
        total_provision_mvp: totalProvisionMvp,
        method: "mvp_juridica_ordinario_v1" as const,
        notes: "Estimación MVP basada en FINANCIAL_CONTEXT; no reemplaza cierre contable oficial.",
      },
    };
  }

  if (profile.persona_type !== "natural") {
    return {
      ok: false,
      error: "Solo se soporta persona natural o jurídica ordinario en esta versión.",
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
