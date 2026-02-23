export type CfoKbSnippet = {
   id: string;
   keywords: string[];
   title: string;
   content: string;
};

export const KB_CFO_SNIPPETS: CfoKbSnippet[] = [
   {
      id: "iva-separacion",
      keywords: ["iva", "impuestos", "dian", "provision", "apartar", "separar"],
      title: "IVA no es ingreso",
      content:
         "El IVA cobrado no es utilidad del negocio.\n" +
         "Sepáralo en una subcuenta el mismo día del cobro.\n" +
         "No mezclar IVA con gasto operativo.\n" +
         "Si no hay caja suficiente, prioriza separar IVA antes de otros egresos discrecionales.",
   },
   {
      id: "cuotas-legales-dian",
      keywords: ["cuotas", "no pagar de golpe", "acuerdo", "dian", "deuda", "plazo"],
      title: "Pagos en cuotas (legal)",
      content:
         "Si no puedes pagar de una vez, define monto total, fecha límite y abono hoy.\n" +
         "Opciones legales: acuerdo de pago con DIAN (si aplica) y provisión semanal.\n" +
         "Prioriza obligaciones con mayor sanción e interés.\n" +
         "Evita financiar impuestos con deuda costosa si hay alternativa operativa.",
   },
   {
      id: "domiciliar-pagos",
      keywords: ["domiciliar", "programar", "transferencias", "banco", "tesoreria", "calendario"],
      title: "Programar pagos",
      content:
         "Puedes programar pagos desde banco o tesorería interna.\n" +
         "Define fecha objetivo y frecuencia (semanal/quincenal).\n" +
         "Usa recordatorios de calendario y confirmación de ejecución.\n" +
         "Mantén trazabilidad por obligación y periodo.",
   },
   {
      id: "priorizacion-obligaciones",
      keywords: ["priorizar", "vencimiento", "sancion", "operacion", "intereses"],
      title: "Priorización por riesgo",
      content:
         "Orden sugerido: obligaciones con sanción fiscal alta, luego intereses altos, luego operativas.\n" +
         "No priorices solo por valor; prioriza por costo total de incumplimiento.\n" +
         "Revisa semanalmente vencimientos de los próximos 30 días.",
   },
   {
      id: "flujo-subcuentas",
      keywords: ["flujo", "caja", "subcuentas", "semanal", "liquidez"],
      title: "Flujo de caja disciplinado",
      content:
         "Separa cuentas: operación, impuestos y reserva.\n" +
         "Haz apartes semanales automáticos para bajar presión de cierre mensual.\n" +
         "Meta mínima: 1 mes de gastos fijos en liquidez operativa.",
   },
   {
      id: "contratacion-costo-total",
      keywords: ["contratar", "nomina", "empleado", "prestaciones", "parafiscales"],
      title: "Antes de contratar",
      content:
         "Si falta el costo total mensual, no decidas todavía.\n" +
         "Pide salario + prestaciones + parafiscales + costos indirectos.\n" +
         "Valida si el flujo soporta ese costo 3-6 meses sin tensionar impuestos.",
   },
];