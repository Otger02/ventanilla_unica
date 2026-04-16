/**
 * applyOperatingPreferences.ts — Pure presentation layer for operating preferences.
 *
 * Reorders/limits already-computed top actions and weekly goals
 * based on user preferences. No business rule changes.
 */

import type { ReviewQueueItem } from "./review-queue-core";
import type { WeeklyGoal, GoalKind } from "./getWeeklyGoals";

// ─── Types ───

export type OperatingPreferences = {
  preferred_action_style: "conservative" | "balanced" | "aggressive";
  preferred_weekly_focus: "cash" | "compliance" | "cleanup" | null;
  preferred_schedule_day: string | null;
  max_weekly_execution_count: number | null;
  preferred_view_mode: "owner" | "advisor";
  notes: string | null;
};

export const DEFAULT_PREFERENCES: OperatingPreferences = {
  preferred_action_style: "balanced",
  preferred_weekly_focus: null,
  preferred_schedule_day: null,
  max_weekly_execution_count: null,
  preferred_view_mode: "owner",
  notes: null,
};

// ─── Helpers ───

const CONF_ORDER: Record<string, number> = { safe: 0, review: 1, blocked: 2 };

function getPrimaryConfidence(item: ReviewQueueItem): number {
  const primary = item.available_actions[0];
  return CONF_ORDER[item.action_confidence[primary]?.level ?? "review"] ?? 1;
}

/** Stable partition: items matching predicate first, rest in original order */
function stablePartition<T>(arr: T[], predicate: (item: T) => boolean): T[] {
  const front: T[] = [];
  const back: T[] = [];
  for (const item of arr) {
    if (predicate(item)) front.push(item);
    else back.push(item);
  }
  return [...front, ...back];
}

// ─── Main functions ───

export function applyPreferencesToActions(
  topActions: ReviewQueueItem[],
  prefs: OperatingPreferences,
): ReviewQueueItem[] {
  let result = [...topActions];

  if (prefs.preferred_action_style === "aggressive") {
    // Safe-confidence items first
    result = stablePartition(result, (item) => getPrimaryConfidence(item) === 0);
  } else if (prefs.preferred_action_style === "conservative") {
    // Review/blocked items first (user should check these before executing)
    result = stablePartition(result, (item) => getPrimaryConfidence(item) > 0);
  }
  // "balanced" → no reorder

  // View mode: advisor prioritizes review/diagnostic items
  if (prefs.preferred_view_mode === "advisor") {
    const advisorPriorities = new Set(["incomplete", "suspect", "vat_revision", "no_receipt"]);
    result = stablePartition(result, (item) => advisorPriorities.has(item.priority));
  }

  if (prefs.max_weekly_execution_count != null) {
    result = result.slice(0, prefs.max_weekly_execution_count);
  }

  return result;
}

const FOCUS_GOALS: Record<string, GoalKind[]> = {
  cash: ["pay_overdue", "schedule_upcoming"],
  compliance: ["fix_incomplete", "upload_receipts"],
  cleanup: ["fix_incomplete", "improve_readiness"],
};

export function applyPreferencesToGoals(
  goals: WeeklyGoal[],
  prefs: OperatingPreferences,
): WeeklyGoal[] {
  let result = [...goals];

  if (prefs.preferred_weekly_focus) {
    const priorityKinds = FOCUS_GOALS[prefs.preferred_weekly_focus];
    if (priorityKinds) {
      result = stablePartition(result, (g) => priorityKinds.includes(g.kind));
    }
  }

  // View mode: advisor prioritizes diagnostic/preparation goals
  if (prefs.preferred_view_mode === "advisor") {
    const advisorGoals: GoalKind[] = ["fix_incomplete", "upload_receipts", "improve_readiness"];
    result = stablePartition(result, (g) => advisorGoals.includes(g.kind));
  }

  return result;
}

// ─── Prompt section builder ───

const STYLE_LABELS: Record<string, string> = {
  conservative: "conservador",
  balanced: "equilibrado",
  aggressive: "agresivo",
};

const FOCUS_LABELS: Record<string, string> = {
  cash: "caja (pagos y flujo)",
  compliance: "cumplimiento (datos, comprobantes, IVA)",
  cleanup: "limpieza (reducir pendientes)",
};

const VIEW_MODE_LABELS: Record<string, string> = {
  owner: "propietario",
  advisor: "asesor externo",
};

export function buildPreferencesPromptSection(prefs: OperatingPreferences): string {
  const lines: string[] = ["PREFERENCIAS_OPERATIVAS:"];

  lines.push(`- Modo de vista: ${VIEW_MODE_LABELS[prefs.preferred_view_mode] ?? prefs.preferred_view_mode}`);
  lines.push(`- Estilo de acción: ${STYLE_LABELS[prefs.preferred_action_style] ?? prefs.preferred_action_style}`);

  if (prefs.preferred_weekly_focus) {
    lines.push(`- Foco semanal: ${FOCUS_LABELS[prefs.preferred_weekly_focus] ?? prefs.preferred_weekly_focus}`);
  }
  if (prefs.preferred_schedule_day) {
    lines.push(`- Día preferido para programar: ${prefs.preferred_schedule_day}`);
  }
  if (prefs.max_weekly_execution_count != null) {
    lines.push(`- Máximo de acciones sugeridas por semana: ${prefs.max_weekly_execution_count}`);
  }
  if (prefs.notes) {
    lines.push(`- Notas del usuario: "${prefs.notes}"`);
  }

  lines.push(
    "",
    "INSTRUCCION_PREFERENCIAS:",
    "Adapta el tono y el orden de prioridades según las preferencias operativas del usuario.",
    "Si el modo es propietario, sé directo y accionable: qué pagar hoy, qué ejecutar. Di 'paga estas 2 hoy'.",
    "Si el modo es asesor, prioriza diagnóstico: estado general, bloqueos, riesgos, preparación documental, readiness. Di 'hay 5 facturas incompletas que conviene corregir antes de avanzar'.",
    "Si el estilo es conservador, prioriza revisión antes que ejecución rápida. Di 'antes de ejecutar, revisa estas'.",
    "Si el estilo es agresivo, prioriza ejecución de items seguros. Di 'puedes resolver hoy estas seguras'.",
    "Si hay foco semanal, enfatiza metas y acciones de ese foco.",
    "Si hay día preferido, menciónalo al sugerir programación de pagos.",
    "Si hay máximo de acciones, no sugieras más de ese número por semana.",
    "Si hay notas del usuario, respétalas como instrucción adicional.",
    "Estas preferencias NO cambian reglas de negocio, solo presentación y orden.",
  );

  return lines.join("\n");
}
