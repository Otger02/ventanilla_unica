export type DataQualityInput = {
  confidence: number | null;
  supplier_name: string | null;
  due_date: string | null;
  total_cop: number | null;
  subtotal_cop: number | null;
  iva_cop: number | null;
};

export type DataQualityFlags = {
  low_confidence: boolean;
  missing_due_date: boolean;
  missing_supplier: boolean;
  suspect_amount: boolean;
};

export type DataQualityResult = {
  status: "ok" | "suspect" | "incomplete";
  flags: DataQualityFlags;
};

export function computeDataQuality(input: DataQualityInput): DataQualityResult {
  const lowConfidence =
    typeof input.confidence === "number" && input.confidence < 0.7;

  const missingDueDate = !input.due_date;

  const missingSupplier =
    !input.supplier_name || input.supplier_name.trim() === "";

  const suspectAmount = (() => {
    if (input.total_cop === null || input.total_cop === undefined) return true;
    if (input.total_cop <= 0 || input.total_cop < 1000) return true;
    const subtotal =
      typeof input.subtotal_cop === "number" ? input.subtotal_cop : null;
    const iva = typeof input.iva_cop === "number" ? input.iva_cop : null;
    if (subtotal !== null && iva !== null) {
      const expected = subtotal + iva;
      if (
        expected > 0 &&
        Math.abs(expected - input.total_cop) / expected > 0.05
      ) {
        return true;
      }
    }
    return false;
  })();

  const flags: DataQualityFlags = {
    low_confidence: lowConfidence,
    missing_due_date: missingDueDate,
    missing_supplier: missingSupplier,
    suspect_amount: suspectAmount,
  };

  const missingTotal =
    input.total_cop === null ||
    input.total_cop === undefined ||
    input.total_cop <= 0;

  let status: "ok" | "suspect" | "incomplete" = "ok";
  if (missingSupplier || missingDueDate || missingTotal) {
    status = "incomplete";
  } else if (lowConfidence || suspectAmount) {
    status = "suspect";
  }

  return { status, flags };
}
