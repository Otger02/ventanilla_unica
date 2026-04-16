type InvoiceWithAssignment = {
  supplier_name: string | null;
  invoice_number: string | null;
  id: string;
  assigned_to_label: string | null;
};

export function buildAssignmentsPromptSection(
  invoices: InvoiceWithAssignment[],
): string {
  const assigned = invoices.filter((inv) => inv.assigned_to_label);
  if (assigned.length === 0) return "";

  const lines = assigned.map((inv) => {
    const label =
      inv.supplier_name?.trim() ||
      inv.invoice_number?.trim() ||
      `Factura ${inv.id.slice(0, 8)}`;
    return `- ${label} → asignada a ${inv.assigned_to_label}`;
  });

  return [
    "RESPONSABILIDADES:",
    ...lines,
    "",
    "INSTRUCCION_RESPONSABILIDADES:",
    "Respeta las asignaciones de responsabilidad al sugerir acciones.",
    "Si una factura está asignada a 'Asesor', no le pidas al usuario (propietario) que actúe directamente sobre ella; en su lugar indica que está bajo responsabilidad del asesor.",
    "Si una factura está asignada a 'Yo' (propietario), priorízala en tus recomendaciones.",
    "Si tiene un responsable personalizado, menciónalo al hablar de esa factura.",
  ].join("\n");
}
