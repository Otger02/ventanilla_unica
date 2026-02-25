export type CfoKbSnippet = {
   id: string;
   keywords: string[];
   title: string;
   content: string;
};

export const KB_CFO_SNIPPETS: CfoKbSnippet[] = [
   {
      id: "iva-separacion",
      keywords: ["iva", "impuestos", "vencimiento iva", "apartar", "separar"],
      title: "IVA no es ingreso",
      content:
         "El IVA cobrado no es utilidad del negocio.\n" +
         "Sepáralo en una subcuenta el mismo día del cobro.\n" +
         "No mezclar IVA con gasto operativo.\n" +
         "Si falta caja, planifica apartes progresivos hasta vencimiento.",
   },
   {
      id: "cuotas-legales-dian",
      keywords: [
         "pagar en cuotas",
         "no pagarlo de golpe",
         "no pagar de golpe",
         "acuerdo dian",
         "acuerdo de pago",
         "diferir",
         "plazo",
      ],
      title: "Pagos en cuotas (legal)",
      content:
         "Si no puedes pagar de una vez, define monto total, fecha límite y abono hoy.\n" +
         "Opciones legales: acuerdo de pago con DIAN (si aplica) y provisión por tramos.\n" +
         "Prioriza obligaciones con mayor sanción e interés.\n" +
         "Evita financiar impuestos con deuda costosa si hay alternativa operativa.",
   },
   {
      id: "domiciliar-pagos",
      keywords: [
         "domiciliar",
         "programar transferencias",
         "programar pagos",
         "transferencias",
         "banco",
         "tesoreria",
         "calendario",
      ],
      title: "Programar pagos",
      content:
         "Puedes programar pagos desde banco o tesorería interna.\n" +
         "Define fecha objetivo y frecuencia (diaria/semanal/quincenal).\n" +
         "Usa recordatorios de calendario y confirmación de ejecución.\n" +
         "Mantén trazabilidad por obligación y periodo.",
   },
   {
      id: "priorizacion-vencimientos",
      keywords: [
         "priorizar",
         "priorizo",
         "vencimiento",
         "nomina",
         "nómina",
         "liquidez",
         "justo de caja",
         "urgente",
      ],
      title: "Prioriza por vencimiento y riesgo",
      content:
         "Prioriza por fecha de vencimiento, sanción potencial e impacto operativo.\n" +
         "El IVA se protege primero como obligación tributaria.\n" +
         "Si estás justo, arma cronograma de aportes hasta vencimiento.\n" +
         "Si no alcanzas, evalúa acuerdo formal con DIAN por vía legal.",
   },
   {
      id: "flujo-subcuentas",
      keywords: ["flujo", "caja", "liquidez", "subcuentas", "caja alternativa"],
      title: "Flujo de caja disciplinado",
      content:
         "Separa cuentas: operación, impuestos y reserva.\n" +
         "Define cuánto mover cada periodo y revisa ejecución.\n" +
         "Haz apartes frecuentes para bajar presión del vencimiento.",
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