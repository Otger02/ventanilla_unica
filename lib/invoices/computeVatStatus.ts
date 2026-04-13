export type VatStatusInput = {
  iva_cop: number | null;
  payment_status: string | null;
  receipts_count: number;
  data_quality_status: "ok" | "suspect" | "incomplete" | null;
};

export type VatStatusResult = {
  vat_status: "iva_usable" | "iva_en_revision" | "iva_no_usable" | "sin_iva";
  vat_reason: string;
  vat_amount_usable_cop: number;
  vat_amount_review_cop: number;
  vat_amount_blocked_cop: number;
};

/**
 * Conservative VAT classification engine.
 *
 * Rules (ordered by priority):
 * 1. No IVA (null or ≤ 0) → sin_iva
 * 2. Incomplete data quality → iva_no_usable (blocked)
 * 3. Suspect data quality → iva_en_revision
 * 4. OK quality but no receipt → iva_en_revision
 * 5. OK quality + receipt → iva_usable
 */
export function computeVatStatus(input: VatStatusInput): VatStatusResult {
  const ivaCop = typeof input.iva_cop === "number" ? Math.round(input.iva_cop) : 0;

  // Rule 1: No IVA
  if (ivaCop <= 0) {
    return {
      vat_status: "sin_iva",
      vat_reason: "Factura sin IVA",
      vat_amount_usable_cop: 0,
      vat_amount_review_cop: 0,
      vat_amount_blocked_cop: 0,
    };
  }

  // Rule 2: Incomplete quality → blocked
  if (input.data_quality_status === "incomplete") {
    return {
      vat_status: "iva_no_usable",
      vat_reason: "Factura incompleta",
      vat_amount_usable_cop: 0,
      vat_amount_review_cop: 0,
      vat_amount_blocked_cop: ivaCop,
    };
  }

  // Rule 3: Suspect quality → review
  if (input.data_quality_status === "suspect") {
    return {
      vat_status: "iva_en_revision",
      vat_reason: "Factura con datos dudosos",
      vat_amount_usable_cop: 0,
      vat_amount_review_cop: ivaCop,
      vat_amount_blocked_cop: 0,
    };
  }

  // Rule 4: OK quality but no receipt → review
  if (input.receipts_count <= 0) {
    return {
      vat_status: "iva_en_revision",
      vat_reason: "Factura con IVA pero sin comprobante",
      vat_amount_usable_cop: 0,
      vat_amount_review_cop: ivaCop,
      vat_amount_blocked_cop: 0,
    };
  }

  // Rule 5: OK + receipt → usable
  return {
    vat_status: "iva_usable",
    vat_reason: "Factura con IVA y soporte suficiente",
    vat_amount_usable_cop: ivaCop,
    vat_amount_review_cop: 0,
    vat_amount_blocked_cop: 0,
  };
}
