import {
  type FinancialContextPayload,
  type FinancialIntentReason,
  type CurrentTaxCalculation,
  type InvoicesPrioritySummary,
  REQUIRED_PROFILE_FIELDS,
  formatCopForPrompt,
  formatPeriodLabelEs,
  worstConfidence,
} from "./_types";
import { buildProfileSnapshot } from "./_context";
import { ventanillaUnicaSystemPrompt } from "@/lib/ai/systemPrompt";
import { computePortfolioReadiness } from "@/lib/invoices/computeReadinessScore";
import { computeWeeklyGoals } from "@/lib/invoices/getWeeklyGoals";
import { computeInactionScenarios } from "@/lib/invoices/getInactionScenarios";
import { applyPreferencesToActions, applyPreferencesToGoals, buildPreferencesPromptSection, type OperatingPreferences } from "@/lib/invoices/applyOperatingPreferences";
import { buildNotesPromptSection } from "@/lib/notes/buildNotesPromptSection";
import { buildAssignmentsPromptSection } from "@/lib/assignments/buildAssignmentsPromptSection";
import { getBulkRecommendations } from "@/lib/invoices/getBulkRecommendations";
import { buildPaymentPlan, type WeeklyPaymentPlan } from "@/lib/invoices/getPaymentPlan";
import { getTopPriorityActions, type ReviewQueueItem } from "@/lib/invoices/getReviewQueue";
import type { KB_CFO_SNIPPETS } from "@/lib/kb/cfo-estrategias";
import type { KB_CC_SNIPPETS } from "@/lib/kb/camara-comercio";

const KB_RESUMEN = {
  impuestos_basicos: [
    "Los negocios pequeños en Colombia suelen gestionar renta, IVA (si aplica), retenciones y facturación electrónica.",
    "Error común: no provisionar impuestos mes a mes.",
    "Rango orientativo no obligatorio para provisión: 10%–25% de ingresos en freelancers/servicios.",
    "El IVA cobrado no es ingreso del negocio; es un valor a trasladar al Estado.",
  ],
  salud_financiera: [
    "Facturar no equivale a tener caja disponible.",
    "Conviene provisionar impuestos, gastos fijos y emergencias cada mes.",
    "Semáforo: verde (estabilidad y provisiones), amarillo (flujo irregular), rojo (sin provisiones y alto riesgo).",
    "Checklist mensual: ingresos, gastos, provisión de impuestos, flujo de caja y estado financiero.",
  ],
};

const TERMINOLOGIA_CO_LINES = [
  "Terminología (CO):",
  "- IVA: no es ingreso; es dinero que cobras y debes entregar al Estado.",
  "- Retenciones: son anticipos; pueden ser renta, IVA o ICA (no asumir cuál si no está clasificado).",
  "- Régimen ordinario vs SIMPLE: ordinario liquida impuestos con reglas generales; SIMPLE unifica y simplifica cargas para ciertos contribuyentes.",
  "- DIAN: autoridad tributaria nacional.",
  "- Caja/flujo: hablar en términos de plata disponible y separar en cuenta aparte.",
];

const REGLAS_DE_ORO = [
  "REGLAS DE ORO:",
  "- OMITE introducciones como \"Soy tu CFO\", \"Como experto...\", o \"He analizado tus documentos\".",
  "- OMITE confirmaciones de lectura.",
  "- RESPUESTA DIRECTA: Empieza siempre con la información solicitada. Si pregunto por una fecha, la primera palabra de tu respuesta debe ser la fecha o el contexto de la misma.",
  "- TONO: Profesional, técnico y breve. Usa el Calendario 2026 y el Estatuto Tributario como si fueran tu propia memoria, sin citarlos a menos que sea necesario para dar validez (ej: \"Según el Art. X...\").",
  "- LENGUAJE SIMPLE: Nunca uses un código fiscal o contable (como 'Formulario 350') sin antes explicar que es de forma simplificada (ej: Retención en la Fuente) y qué implicaciones tiene para el negocio.",
  "- FORMATO: Manten la tabla Markdown con los emojis (🔴, 🟡, 🟢) solo cuando se listen facturas, sin textos de relleno antes o después.",
  "",
  "FORMATO DE RESPUESTA FINANCIERA OBLIGATORIO:",
  "Cuando el usuario haga una pregunta sobre facturas, pagos, impuestos, provisiones, caja o tesorería, usa SIEMPRE esta estructura:",
  "",
  "## (1) Resumen",
  "- Nº facturas pendientes, total pendiente, vencidas (si aplica)",
  "- Máximo 3-4 bullets concisos",
  "",
  "## (2) Prioridad de pagos",
  "- Lista clara: proveedor, monto, fecha, motivo (vence antes / crítica / impuesto DIAN)",
  "- Si hay facturas, usar tabla Markdown con 🔴/🟡/🟢",
  "",
  "## (3) Impacto en caja",
  "- Total próximos 7 días",
  "- Total próximos 30 días",
  "- Provisión estimada pendiente (si hay datos fiscales)",
  "",
  "## (4) Acción recomendada",
  "- Instrucciones claras y ejecutables",
  "- NO teoría fiscal larga",
  "- Máximo 3 pasos concretos",
  "",
  "EXCEPCIONES al formato (1)-(4):",
  "- Saludos simples: responder con saludo y pregunta de en qué ayudar",
  "- Preguntas conceptuales (\"qué es IVA\"): responder directo sin estructura (1)-(4)",
  "- Si NO hay datos financieros del usuario: pedir los datos necesarios, no inventar",
].join("\n");

export type BuildChatPromptContext = {
  contextLines: string[];
  taxProfileData: string;
  financialContextPayload: FinancialContextPayload;
  financialIntent: { enabled: boolean; reason: FinancialIntentReason; matchedKeyword: string | null };
  taxIntentDetected: boolean;
  pendingInvoicesList: any[];
  allInvoicesRaw: any[];
  dataQualityWarningCount: number;
  dataQualityIncompleteCount: number;
  dataQualitySuspectCount: number;
  vatUsableCop: number;
  vatReviewCop: number;
  vatBlockedCop: number;
  vatUsableCount: number;
  vatReviewCount: number;
  vatBlockedCount: number;
  reviewQueueItems: ReviewQueueItem[];
  readinessDelta: number | null;
  operatingPrefs: OperatingPreferences;
  operationalNotes: { target_type: string; target_id: string | null; author_label: string; content: string; created_at: string }[];
  kbSnippetsForModel: typeof KB_CFO_SNIPPETS;
  kbSnippetIdsUsed: string[];
  ccKbSnippets: typeof KB_CC_SNIPPETS;
  calcActualPayload: CurrentTaxCalculation | null;
  invoicesPrioritySummary: InvoicesPrioritySummary | null;
  weeklyPlanPayload: WeeklyPaymentPlan | null;
  authenticatedUserId: string | null;
};

export function buildChatPrompt(ctx: BuildChatPromptContext): string {
  const promptSections = [
    `Contexto de conversacion (ultimos 10 mensajes):\n${ctx.contextLines.join("\n")}`,
    ctx.taxProfileData ? `CONTEXTO_PERFIL_USUARIO:\n${ctx.taxProfileData}` : "",
    "FINANCIAL_CONTEXT:\n" + JSON.stringify(ctx.financialContextPayload, null, 2),
    [
      "INSTRUCCION_FINANCIAL_CONTEXT:",
      "Si FINANCIAL_CONTEXT contiene valores numéricos, debes usarlos. No inventes cifras ni uses ejemplos hipotéticos.",
      "Si monthly_inputs es null, pide al usuario llenar el mes o confirma si usamos el último mes disponible.",
    ].join("\n"),
    TERMINOLOGIA_CO_LINES.join("\n"),
  ];

  if (ctx.pendingInvoicesList && ctx.pendingInvoicesList.length > 0) {
    const invoicesForPrompt = ctx.pendingInvoicesList.map((inv: any) => ({
      ...inv,
      _quality_warning: inv.data_quality_status === "suspect" ? "datos sospechosos - verificar antes de decidir" : undefined,
    }));
    promptSections.push(
      [
        "ALL_INVOICES_LIST_REAL_DATA:",
        JSON.stringify(invoicesForPrompt, null, 2),
        "INSTRUCCION_FACTURAS_PENDIENTES_Y_PAGADAS:",
        "Usa esta lista para responder si el usuario pregunta 'qué facturas tengo', '¿qué debo?', 'cuánto debo' o temas relacionados con pagos.",
        "Importante: Las facturas con payment_status 'paid' ya están pagadas. Las 'unpaid' o 'scheduled' están pendientes.",
        "El CFO SIEMPRE debe incluir y decir exactamente esta frase en su respuesta: 'Has pagado $X y te faltan $Y por pagar', donde $X es la suma de las facturas pagadas y $Y es la suma de las facturas pendientes. Formatea todo en pesos colombianos.",
        `HOY ES ${new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" }).toUpperCase()}. Al listar facturas pendientes actúa con visión de CFO y aplica la siguiente lógica de semáforo priorizando pagos:`,
        "🔴 Vencida: Si la due_date ya pasó respecto a hoy.",
        "🟡 Urgente: Si la due_date tiene vencimiento dentro de los próximos 7 días.",
        "🟢 Al día: Si tiene más de 5 días de plazo.",
        "Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas para las pendientes: Estatus (Emoji 🔴/🟡/🟢), Proveedor, Monto (COP), y Vencimiento.",
        "Al final de la tabla, debes calcular OBLIGATORIAMENTE el Gran Total Pendiente.",
        "NO añadas textos de relleno ni recomendaciones antes o después de la tabla de facturas."
      ].join("\n")
    );
  }

  if (ctx.dataQualityWarningCount > 0) {
    promptSections.push(
      `AVISO_CALIDAD_DATOS: Hay ${ctx.dataQualityWarningCount} factura(s) con datos dudosos o incompletos (${ctx.dataQualityIncompleteCount} incompleta(s), ${ctx.dataQualitySuspectCount} sospechosa(s)). Menciona esto al usuario y sugiere que las revise antes de tomar decisiones financieras.`
    );
  }

  // --- Review queue context for actionable responses ---
  if (ctx.financialIntent.enabled && ctx.reviewQueueItems.length > 0) {
    const top10 = ctx.reviewQueueItems.slice(0, 10);
    const actionMap: Record<string, string> = {
      pay_now: "pagar ahora",
      review_invoice: "revisar factura",
      upload_receipt: "subir comprobante",
      schedule_payment: "programar pago",
    };
    const confidenceTag: Record<string, string> = {
      safe: "SEGURO",
      review: "REVISAR",
      blocked: "BLOQUEADO",
    };
    const reviewLines = top10.map((item) => {
      const supplierLabel = item.supplier_name?.trim() || "Proveedor desconocido";
      const amountLabel = item.total_cop !== null ? formatCopForPrompt(item.total_cop) : "monto no disponible";
      const dueLabel = item.due_date
        ? (() => {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const due = new Date(item.due_date + "T00:00:00");
            const diffDays = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
            if (diffDays < 0) return `vencida hace ${Math.abs(diffDays)}d`;
            if (diffDays === 0) return "vence hoy";
            return `vence en ${diffDays}d`;
          })()
        : "sin vencimiento";
      const actionLabel = actionMap[item.available_actions[0]] ?? item.available_actions[0];
      const confLevel = worstConfidence(item.action_confidence);
      const confTag = confidenceTag[confLevel] ?? "REVISAR";
      return `- ${supplierLabel} | ${amountLabel} | ${dueLabel} | ${item.reason} | ${actionLabel} | [${confTag}] | si no actúas: ${item.consequence_if_ignored} | resolución recomendada: ${item.recommended_resolution} | readiness: ${item.readiness_score}/100 (${item.readiness_level})`;
    });

    promptSections.push(
      [
        "REVIEW_QUEUE:",
        (() => {
          const portfolio = computePortfolioReadiness(ctx.reviewQueueItems.map((i) => ({ score: i.readiness_score, level: i.readiness_level, reason: i.readiness_reason })));
          let line = `Salud operativa global: ${portfolio.score}/100 (${portfolio.level}) — ${portfolio.breakdown.healthy} sanas, ${portfolio.breakdown.warning} con alerta, ${portfolio.breakdown.critical} críticas.`;
          if (ctx.readinessDelta != null && ctx.readinessDelta !== 0) {
            line += ` Tendencia: ${ctx.readinessDelta > 0 ? `+${ctx.readinessDelta}` : ctx.readinessDelta} puntos respecto al último corte (${ctx.readinessDelta > 0 ? "mejorando" : "empeorando"}).`;
          }
          return line;
        })(),
        `Hay ${ctx.reviewQueueItems.length} factura(s) que requieren atención del usuario. Las ${top10.length} más urgentes:`,
        ...reviewLines,
        "",
        "INSTRUCCION_REVIEW_QUEUE:",
        "Cuando el usuario pregunte qué revisar, qué tiene pendiente, o pida recomendaciones, usa esta cola de revisión con facturas reales.",
        "Prioriza en el orden mostrado (ya están ordenadas por urgencia).",
        "Para cada factura que menciones, incluye la acción recomendada específica (pagar, revisar, subir comprobante, programar).",
        "Si hay facturas vencidas, enfatiza su urgencia.",
        "Cada factura incluye una consecuencia si el usuario no actúa, una resolución recomendada, y un readiness score (0-100). Prioriza acciones concretas y la mejor resolución para cada caso. Evita respuestas abstractas.",
        "Usa el readiness score como apoyo, no como verdad absoluta. Explícalo de forma simple: un score bajo significa que la factura está en mal estado operativo, uno alto que está bastante lista.",
        "Responde con facturas concretas, NO en abstracto.",
        "",
        "INSTRUCCION_CONFIANZA:",
        "Cada factura tiene un nivel de confianza entre corchetes: [SEGURO], [REVISAR], o [BLOQUEADO].",
        "- SEGURO: datos verificados, la acción se puede ejecutar.",
        "- REVISAR: sugiere al usuario verificar datos antes de actuar.",
        "- BLOQUEADO: faltan datos críticos, NO recomendar ejecutar esa acción.",
        "Usa lenguaje prudente: 'puedes hacerlo con seguridad', 'conviene revisar antes', 'no recomendable sin corregir datos'.",
        "NUNCA ejecutes ni confirmes acciones automáticamente — solo comunica el nivel de riesgo.",
      ].join("\n"),
    );

    // --- Bulk recommendations context ---
    const bulkRecs = getBulkRecommendations(ctx.reviewQueueItems);
    if (bulkRecs.length > 0) {
      const bulkLines = bulkRecs.map((rec) => {
        const totalLabel = rec.total_cop != null ? ` (${formatCopForPrompt(rec.total_cop)} total)` : "";
        const confLabel = confidenceTag[rec.overall_confidence] ?? "REVISAR";
        return `- ${rec.title}${totalLabel} [${confLabel}]`;
      });
      promptSections.push(
        [
          "ACCIONES_EN_LOTE:",
          ...bulkLines,
          "",
          "INSTRUCCION_LOTE:",
          "Si hay acciones en lote disponibles, sugiere al usuario resolverlas en grupo antes de detallar una por una.",
          "Explica por qué conviene y menciona que puede hacerlo desde el dashboard.",
        ].join("\n"),
      );
    }
  }

  // --- Weekly plan context for greetings ---
  if (ctx.financialIntent.reason === "greeting_weekly_plan" && ctx.reviewQueueItems.length > 0) {
    const weeklyPlan = ctx.weeklyPlanPayload ?? buildPaymentPlan(ctx.reviewQueueItems);
    const mp = weeklyPlan.this_week.must_pay;
    const ss = weeklyPlan.this_week.should_schedule;
    const sr = weeklyPlan.this_week.should_review;

    const planLines: string[] = ["PLAN_SEMANAL:", "Esta semana deberías:"];
    if (mp.length > 0) {
      const topMp = mp.slice(0, 3).map((i) => i.supplier_name || "Sin proveedor").join(", ");
      planLines.push(`- Pagar ${mp.length} factura${mp.length !== 1 ? "s" : ""} (${formatCopForPrompt(weeklyPlan.totals.must_pay_total)}) — vencidas o por vencer en 3 días. Principales: ${topMp}.`);
    }
    if (ss.length > 0) {
      const topSs = ss.slice(0, 3).map((i) => i.supplier_name || "Sin proveedor").join(", ");
      planLines.push(`- Programar ${ss.length} factura${ss.length !== 1 ? "s" : ""} (${formatCopForPrompt(weeklyPlan.totals.upcoming_total)}) — vencen esta semana. Principales: ${topSs}.`);
    }
    if (sr.length > 0) {
      planLines.push(`- Revisar ${sr.length} factura${sr.length !== 1 ? "s" : ""} con datos incompletos o sospechosos.`);
    }
    if (mp.length === 0 && ss.length === 0 && sr.length === 0) {
      planLines.push("- No tienes acciones urgentes esta semana. ¡Estás al día!");
    }
    // Cash scenarios (conservative: only outflows, no income estimation)
    const sc = weeklyPlan.cash_scenarios;
    if (sc.pay_and_schedule.outflow_now + sc.pay_and_schedule.outflow_scheduled > 0) {
      planLines.push(
        "",
        "ESCENARIOS_DE_CAJA:",
        `- Si no haces nada: $0 en salidas.`,
        `- Si pagas solo lo urgente: ${formatCopForPrompt(sc.pay_urgent_only.outflow_now)} en salidas.`,
        `- Si pagas y programas todo: ${formatCopForPrompt(sc.pay_and_schedule.outflow_now + sc.pay_and_schedule.outflow_scheduled)} en salidas.`,
      );
    }
    // Top 3 critical actions
    const top3 = applyPreferencesToActions(getTopPriorityActions(ctx.reviewQueueItems), ctx.operatingPrefs);
    if (top3.length > 0) {
      planLines.push(
        "",
        "ACCIONES_CRITICAS:",
        "Empieza tu respuesta mencionando estas acciones críticas (las más urgentes):",
        ...top3.map((item) => {
          const name = item.supplier_name?.trim() || "Sin proveedor";
          const amount = item.total_cop !== null ? formatCopForPrompt(item.total_cop) : "monto no disponible";
          return `- ${name} (${amount}) — readiness ${item.readiness_score}/100 — ${item.recommended_resolution}`;
        }),
      );
    }
    // Weekly goals
    const rawGoals = computeWeeklyGoals(ctx.reviewQueueItems);
    const weeklyGoals = { ...rawGoals, goals: applyPreferencesToGoals(rawGoals.goals, ctx.operatingPrefs) };
    if (weeklyGoals.goals.length > 0) {
      planLines.push(
        "",
        "METAS_SEMANALES:",
        weeklyGoals.headline,
        ...weeklyGoals.goals.map((g) => `- ${g.title}: ${g.description}`),
      );
    }
    // Inaction scenarios
    const inactionData = computeInactionScenarios(ctx.reviewQueueItems, weeklyPlan, weeklyGoals);
    if (inactionData.scenarios.length > 0) {
      planLines.push(
        "",
        "ESCENARIOS_DE_INACCION:",
        inactionData.headline,
        ...inactionData.scenarios.map((s) => `- [${s.severity}] ${s.title}: ${s.description} Efectos: ${s.likely_effects.join("; ")}`),
      );
    }
    planLines.push(
      "",
      "INSTRUCCION_PLAN_SEMANAL:",
      "El usuario te está saludando. Responde empezando por las acciones críticas, luego menciona brevemente las metas de la semana.",
      "No uses formato numerado (1)-(4). Sé breve, directo y cálido.",
      "Menciona las facturas más urgentes por nombre de proveedor y monto.",
      "Si hay escenarios de caja, preséntalos brevemente para que el usuario entienda el impacto de cada opción.",
      "Si hay escenarios de inacción con severidad critical o warning, menciona brevemente qué pasa si el usuario no actúa esta semana.",
      "NUNCA estimes ingresos ni prometas caja futura. Solo impacto de salidas.",
      "Si no hay nada urgente, felicita al usuario.",
    );
    promptSections.push(planLines.join("\n"));
  }

  // Operating preferences context
  if (ctx.operatingPrefs.preferred_view_mode !== "owner" || ctx.operatingPrefs.preferred_action_style !== "balanced" || ctx.operatingPrefs.preferred_weekly_focus || ctx.operatingPrefs.preferred_schedule_day || ctx.operatingPrefs.notes) {
    promptSections.push(buildPreferencesPromptSection(ctx.operatingPrefs));
  }

  // Operational notes context
  if (ctx.operationalNotes.length > 0) {
    promptSections.push(buildNotesPromptSection(ctx.operationalNotes));
  }

  // Assignment responsibilities context
  if (ctx.allInvoicesRaw.length > 0) {
    const assignmentSection = buildAssignmentsPromptSection(ctx.allInvoicesRaw);
    if (assignmentSection) promptSections.push(assignmentSection);
  }

  // IVA context — always inject if user has VAT data, so IVA questions can be answered
  if (ctx.vatUsableCop > 0 || ctx.vatReviewCop > 0 || ctx.vatBlockedCop > 0) {
    promptSections.push(
      [
        "RESUMEN_IVA_DESCONTABLE_CONSERVADOR:",
        `- IVA usable (con criterios conservadores): ${formatCopForPrompt(ctx.vatUsableCop)} (${ctx.vatUsableCount} factura${ctx.vatUsableCount !== 1 ? "s" : ""})`,
        `- IVA en revisión (faltan soportes o datos dudosos): ${formatCopForPrompt(ctx.vatReviewCop)} (${ctx.vatReviewCount} factura${ctx.vatReviewCount !== 1 ? "s" : ""})`,
        `- IVA no usable (factura incompleta): ${formatCopForPrompt(ctx.vatBlockedCop)} (${ctx.vatBlockedCount} factura${ctx.vatBlockedCount !== 1 ? "s" : ""})`,
        "",
        "INSTRUCCION_IVA_CONSERVADOR:",
        "Cuando el usuario pregunte por IVA descontable, usa SOLO estos datos reales.",
        "NUNCA decir que el IVA ya es 100% descontable legalmente.",
        "Usa siempre estas frases:",
        '- "IVA usable con criterios conservadores"',
        '- "IVA en revisión — faltan soportes o hay datos dudosos"',
        '- "IVA no usable todavía — factura incompleta"',
        "Formato recomendado:",
        "## (1) Resumen IVA",
        "## (2) Qué parte está usable",
        "## (3) Qué parte está en revisión o bloqueada",
        "## (4) Siguiente acción recomendada",
        "Si hay IVA en revisión, recomendar: subir comprobante de pago o corregir datos de factura.",
        "Si hay IVA bloqueado, recomendar: completar datos de la factura antes de considerar el IVA.",
        "Siempre priorizar seguridad y revisión ante la duda.",
      ].join("\n"),
    );
  }

  if (
    ctx.financialContextPayload.monthly_inputs_status === "fallback_used" &&
    ctx.financialContextPayload.fallback_monthly_inputs
  ) {
    const currentPeriodLabel = formatPeriodLabelEs(
      ctx.financialContextPayload.period.year,
      ctx.financialContextPayload.period.month,
    );
    const fallbackPeriodLabel = formatPeriodLabelEs(
      ctx.financialContextPayload.fallback_monthly_inputs.period.year,
      ctx.financialContextPayload.fallback_monthly_inputs.period.month,
    );

    promptSections.push(
      [
        "INSTRUCCION_FALLBACK_MENSUAL:",
        `Si usas fallback, debes decir explícitamente: "No veo datos para ${currentPeriodLabel}; estoy usando ${fallbackPeriodLabel}. ¿Confirmas o prefieres actualizar este mes?"`,
      ].join("\n"),
    );
  }

  if (ctx.financialIntent.enabled && ctx.kbSnippetsForModel.length > 0) {
    const kbCfoText = ctx.kbSnippetsForModel
      .map((snippet, index) => {
        return `${index + 1}) ${snippet.title}\n${snippet.content}`;
      })
      .join("\n\n");

    promptSections.push(
      [
        "KB_CFO_SNIPPETS:",
        kbCfoText,
        "INSTRUCCION_KB_CFO:",
        "Usa estos snippets solo si aportan respuesta práctica a la pregunta actual.",
      ].join("\n"),
    );
  }

  if (ctx.financialIntent.reason === "invoices_priority") {
    const invoicesPriorityContext = ctx.invoicesPrioritySummary ?? {
      top_limit: 10,
      unpaid_total: 0,
      unpaid_count: 0,
      overdue_count: 0,
      overdue_total: 0,
      due_next_7d_total: 0,
      due_next_30d_total: 0,
      by_type: {
        impuesto: 0,
        servicio: 0,
      },
      top_unpaid_invoices: [],
      note: ctx.authenticatedUserId
        ? "No hay cuentas por pagar pendientes con datos suficientes."
        : "Usuario no autenticado; no se puede consultar facturas reales.",
    };

    const priorityContext = [
      "ESTRATEGIA_DE_TESORERIA_ACTUAL:",
      `- Facturas vencidas: ${invoicesPriorityContext.overdue_count} (${formatCopForPrompt(invoicesPriorityContext.overdue_total)})`,
      `- Total por pagar en próximos 7 días: ${formatCopForPrompt(invoicesPriorityContext.due_next_7d_total)}`,
      `- Total por pagar en próximos 30 días: ${formatCopForPrompt(invoicesPriorityContext.due_next_30d_total)}`,
      `- CxP tipo impuesto: ${formatCopForPrompt(invoicesPriorityContext.by_type.impuesto)}`,
      `- CxP tipo servicio: ${formatCopForPrompt(invoicesPriorityContext.by_type.servicio)}`,
      "- PRIORIDAD LEGAL SUGERIDA:",
      "  1. Impuestos DIAN (IVA/Retenciones) por riesgo sancionatorio y penal.",
      "  2. Servicios críticos para continuidad operativa.",
      "  3. Proveedores comerciales por antigüedad y cercanía de vencimiento.",
    ].join("\n");

    promptSections.push(
      [
        "INVOICES_PRIORITY_CONTEXT:",
        JSON.stringify(invoicesPriorityContext, null, 2),
        priorityContext,
        "INSTRUCCION_INVOICES_PRIORITY:",
        "Usa este contexto para priorizar pagos sin usar datos bancarios y respetando prioridad legal en Colombia.",
        "Regla legal: obligaciones DIAN (IVA/retenciones) tienen prioridad sobre proveedores comerciales.",
        "Si hay facturas vencidas, priorízalas primero por antigüedad de due_date y luego por tipo (impuesto antes que servicio).",
        "Si no hay due_date en una factura, trátala como prioridad media y sugiere confirmar vencimiento.",
        "Cada factura incluye campo type: impuesto|servicio; úsalo explícitamente en el orden propuesto.",
        "En (2) menciona explícitamente facturas vencidas y próximos 7/30 días usando overdue_count, overdue_total, due_next_7d_total y due_next_30d_total.",
        "En (3) propone un orden de pago operativo priorizando primero impuestos DIAN vencidos, luego servicios críticos, luego demás proveedores.",
        "Formatea montos SIEMPRE en pesos colombianos (COP), por ejemplo: $1.250.000 COP.",
        "Responde SIEMPRE en Markdown con esta estructura exacta:",
        "## (1) Lo que sé",
        "## (2) Cálculo mínimo necesario",
        "## (3) Plan operativo accionable",
        "## (4) Pregunta final",
      ].join("\n"),
    );
  }

  if (ctx.taxIntentDetected) {
    const calcActualJson = JSON.stringify(ctx.calcActualPayload, null, 2);
    const kbResumenJson = JSON.stringify(KB_RESUMEN, null, 2);

    promptSections.push(
      [
        "CALCULO_ACTUAL:",
        calcActualJson,
        "PROFILE_SNAPSHOT:",
        JSON.stringify(ctx.calcActualPayload?.profile_snapshot ?? buildProfileSnapshot(null), null, 2),
        "missing_fields:",
        JSON.stringify(ctx.calcActualPayload?.missing_fields ?? [...REQUIRED_PROFILE_FIELDS]),
        "KB_RESUMEN:",
        kbResumenJson,
        "INSTRUCCION_FISCAL:",
        "Regla 0 (anti-invención): Usa SOLO cifras de FINANCIAL_CONTEXT o CALCULO_ACTUAL; si falta un dato, no inventes.",
        "Regla 1 (modo conversación): ANALISIS_INICIAL = resumen breve de 3-5 bullets. SEGUIMIENTO = empezar con 'Con los nuevos datos…' y recalcular solo lo mínimo (sin repetir resumen completo). Re-resumir solo si hay contradicción entre datos o si el usuario pide explícitamente 'resúmeme todo'.",
        "Regla 2 (foco por obligación): Si el usuario menciona IVA y NO menciona explícitamente renta/impuesto de renta/provisión total, responde SOLO sobre IVA + caja.",
        "Regla 3 (cuándo incluir renta): Solo ejecutar renta/provisión total si el usuario lo pide explícitamente con palabras como: 'renta', 'impuesto de renta', 'provisión total', 'cuánto provisiono total', 'renta neta'.",
        "Regla 4 (presión real antes de dividir):",
        "A) obligacion = iva_to_separate (si pregunta IVA) o total_provision_mvp (solo si el usuario lo pidió explícitamente).",
        "B) faltante_bruto = max(obligacion - liquidez_actual, 0).",
        "C) recursos_movibles = cobros_confirmados + cobros_probables + pagos_diferibles + caja_alternativa + linea_credito_disponible (solo números dados por usuario o en FINANCIAL_CONTEXT).",
        "D) presion_real = max(faltante_bruto - recursos_movibles, 0).",
        "E) SOLO si presion_real > 0: aporte = presion_real / horizonte (días o semanas según lo que dijo el usuario). Si presion_real = 0: no dividir; dar plan de ejecución con calendario simple.",
        "Regla 5 (horizonte y calendario): Si horizonte = N días, usar solo Día 1..Día N. Si horizonte = N semanas, usar solo Semana 1..Semana N. No mezclar unidades ni inventar Día/Semana N+1.",
        "Regla 6 (estrategia operativa): Antes de DIAN, proponer 3 acciones concretas de caja: adelantar cobros, diferir pagos no críticos/renegociar plazos, recortar gasto discrecional inmediato. DIAN solo como último recurso.",
        "Regla 7 (estructura de salida): (1) Lo que sé (breve), (2) Cálculo mínimo necesario, (3) Plan operativo accionable, (4) Máximo 1 pregunta final bloqueante y cerrada si es posible.",
        "Regla 8 (formato obligatorio): Responder SIEMPRE en Markdown usando esta estructura exacta: '## (1) Lo que sé' + bullets, '## (2) Cálculo mínimo necesario', '## (3) Plan operativo accionable', '## (4) Pregunta final'.",
        "Regla 9 (liquidez explícita): Si el usuario dice 'no tengo caja' o 'reventado de caja', tratarlo como liquidez insuficiente; NO decir que no mencionó caja. Pedir monto exacto solo si hace falta para armar cronograma.",
        "Regla 10 (nómina): Prohibido sugerir pago parcial de nómina. Si no alcanza caja, sugerir renegociación de fecha + plan de caja + acciones de liquidez.",
        "Regla 11 (nómina vs IVA): Si preguntan 'nómina o IVA', decidir por vencimiento real: si nómina vence antes, priorizar nómina y crear plan de apartes de IVA; si IVA vence antes, priorizar IVA.",
        "Regla 12 (Markdown): Mantener siempre saltos de línea y secciones separadas con encabezados '## (1)'...'## (4)'.",
        "Seguridad: Nunca sugerir evasión, ocultamiento de ingresos, facturación falsa ni prácticas ilegales."
      ].join("\n"),
    );
  }

  if (ctx.ccKbSnippets.length > 0) {
    const ccText = ctx.ccKbSnippets
      .map((snippet, index) => `${index + 1}) ${snippet.title}\n${snippet.content}`)
      .join("\n\n");
    promptSections.push(
      [
        "KB_CAMARA_COMERCIO:",
        ccText,
        "INSTRUCCION_CC:",
        "Usa esta información para responder preguntas sobre matrícula mercantil, renovación, usuario SII, RUES o Cámara de Comercio.",
        "Recuerda siempre: la Cámara de Comercio NO gestiona obligaciones tributarias (IVA, renta, retenciones) — eso es DIAN.",
      ].join("\n")
    );
  }

  return [
    REGLAS_DE_ORO,
    ventanillaUnicaSystemPrompt,
    "PRIORIDAD_LEGAL_COLOMBIA: En estrategia de tesorería, prioriza deudas DIAN (IVA y retenciones) sobre proveedores comerciales por mayor riesgo legal/sancionatorio. Cuando existan montos, exprésalos en COP con formato colombiano.",
    promptSections.join("\n\n"),
  ].join("\n\n");
}
