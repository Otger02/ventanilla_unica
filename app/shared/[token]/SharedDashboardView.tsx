"use client";

import {
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Clock,
  CalendarDays,
  CheckCircle2,
  Bell,
  ShieldCheck,
  ClipboardList,
  Target,
  MessageSquareOff,
  UserCircle,
} from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { NotesSection } from "@/components/dashboard/NotesSection";
import type { OperationalNote } from "@/lib/notes/types";
import type { ReviewQueueItem, ConfidenceLevel } from "@/lib/invoices/review-queue-core";
import type { SharedDashboardData, AlertItem, VatSummary } from "@/lib/shared-views/fetchOwnerDashboardData";

type SharedDashboardViewProps = {
  data: SharedDashboardData;
  accessMode: "read_only" | "advisor_limited";
  sharedWithEmail: string;
};

export function SharedDashboardView({ data, accessMode }: SharedDashboardViewProps) {
  const {
    summary,
    alerts,
    alertCounts,
    vatSummary,
    reviewQueue,
    topActions,
    weeklyPlan,
    weeklyGoals,
    inactionSummary,
    portfolioReadiness,
    deltaScore,
    notes,
  } = data;

  const isAdvisor = accessMode === "advisor_limited";
  const notesFor = (type: string) => notes.filter((n: OperationalNote) => n.target_type === type);
  const bannerLabel = isAdvisor ? "Vista compartida — modo asesor" : "Vista compartida — solo lectura";
  const bannerColor = isAdvisor
    ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
    : "bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400";

  const formatCOP = (value: number) =>
    new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

  return (
    <PageShell className="!h-[100dvh] flex flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="flex-none bg-surface border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
          Resumen Financiero
        </h1>
        {alertCounts.total > 0 && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${alertCounts.critical > 0 ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>
            <Bell className="w-3 h-3" />
            {alertCounts.total}
          </span>
        )}
      </div>

      {/* Banner */}
      <div className={`mx-6 md:mx-8 mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${bannerColor}`}>
        {bannerLabel}
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
        {/* Top Actions (read-only) */}
        {topActions.length > 0 && (
          <div className="space-y-3" style={{ order: isAdvisor ? 6 : 1 }}>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Acciones críticas
            </h2>
            {deltaScore != null && deltaScore !== 0 && (
              <p className={`text-xs ${deltaScore < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {deltaScore < 0 ? "Operación empeorando." : "Mejorando."}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {topActions.map((item) => {
                const label = item.supplier_name || item.invoice_number || `Factura ${item.invoice_id.slice(0, 8)}`;
                return (
                  <div
                    key={item.invoice_id}
                    className={`bg-surface border rounded-xl p-4 shadow-sm flex flex-col gap-2 ${
                      item.readiness_level === "critical" ? "border-red-300 dark:border-red-700" :
                      item.readiness_level === "warning" ? "border-amber-300 dark:border-amber-700" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{label}</p>
                      <span className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        item.readiness_level === "critical" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                        item.readiness_level === "warning" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
                        "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                      }`}>
                        {item.readiness_score}/100
                      </span>
                    </div>
                    {item.total_cop != null && (
                      <p className="text-xs font-medium text-foreground">{formatCOP(item.total_cop)}</p>
                    )}
                    <p className="text-xs text-muted">{item.recommended_resolution}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Weekly Goals (read-only) */}
        {weeklyGoals && weeklyGoals.goals.length > 0 && (
          <div className="space-y-3" style={{ order: isAdvisor ? 7 : 2 }}>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Target className="w-5 h-5 text-accent" />
              Metas de esta semana
            </h2>
            <p className="text-xs text-muted">{weeklyGoals.headline}</p>
            <NotesSection targetType="goal" targetId={null} readOnly singleNoteMode notes={notesFor("goal")} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {weeklyGoals.goals.map((goal) => (
                <div key={goal.id} className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col gap-2">
                  <p className="text-sm font-semibold text-foreground">{goal.title}</p>
                  <p className="text-xs text-muted">{goal.description}</p>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5">
                    <div className="bg-accent h-1.5 rounded-full transition-all" style={{ width: `${Math.round(goal.progress_ratio * 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-muted">{goal.current_count}/{goal.target_count} completadas</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Weekly Plan (read-only, no CTAs) */}
        {weeklyPlan && (weeklyPlan.this_week.must_pay.length > 0 || weeklyPlan.this_week.should_schedule.length > 0 || weeklyPlan.this_week.should_review.length > 0) && (
          <div className="space-y-4" style={{ order: isAdvisor ? 8 : 3 }}>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-muted" />
              Plan de la semana
            </h2>
            <NotesSection targetType="weekly_plan" targetId={null} readOnly singleNoteMode notes={notesFor("weekly_plan")} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ReadOnlyBucket title="Pagar hoy" items={weeklyPlan.this_week.must_pay} total={weeklyPlan.totals.must_pay_total} borderColor="border-red-200 dark:border-red-900/30" bgColor="bg-red-50/50 dark:bg-red-950/30" headerColor="text-red-700 dark:text-red-300" formatCOP={formatCOP} />
              <ReadOnlyBucket title="Programar" items={weeklyPlan.this_week.should_schedule} total={weeklyPlan.totals.upcoming_total} borderColor="border-amber-200 dark:border-amber-900/30" bgColor="bg-amber-50/50 dark:bg-amber-950/30" headerColor="text-amber-700 dark:text-amber-300" formatCOP={formatCOP} />
              <ReadOnlyBucket title="Revisar" items={weeklyPlan.this_week.should_review} borderColor="border-blue-200 dark:border-blue-900/30" bgColor="bg-blue-50/50 dark:bg-blue-950/30" headerColor="text-blue-700 dark:text-blue-300" formatCOP={formatCOP} />
            </div>
            {(weeklyPlan.totals.must_pay_total > 0 || weeklyPlan.totals.upcoming_total > 0) && (
              <div className="rounded-xl border border-border bg-surface p-3 mt-1">
                <p className="text-xs font-medium text-muted mb-2">Escenarios de caja:</p>
                <div className="space-y-1.5">
                  {([
                    { key: "do_nothing" as const, style: "text-zinc-400 dark:text-zinc-500", ring: "" },
                    { key: "pay_urgent_only" as const, style: "text-foreground", ring: "ring-1 ring-emerald-300 dark:ring-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20" },
                    { key: "pay_and_schedule" as const, style: "text-foreground", ring: "" },
                  ] as const).map(({ key, style, ring }) => {
                    const s = weeklyPlan.cash_scenarios[key];
                    const totalOut = s.outflow_now + s.outflow_scheduled;
                    return (
                      <div key={key} className={`flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 ${ring}`}>
                        <span className={style}>
                          {s.label}
                          {key === "pay_urgent_only" && <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">(recomendado)</span>}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className={totalOut > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted"}>
                            {totalOut > 0 ? `-${formatCOP(totalOut)}` : "$0"}
                          </span>
                          {s.resulting_cash != null && (
                            <span className={`text-[10px] ${s.resulting_cash < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                              queda {formatCOP(s.resulting_cash)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Inaction Scenarios */}
        {inactionSummary && inactionSummary.scenarios.length > 0 && (
          <div className="space-y-3" style={{ order: isAdvisor ? 5 : 4 }}>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Si no se actúa esta semana
            </h2>
            <p className="text-xs text-muted">{inactionSummary.headline}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {inactionSummary.scenarios.map((scenario) => {
                const sevColor = scenario.severity === "critical"
                  ? "border-red-200 dark:border-red-900/30 bg-red-50/40 dark:bg-red-950/20"
                  : scenario.severity === "warning"
                    ? "border-amber-200 dark:border-amber-900/30 bg-amber-50/40 dark:bg-amber-950/20"
                    : "border-border bg-surface";
                const sevTextColor = scenario.severity === "critical"
                  ? "text-red-700 dark:text-red-300"
                  : scenario.severity === "warning"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-muted";
                return (
                  <div key={scenario.kind} className={`rounded-xl border p-3 ${sevColor}`}>
                    <p className={`text-sm font-medium ${sevTextColor}`}>{scenario.title}</p>
                    <p className="text-xs text-muted mt-0.5">{scenario.description}</p>
                    <ul className="mt-2 space-y-1">
                      {scenario.likely_effects.map((effect, i) => (
                        <li key={i} className="text-[11px] text-muted flex items-start gap-1.5">
                          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${scenario.severity === "critical" ? "bg-red-400" : "bg-amber-400"}`} />
                          {effect}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ order: isAdvisor ? 10 : 6 }}>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted">Total Pendiente</h3>
              <div className="bg-red-100 dark:bg-red-900/40 p-2 rounded-lg">
                <DollarSign className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground">{formatCOP(summary.total_unpaid_cop)}</div>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted">Vencidas</h3>
              <div className="bg-amber-100 dark:bg-amber-900/40 p-2 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">{summary.overdue_count}</div>
            <p className="text-sm text-muted mt-1">{formatCOP(summary.overdue_total_cop)}</p>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted">Pagado Este Mes</h3>
              <div className="bg-emerald-100 dark:bg-emerald-900/40 p-2 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{formatCOP(summary.paid_this_month_total)}</div>
          </div>
        </div>

        {/* Portfolio Readiness */}
        {portfolioReadiness && (
          <div style={{ order: isAdvisor ? 1 : 7 }} className={`bg-surface border rounded-2xl p-5 shadow-sm flex items-center gap-4 ${
            portfolioReadiness.level === "critical" ? "border-red-300 dark:border-red-700" :
            portfolioReadiness.level === "warning" ? "border-amber-300 dark:border-amber-700" :
            "border-emerald-300 dark:border-emerald-700"
          }`}>
            <div className={`text-3xl font-bold ${
              portfolioReadiness.level === "critical" ? "text-red-600 dark:text-red-400" :
              portfolioReadiness.level === "warning" ? "text-amber-600 dark:text-amber-400" :
              "text-emerald-600 dark:text-emerald-400"
            }`}>
              {portfolioReadiness.score}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                Salud operativa
                {deltaScore != null && deltaScore !== 0 && (
                  <span className={`text-xs font-medium ${deltaScore > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {deltaScore > 0 ? `+${deltaScore}` : deltaScore} · {deltaScore > 0 ? "Mejorando" : "Empeorando"}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                {portfolioReadiness.level === "critical" ? "Riesgo operativo alto" :
                 portfolioReadiness.level === "warning" ? "Requiere atención" : "Operación sana"}
                {" · "}
                {portfolioReadiness.breakdown.healthy} sanas, {portfolioReadiness.breakdown.warning} alerta, {portfolioReadiness.breakdown.critical} críticas
              </p>
            </div>
          </div>
        )}

        {/* Alerts (read-only, no action buttons) */}
        {alerts.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm" style={{ order: isAdvisor ? 4 : 8 }}>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted" />
              Alertas ({alerts.length})
            </h2>
            <div className="space-y-2 max-h-72 overflow-y-auto scroll-panel">
              {alerts.map((alert) => (
                <ReadOnlyAlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          </div>
        )}

        {/* Review Queue (read-only, no checkboxes/buttons) */}
        {reviewQueue.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm" style={{ order: isAdvisor ? 2 : 9 }}>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-muted" />
              Facturas que requieren acción ({reviewQueue.length})
            </h2>
            <NotesSection targetType="review_queue" targetId={null} readOnly singleNoteMode notes={notesFor("review_queue")} />
            <div className="space-y-2 max-h-96 overflow-y-auto scroll-panel">
              {reviewQueue.map((item) => (
                <ReadOnlyReviewRow key={item.invoice_id} item={item} formatCOP={formatCOP} />
              ))}
            </div>
          </div>
        )}

        {/* VAT */}
        {vatSummary && vatSummary.total_invoices_with_vat > 0 && (
          <VatSection vatSummary={vatSummary} formatCOP={formatCOP} isAdvisor={isAdvisor} />
        )}

        {/* Payment Horizon */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ order: 11 }}>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted">Vence en 7 dias</h3>
              <div className="bg-orange-100 dark:bg-orange-900/40 p-2 rounded-lg">
                <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{formatCOP(summary.due_next_7d_total)}</div>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted">Vence en 30 dias</h3>
              <div className="bg-blue-100 dark:bg-blue-900/40 p-2 rounded-lg">
                <CalendarDays className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{formatCOP(summary.due_next_30d_total)}</div>
          </div>
        </div>

        {/* Treasury Panorama */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm" style={{ order: 12 }}>
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-muted" />
            Panorama de Tesorería
          </h2>
          <div className="space-y-3">
            <ProgressRow label="Vencidas" amount={summary.overdue_total_cop} total={summary.total_unpaid_cop} color="bg-red-500" formatCOP={formatCOP} />
            <ProgressRow label="Proximos 7 dias" amount={summary.due_next_7d_total} total={summary.total_unpaid_cop} color="bg-orange-500" formatCOP={formatCOP} />
            <ProgressRow label="Proximos 30 dias" amount={summary.due_next_30d_total} total={summary.total_unpaid_cop} color="bg-blue-500" formatCOP={formatCOP} />
          </div>
        </div>

        {/* Chat disabled */}
        <div className="rounded-xl border border-border bg-surface-secondary p-6 text-center" style={{ order: 13 }}>
          <MessageSquareOff className="w-8 h-8 text-muted mx-auto mb-2" />
          <p className="text-sm text-muted">El chat operativo no está disponible en vista compartida</p>
        </div>
      </div>
    </PageShell>
  );
}

// ─── Sub-components ───

const severityStyles: Record<string, string> = {
  critical: "border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/40",
  warning: "border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/40",
  info: "border-border bg-surface-secondary",
};

function ReadOnlyAlertRow({ alert }: { alert: AlertItem }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${severityStyles[alert.severity] ?? severityStyles.info}`}>
      <AlertTriangle className={`w-4 h-4 flex-none ${
        alert.severity === "critical" ? "text-red-600 dark:text-red-400" :
        alert.severity === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted"
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{alert.title}</p>
        <p className="text-xs text-muted truncate">{alert.description}</p>
      </div>
    </div>
  );
}

const badgeBorderStyles: Record<string, string> = {
  red: "border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/30",
  orange: "border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/30",
  blue: "border-blue-200 bg-blue-50/50 dark:border-blue-900/30 dark:bg-blue-950/30",
  grey: "border-border bg-surface-secondary",
};

const badgeStyles: Record<string, string> = {
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  orange: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  grey: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const priorityLabels: Record<string, string> = {
  overdue: "Vencida",
  incomplete: "Incompleta",
  suspect: "Sospechosa",
  vat_revision: "IVA en revisión",
  no_receipt: "Sin comprobante",
};

function ReadOnlyReviewRow({ item, formatCOP }: { item: ReviewQueueItem; formatCOP: (v: number) => string }) {
  const label = item.supplier_name || item.invoice_number || `Factura ${item.invoice_id.slice(0, 8)}`;

  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${badgeBorderStyles[item.badge_color] ?? badgeBorderStyles.grey}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-foreground truncate">{label}</p>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeStyles[item.badge_color] ?? badgeStyles.grey}`}>
            {priorityLabels[item.priority] ?? item.priority}
          </span>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            item.readiness_level === "critical" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
            item.readiness_level === "warning" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
            "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
          }`}>
            {item.readiness_score}
          </span>
          {item.assigned_to_label && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
              <UserCircle className="w-3 h-3" /> {item.assigned_to_label}
            </span>
          )}
        </div>
        <p className="text-xs text-muted truncate">{item.reason}</p>
        <p className="text-[11px] text-amber-600 dark:text-amber-400 truncate">Si no se actúa: {item.consequence_if_ignored}</p>
        <p className="text-[11px] text-blue-600 dark:text-blue-400 truncate">Qué hacer: {item.recommended_resolution}</p>
        {item.total_cop != null && (
          <p className="text-xs font-medium text-foreground mt-0.5">{formatCOP(item.total_cop)}</p>
        )}
      </div>
    </div>
  );
}

function ReadOnlyBucket({ title, items, total, borderColor, bgColor, headerColor, formatCOP }: {
  title: string; items: ReviewQueueItem[]; total?: number;
  borderColor: string; bgColor: string; headerColor: string;
  formatCOP: (v: number) => string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-2xl border ${borderColor} ${bgColor} p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-semibold ${headerColor}`}>{title}</h3>
        <span className={`text-xs font-medium ${headerColor}`}>{items.length}</span>
      </div>
      <div className="space-y-2 mb-3">
        {items.map((item) => (
          <div key={item.invoice_id} className="flex items-center justify-between text-xs">
            <span className="text-foreground truncate max-w-[55%]">
              {item.supplier_name || `Factura ${item.invoice_id.slice(0, 8)}`}
            </span>
            <span className="text-muted">{item.total_cop != null ? formatCOP(item.total_cop) : "-"}</span>
          </div>
        ))}
      </div>
      {total != null && total > 0 && (
        <p className="text-xs font-medium text-foreground">Total: {formatCOP(total)}</p>
      )}
    </div>
  );
}

function VatSection({ vatSummary, formatCOP, isAdvisor }: { vatSummary: VatSummary; formatCOP: (v: number) => string; isAdvisor: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm" style={{ order: isAdvisor ? 3 : 10 }}>
      <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-muted" />
        IVA del mes ({vatSummary.month})
      </h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">IVA usable</span>
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {formatCOP(vatSummary.vat_usable_cop)} <span className="text-xs text-muted ml-1">({vatSummary.invoices_usable_count})</span>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">IVA en revision</span>
          <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            {formatCOP(vatSummary.vat_review_cop)} <span className="text-xs text-muted ml-1">({vatSummary.invoices_review_count})</span>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">IVA no usable</span>
          <span className="text-sm font-semibold text-red-600 dark:text-red-400">
            {formatCOP(vatSummary.vat_blocked_cop)} <span className="text-xs text-muted ml-1">({vatSummary.invoices_blocked_count})</span>
          </span>
        </div>
        {vatSummary.invoices_review_count > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
            {vatSummary.invoices_review_count} factura{vatSummary.invoices_review_count !== 1 ? "s" : ""} con IVA pendiente de revision
          </p>
        )}
      </div>
    </div>
  );
}

function ProgressRow({ label, amount, total, color, formatCOP }: { label: string; amount: number; total: number; color: string; formatCOP: (v: number) => string }) {
  const pct = total > 0 ? Math.min((amount / total) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-foreground">{formatCOP(amount)}</span>
      </div>
      <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
