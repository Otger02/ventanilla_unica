import type { FinancialIntentReason } from "./_types";
import type { KB_CFO_SNIPPETS } from "@/lib/kb/cfo-estrategias";

const TAX_INTENT_KEYWORDS = [
  "provision",
  "provisionar",
  "separar",
  "apartar",
  "dian",
  "declaracion",
  "retencion",
  "renta",
  "iva",
  "impuestos",
  "pagar impuestos",
  "este mes",
  "contratar",
  "nomina",
  "empleado",
  "empleados",
  "cuotas",
  "deuda",
  "contribuyente",
  "gastos fijos",
  "pago en cuotas",
  "no pagar de golpe",
];

const HARD_TAX_TRIGGERS = ["impuestos", "iva", "dian"] as const;

const FINANCIAL_INTENT_KEYWORDS = [
  "impuestos",
  "iva",
  "dian",
  "renta",
  "retencion",
  "flujo",
  "caja",
  "provision",
  "apartar",
  "separar",
  "cuotas",
  "deuda",
  "vencimiento",
  "sancion",
  "domiciliar",
  "programar",
  "tesoreria",
  "subcuentas",
  "contratar",
  "nomina",
];

export function normalizeForIntent(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function detectTaxIntent(message: string): { detected: boolean; matchedKeyword: string | null } {
  const normalizedMessage = normalizeForIntent(message);

  const hardTrigger = HARD_TAX_TRIGGERS.find((keyword) => normalizedMessage.includes(keyword));
  if (hardTrigger) {
    return {
      detected: true,
      matchedKeyword: hardTrigger,
    };
  }

  const matchedKeyword = TAX_INTENT_KEYWORDS.find((keyword) =>
    normalizedMessage.includes(normalizeForIntent(keyword)),
  );

  return {
    detected: Boolean(matchedKeyword),
    matchedKeyword: matchedKeyword ?? null,
  };
}

export function detectFinancialIntent(
  normalizedMessage: string,
): { enabled: boolean; reason: FinancialIntentReason; matchedKeyword: string | null } {
  const cuotasKeywords = [
    "pagar en cuotas",
    "no pagarlo de golpe",
    "no pagar de golpe",
    "acuerdo dian",
    "acuerdo de pago",
    "diferir",
  ];
  const domiciliarKeywords = ["domiciliar", "programar transferencias", "programar pagos"];
  const liquidezKeywords = ["justo de caja", "liquidez", "flujo", "caja"];
  const ivaKeywords = ["iva", "vencimiento iva"];
  const rentaKeywords = ["renta", "impuesto de renta", "provision de renta", "provisiono de renta"];
  const proveedoresKeywords = [
    "proveedor",
    "proveedores",
    "factura",
    "facturas",
    "cuentas por pagar",
    "pagar proveedores",
  ];
  const pagosProveedoresSchedulingKeywords = [
    "programar pagos",
    "pagos mensuales",
    "transferencias",
  ];
  const invoicesPriorityKeywords = [
    "facturas pendientes",
    "cuentas por pagar",
    "cxp",
    "que pago primero",
    "vencimientos proveedores",
  ];

  const matchedInvoicesPriority = invoicesPriorityKeywords.find((keyword) =>
    normalizedMessage.includes(keyword),
  );
  if (matchedInvoicesPriority) {
    return {
      enabled: true,
      reason: "invoices_priority",
      matchedKeyword: matchedInvoicesPriority,
    };
  }

  const matchedCuotas = cuotasKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedCuotas) {
    return {
      enabled: true,
      reason: "cuotas_or_acuerdo",
      matchedKeyword: matchedCuotas,
    };
  }

  const matchedProveedores = proveedoresKeywords.find((keyword) =>
    normalizedMessage.includes(keyword),
  );
  const matchedProveedoresScheduling = pagosProveedoresSchedulingKeywords.find((keyword) =>
    normalizedMessage.includes(keyword),
  );
  if (matchedProveedores && matchedProveedoresScheduling) {
    return {
      enabled: true,
      reason: "payments_to_suppliers",
      matchedKeyword: matchedProveedores,
    };
  }

  const matchedDomiciliar = domiciliarKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedDomiciliar) {
    return {
      enabled: true,
      reason: "domiciliar_or_transfer",
      matchedKeyword: matchedDomiciliar,
    };
  }

  const matchedLiquidez = liquidezKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedLiquidez) {
    return {
      enabled: true,
      reason: "liquidity_pressure",
      matchedKeyword: matchedLiquidez,
    };
  }

  const matchedIva = ivaKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedIva) {
    return {
      enabled: true,
      reason: "iva_focus",
      matchedKeyword: matchedIva,
    };
  }

  const matchedRenta = rentaKeywords.find((keyword) => normalizedMessage.includes(keyword));
  if (matchedRenta) {
    return {
      enabled: true,
      reason: "renta_focus",
      matchedKeyword: matchedRenta,
    };
  }

  if (matchedProveedores) {
    return {
      enabled: true,
      reason: "payments_to_suppliers",
      matchedKeyword: matchedProveedores,
    };
  }

  const matchedKeyword = FINANCIAL_INTENT_KEYWORDS.find((keyword) =>
    normalizedMessage.includes(keyword),
  );

  if (!matchedKeyword) {
    const greetings = [
      "hola", "como voy", "que tal", "buenos dias", "buenas tardes",
      "buenas noches", "como estoy", "como va", "como estamos",
      "que hay", "hey", "buenas",
    ];
    if (greetings.some((g) => normalizedMessage.includes(g))) {
      return { enabled: true, reason: "greeting_weekly_plan", matchedKeyword: null };
    }
    return {
      enabled: false,
      reason: "no_financial_keyword",
      matchedKeyword: null,
    };
  }

  return {
    enabled: true,
    reason: "keyword_match",
    matchedKeyword,
  };
}

export function selectKbSnippets(
  normalizedMessage: string,
  snippets: typeof KB_CFO_SNIPPETS,
  reason?: FinancialIntentReason,
) {
  const snippetsById = new Map(snippets.map((snippet) => [snippet.id, snippet]));
  const prioritizedSnippetIds: string[] = [];

  const includesAny = (values: string[]) => values.some((value) => normalizedMessage.includes(value));
  const pushId = (snippetId: string) => {
    if (!prioritizedSnippetIds.includes(snippetId)) {
      prioritizedSnippetIds.push(snippetId);
    }
  };
  const mentionsTaxState = includesAny(["iva", "dian", "impuestos", "vencimiento"]);

  if (reason === "payments_to_suppliers") {
    pushId("domiciliar-pagos");
    pushId("proveedores-calendario-pagos");

    if (mentionsTaxState) {
      pushId("priorizacion-vencimientos");
    }
  }

  if (reason === "invoices_priority") {
    pushId("triage-caja-orden-pagos");
    pushId("proveedores-calendario-pagos");
  }

  if (reason === "liquidity_pressure") {
    pushId("triage-caja-orden-pagos");

    if (mentionsTaxState) {
      pushId("iva-separacion");
    } else {
      pushId("priorizacion-vencimientos");
    }
  }

  if (reason === "renta_focus") {
    pushId("renta-provision-mensual");

    if (includesAny(["iva"])) {
      pushId("iva-separacion");
    }
  }

  if (
    includesAny([
      "pagar en cuotas",
      "no pagarlo de golpe",
      "no pagar de golpe",
      "acuerdo dian",
      "acuerdo de pago",
      "diferir",
    ])
  ) {
    pushId("cuotas-legales-dian");
    pushId("priorizacion-vencimientos");
  }

  if (includesAny(["domiciliar", "programar transferencias", "programar pagos"])) {
    pushId("domiciliar-pagos");
    pushId("priorizacion-vencimientos");
  }

  if (reason !== "liquidity_pressure" && includesAny(["justo de caja", "liquidez", "flujo", "caja"])) {
    pushId("triage-caja-orden-pagos");
    pushId("priorizacion-vencimientos");
  }

  if (includesAny(["iva", "vencimiento iva"])) {
    pushId("iva-separacion");
  }

  const scoredSnippets = snippets
    .map((snippet) => {
      const normalizedKeywords = snippet.keywords.map((keyword) => normalizeForIntent(keyword));
      const score = normalizedKeywords.reduce((accumulator, keyword) => {
        return accumulator + (normalizedMessage.includes(keyword) ? 1 : 0);
      }, 0);

      return {
        snippet,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.snippet);

  const prioritizedSnippets = prioritizedSnippetIds
    .map((snippetId) => snippetsById.get(snippetId))
    .filter((snippet): snippet is (typeof snippets)[number] => Boolean(snippet));

  const finalSnippets = [...prioritizedSnippets];
  for (const snippet of scoredSnippets) {
    if (finalSnippets.length >= 2) {
      break;
    }

    if (!finalSnippets.some((selectedSnippet) => selectedSnippet.id === snippet.id)) {
      finalSnippets.push(snippet);
    }
  }

  return finalSnippets.slice(0, 2);
}

export function hardenKbSnippets(snippets: typeof KB_CFO_SNIPPETS) {
  if (snippets.length > 2) {
    console.warn("KB_OVERFLOW", { ids: snippets.map((snippet) => snippet.id) });
    return snippets.slice(0, 2);
  }

  return snippets;
}
