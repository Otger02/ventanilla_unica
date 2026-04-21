"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Clock,
  CalendarDays,
  CheckCircle2,
  Bell,
  FileWarning,
  CircleDollarSign,
  Receipt,
  CalendarClock,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ClipboardList,
  Target,
  Eye,
  Upload,
  CreditCard,
  CalendarPlus,
  Settings2,
  UserCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { type ReviewAction, type ReviewQueueItem, type ConfidenceLevel, type ReadinessLevel } from "@/lib/invoices/review-queue-core";
import { getTopPriorityActions } from "@/lib/invoices/review-queue-core";
import { getReviewActionLabel } from "@/lib/invoices/review-actions";
import { useReviewQueueSelection } from "@/hooks/useReviewQueueSelection";
import { BulkActionBar } from "@/components/dashboard/BulkActionBar";
import { BulkScheduleModal } from "@/components/dashboard/BulkScheduleModal";
import type { BulkScheduleResult } from "@/hooks/useBulkSchedule";
import { buildPaymentPlan, type WeeklyPaymentPlan } from "@/lib/invoices/getPaymentPlan";
import { computePortfolioReadiness, type PortfolioReadiness } from "@/lib/invoices/computeReadinessScore";
import { computeWeeklyGoals, type WeeklyGoalsSummary } from "@/lib/invoices/getWeeklyGoals";
import { computeInactionScenarios, type InactionSummary } from "@/lib/invoices/getInactionScenarios";
import { applyPreferencesToActions, applyPreferencesToGoals, DEFAULT_PREFERENCES, type OperatingPreferences } from "@/lib/invoices/applyOperatingPreferences";
import { OperatingPrefsModal } from "@/components/dashboard/OperatingPrefsModal";
import { SharedAccessSection } from "@/components/dashboard/SharedAccessSection";
import { NotesSection } from "@/components/dashboard/NotesSection";

type DashboardSummary = {
  total_unpaid_cop: number;
  overdue_count: number;
  overdue_total_cop: number;
  due_next_7d_total: number;
  due_next_30d_total: number;
  paid_this_month_total: number;
  review_needed_count: number;
};

type AlertItem = {
  id: string;
  type: "overdue" | "due_soon" | "quality" | "no_receipt" | "scheduled_tomorrow" | "vat_review" | "vat_blocked";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  invoice_id: string;
  primary_action: AlertAction;
  secondary_action?: AlertAction;
};

type AlertsResponse = {
  alerts: AlertItem[];
  counts: { total: number; critical: number; warning: number; info: number };
};

type VatSummary = {
  month: string;
  total_invoices_with_vat: number;
  vat_usable_cop: number;
  vat_review_cop: number;
  vat_blocked_cop: number;
  invoices_usable_count: number;
  invoices_review_count: number;
  invoices_blocked_count: number;
  invoices_without_vat_count: number;
};

// AlertAction matches ReviewAction — kept as alias for clarity in alert context
type AlertAction = ReviewAction;

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertCounts, setAlertCounts] = useState({ total: 0, critical: 0, warning: 0, info: 0 });
  const [vatSummary, setVatSummary] = useState<VatSummary | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bulk selection
  const selection = useReviewQueueSelection();
  const [showBulkScheduleModal, setShowBulkScheduleModal] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [showOnlySafe, setShowOnlySafe] = useState(false);
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "mine" | "advisor">("all");
  const prefillDone = useRef(false);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPaymentPlan | null>(null);
  const [portfolioReadiness, setPortfolioReadiness] = useState<PortfolioReadiness | null>(null);
  const [topActions, setTopActions] = useState<ReviewQueueItem[]>([]);
  const [deltaScore, setDeltaScore] = useState<number | null>(null);
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoalsSummary | null>(null);
  const [inactionSummary, setInactionSummary] = useState<InactionSummary | null>(null);
  const [operatingPrefs, setOperatingPrefs] = useState<OperatingPreferences>(DEFAULT_PREFERENCES);
  const [showPrefsModal, setShowPrefsModal] = useState(false);

  // ─── Data loading (extracted so it can be called after bulk actions) ───
  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [summaryRes, alertsRes, vatRes, reviewRes, readinessRes, prefsRes] = await Promise.all([
        fetch("/api/dashboard/summary"),
        fetch("/api/alerts/summary"),
        fetch("/api/vat/summary"),
        fetch("/api/invoices/review-queue"),
        fetch("/api/readiness/history"),
        fetch("/api/operating-preferences"),
      ]);
      const summaryData = await summaryRes.json();
      if (!summaryRes.ok) throw new Error(summaryData.error || "Error cargando resumen");
      setSummary(summaryData as DashboardSummary);

      if (alertsRes.ok) {
        const alertsData = (await alertsRes.json()) as AlertsResponse;
        setAlerts(alertsData.alerts ?? []);
        setAlertCounts(alertsData.counts ?? { total: 0, critical: 0, warning: 0, info: 0 });
      }

      if (vatRes.ok) {
        const vatData = (await vatRes.json()) as VatSummary;
        setVatSummary(vatData);
      }

      // Parse operating preferences
      let prefs = DEFAULT_PREFERENCES;
      if (prefsRes.ok) {
        prefs = (await prefsRes.json()) as OperatingPreferences;
        setOperatingPrefs(prefs);
      }

      if (reviewRes.ok) {
        const reviewData = (await reviewRes.json()) as { items: ReviewQueueItem[]; total: number };
        const freshItems = reviewData.items ?? [];
        setReviewQueue(freshItems);
        const plan = buildPaymentPlan(freshItems);
        setWeeklyPlan(plan);
        setPortfolioReadiness(computePortfolioReadiness(freshItems.map((i) => ({ score: i.readiness_score, level: i.readiness_level, reason: i.readiness_reason }))));
        setTopActions(applyPreferencesToActions(getTopPriorityActions(freshItems), prefs));
        const rawGoals = computeWeeklyGoals(freshItems);
        setWeeklyGoals({ ...rawGoals, goals: applyPreferencesToGoals(rawGoals.goals, prefs) });
        setInactionSummary(computeInactionScenarios(freshItems, plan, rawGoals));
        selection.cleanStale(new Set(freshItems.map((i) => i.invoice_id)));
      }

      if (readinessRes.ok) {
        const readinessData = (await readinessRes.json()) as { delta_score: number | null };
        setDeltaScore(readinessData.delta_score);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, [selection.cleanStale]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // ─── Prefill from chat bulk recommendation ───
  useEffect(() => {
    if (prefillDone.current || isLoading || reviewQueue.length === 0) return;
    prefillDone.current = true;

    try {
      const raw = sessionStorage.getItem("vu_bulk_prefill");
      if (!raw) return;
      sessionStorage.removeItem("vu_bulk_prefill");

      const { kind, invoice_ids } = JSON.parse(raw) as { kind: string; invoice_ids: string[] };
      if (!Array.isArray(invoice_ids)) return;

      const existingIds = new Set(reviewQueue.map((i) => i.invoice_id));
      const matchingItems = reviewQueue.filter(
        (i) => invoice_ids.includes(i.invoice_id) && existingIds.has(i.invoice_id),
      );
      if (matchingItems.length === 0) return;

      selection.selectAll(matchingItems);
      if (kind === "schedule_group") {
        setShowBulkScheduleModal(true);
      }
    } catch {
      sessionStorage.removeItem("vu_bulk_prefill");
    }
  }, [isLoading, reviewQueue, selection]);

  // ─── Bulk handlers ───
  function handleBulkScheduleComplete(result: BulkScheduleResult) {
    setShowBulkScheduleModal(false);
    selection.deselectAll();

    const parts: string[] = [];
    if (result.scheduled > 0) parts.push(`${result.scheduled} programada${result.scheduled !== 1 ? "s" : ""}`);
    if (result.skipped > 0) parts.push(`${result.skipped} omitida${result.skipped !== 1 ? "s" : ""}`);
    if (result.failed > 0) parts.push(`${result.failed} error${result.failed !== 1 ? "es" : ""}`);
    setBulkFeedback(parts.join(", "));
    setTimeout(() => setBulkFeedback(null), 6000);

    void loadDashboard();
  }

  function handleReviewSequential() {
    const reviewItems = reviewQueue.filter(
      (item) =>
        selection.isSelected(item.invoice_id) &&
        item.available_actions.includes("review_invoice"),
    );
    if (reviewItems.length === 0) return;

    const [first, ...rest] = reviewItems;
    if (rest.length > 0) {
      sessionStorage.setItem(
        "vu_bulk_review_queue",
        JSON.stringify(rest.map((i) => i.invoice_id)),
      );
    }
    selection.deselectAll();
    router.push(`/chat?action=review_invoice&invoice=${first.invoice_id}`);
  }

  const isAdvisor = operatingPrefs.preferred_view_mode === "advisor";

  async function handleViewModeToggle(mode: "owner" | "advisor") {
    if (operatingPrefs.preferred_view_mode === mode) return;
    setOperatingPrefs({ ...operatingPrefs, preferred_view_mode: mode });
    try {
      await fetch("/api/operating-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_view_mode: mode }),
      });
      loadDashboard();
    } catch { /* best-effort */ }
  }

  function handleExecuteWeek() {
    if (!weeklyPlan) return;
    const safeSchedule = weeklyPlan.this_week.should_schedule.filter(
      (item) => item.action_confidence.schedule_payment?.level === "safe",
    );
    const safeMustPay = weeklyPlan.this_week.must_pay.filter(
      (item) => item.action_confidence.pay_now?.level === "safe",
    );
    if (safeSchedule.length > 0) {
      selection.selectAll(safeSchedule);
      setShowBulkScheduleModal(true);
    } else if (safeMustPay.length > 0) {
      router.push(`/chat?action=pay_now&invoice=${safeMustPay[0].invoice_id}`);
    }
  }

  const formatCOP = (value: number) =>
    new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <PageShell className="!h-[100dvh] flex flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="flex-none bg-surface border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/chat">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Volver al Chat
            </Button>
          </Link>
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
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-secondary p-0.5">
          <button
            onClick={() => handleViewModeToggle("owner")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${operatingPrefs.preferred_view_mode === "owner" ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            Propietario
          </button>
          <button
            onClick={() => handleViewModeToggle("advisor")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${operatingPrefs.preferred_view_mode === "advisor" ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
          >
            Asesor
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted animate-pulse">
              Cargando datos reales...
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950 p-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        ) : summary ? (
          <>
            {/* Acciones críticas ahora */}
            {topActions.length > 0 && (
              <div className="space-y-3" style={{ order: isAdvisor ? 6 : 1 }}>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  Acciones críticas ahora
                </h2>
                {deltaScore != null && deltaScore !== 0 && (
                  <p className={`text-xs ${deltaScore < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {deltaScore < 0 ? "Tu operación está empeorando. Empieza por las acciones críticas." : "Vas mejorando. Mantén el ritmo."}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {topActions.map((item) => {
                    const label = item.supplier_name || item.invoice_number || `Factura ${item.invoice_id.slice(0, 8)}`;
                    const primaryAction = item.available_actions[0];
                    const PrimaryIcon = reviewActionIcons[primaryAction];
                    return (
                      <div
                        key={item.invoice_id}
                        className={`bg-surface border rounded-xl p-4 shadow-sm flex flex-col gap-2 ${
                          item.readiness_level === "critical" ? "border-red-300 dark:border-red-700" :
                          item.readiness_level === "warning" ? "border-amber-300 dark:border-amber-700" :
                          "border-border"
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
                        <Link href={`/chat?action=${primaryAction}&invoice=${item.invoice_id}`} className="mt-auto">
                          <Button variant="primary" size="sm" className="text-xs w-full gap-1">
                            <PrimaryIcon className="w-3 h-3" />
                            {reviewActionLabels[primaryAction]}
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Metas de esta semana */}
            {weeklyGoals && weeklyGoals.goals.length > 0 && (
              <div className="space-y-3" style={{ order: isAdvisor ? 7 : 2 }}>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Target className="w-5 h-5 text-accent" />
                  Metas de esta semana
                </h2>
                <p className="text-xs text-muted">{weeklyGoals.headline}</p>
                <NotesSection targetType="goal" targetId={null} singleNoteMode />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {weeklyGoals.goals.map((goal) => (
                    <div key={goal.id} className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col gap-2">
                      <p className="text-sm font-semibold text-foreground">{goal.title}</p>
                      <p className="text-xs text-muted">{goal.description}</p>
                      <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5">
                        <div
                          className="bg-accent h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.round(goal.progress_ratio * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted">
                        {goal.current_count}/{goal.target_count} completadas
                      </p>
                      <Link href={goal.kind === "upload_receipts" ? "/dashboard" : "/chat"} className="mt-auto">
                        <Button variant="outline" size="sm" className="text-xs w-full">
                          {goal.recommended_action}
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plan de la semana */}
            {weeklyPlan && (weeklyPlan.this_week.must_pay.length > 0 || weeklyPlan.this_week.should_schedule.length > 0 || weeklyPlan.this_week.should_review.length > 0) && (
              <div className="space-y-4" style={{ order: isAdvisor ? 8 : 3 }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-muted" />
                    Plan de la semana
                  </h2>
                  {(weeklyPlan.this_week.must_pay.some((i) => i.action_confidence.pay_now?.level === "safe") || weeklyPlan.this_week.should_schedule.some((i) => i.action_confidence.schedule_payment?.level === "safe")) && (
                    <Button variant="primary" size="sm" className="text-xs" onClick={handleExecuteWeek}>
                      Ejecutar semana
                    </Button>
                  )}
                </div>
                <NotesSection targetType="weekly_plan" targetId={null} singleNoteMode />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <WeeklyBucket
                    title="Pagar hoy"
                    items={weeklyPlan.this_week.must_pay}
                    total={weeklyPlan.totals.must_pay_total}
                    borderColor="border-red-200 dark:border-red-900/30"
                    bgColor="bg-red-50/50 dark:bg-red-950/30"
                    headerColor="text-red-700 dark:text-red-300"
                    ctaLabel="Ir al chat"
                    onCta={() => {
                      const first = weeklyPlan.this_week.must_pay[0];
                      if (first) router.push(`/chat?action=pay_now&invoice=${first.invoice_id}`);
                    }}
                    formatCOP={formatCOP}
                  />
                  <WeeklyBucket
                    title="Programar"
                    items={weeklyPlan.this_week.should_schedule}
                    total={weeklyPlan.totals.upcoming_total}
                    borderColor="border-amber-200 dark:border-amber-900/30"
                    bgColor="bg-amber-50/50 dark:bg-amber-950/30"
                    headerColor="text-amber-700 dark:text-amber-300"
                    ctaLabel="Programar lote"
                    onCta={() => {
                      selection.selectAll(weeklyPlan.this_week.should_schedule);
                      setShowBulkScheduleModal(true);
                    }}
                    formatCOP={formatCOP}
                  />
                  <WeeklyBucket
                    title="Revisar"
                    items={weeklyPlan.this_week.should_review}
                    borderColor="border-blue-200 dark:border-blue-900/30"
                    bgColor="bg-blue-50/50 dark:bg-blue-950/30"
                    headerColor="text-blue-700 dark:text-blue-300"
                    ctaLabel="Ir a revision"
                    onCta={() => {
                      const first = weeklyPlan.this_week.should_review[0];
                      if (first) router.push(`/chat?action=review_invoice&invoice=${first.invoice_id}`);
                    }}
                    formatCOP={formatCOP}
                  />
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

            {/* Si no actúas esta semana */}
            {inactionSummary && inactionSummary.scenarios.length > 0 && (
              <div className="space-y-3" style={{ order: isAdvisor ? 5 : 4 }}>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Si no actúas esta semana
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

            {/* Preferencias operativas */}
            <div className="space-y-3" style={{ order: isAdvisor ? 9 : 5 }}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-muted" />
                  Preferencias operativas
                </h2>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowPrefsModal(true)}>
                  Editar
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-surface border border-border rounded-xl p-3">
                  <p className="text-[11px] text-muted">Modo</p>
                  <p className="text-sm font-medium text-foreground">
                    {operatingPrefs.preferred_view_mode === "advisor" ? "Asesor" : "Propietario"}
                  </p>
                </div>
                <div className="bg-surface border border-border rounded-xl p-3">
                  <p className="text-[11px] text-muted">Estilo</p>
                  <p className="text-sm font-medium text-foreground">
                    {operatingPrefs.preferred_action_style === "conservative" ? "Conservador" : operatingPrefs.preferred_action_style === "aggressive" ? "Agresivo" : "Equilibrado"}
                  </p>
                </div>
                <div className="bg-surface border border-border rounded-xl p-3">
                  <p className="text-[11px] text-muted">Foco semanal</p>
                  <p className="text-sm font-medium text-foreground">
                    {operatingPrefs.preferred_weekly_focus === "cash" ? "Caja" : operatingPrefs.preferred_weekly_focus === "compliance" ? "Cumplimiento" : operatingPrefs.preferred_weekly_focus === "cleanup" ? "Limpieza" : "—"}
                  </p>
                </div>
                <div className="bg-surface border border-border rounded-xl p-3">
                  <p className="text-[11px] text-muted">Día de programación</p>
                  <p className="text-sm font-medium text-foreground capitalize">
                    {operatingPrefs.preferred_schedule_day ?? "—"}
                  </p>
                </div>
                <div className="bg-surface border border-border rounded-xl p-3">
                  <p className="text-[11px] text-muted">Máx. acciones/semana</p>
                  <p className="text-sm font-medium text-foreground">
                    {operatingPrefs.max_weekly_execution_count ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            {showPrefsModal && (
              <OperatingPrefsModal
                current={operatingPrefs}
                onClose={() => setShowPrefsModal(false)}
                onSaved={(saved) => {
                  setOperatingPrefs(saved);
                  setShowPrefsModal(false);
                  loadDashboard();
                }}
              />
            )}

            {/* Row 1: KPIs principales */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ order: isAdvisor ? 10 : 6 }}>
              {/* Total pendiente */}
              <div className="bg-surface border border-[#EEEEEE] rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-muted">
                    Total Pendiente
                  </h3>
                  <div className="bg-red-100 p-2 rounded-lg">
                    <DollarSign className="w-5 h-5 text-red-600" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-foreground">
                  {formatCOP(summary.total_unpaid_cop)}
                </div>
              </div>

              {/* Vencidas */}
              <div className="bg-surface border border-[#EEEEEE] rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-muted">
                    Vencidas
                  </h3>
                  <div className="bg-amber-100 p-2 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-red-600">
                  {summary.overdue_count}
                </div>
                <p className="text-sm text-muted mt-1">
                  {formatCOP(summary.overdue_total_cop)}
                </p>
              </div>

              {/* Pagado este mes */}
              <div className="bg-surface border border-[#EEEEEE] rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-muted">
                    Pagado Este Mes
                  </h3>
                  <div className="bg-emerald-100 p-2 rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-emerald-600">
                  {formatCOP(summary.paid_this_month_total)}
                </div>
              </div>
            </div>

            {/* Salud operativa */}
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
                    {deltaScore === 0 && (
                      <span className="text-xs font-medium text-muted">Sin cambios</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {portfolioReadiness.level === "critical" ? "Riesgo operativo alto" :
                     portfolioReadiness.level === "warning" ? "Requiere atención" :
                     "Operación sana"}
                    {" · "}
                    {portfolioReadiness.breakdown.healthy} sanas, {portfolioReadiness.breakdown.warning} alerta, {portfolioReadiness.breakdown.critical} críticas
                  </p>
                </div>
              </div>
            )}

            {/* Alerts */}
            {alerts.length > 0 && (
              <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm" style={{ order: isAdvisor ? 4 : 8 }}>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-muted" />
                  Alertas ({alerts.length})
                </h2>
                <div className="space-y-2 max-h-72 overflow-y-auto scroll-panel">
                  {alerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} />
                  ))}
                </div>
              </div>
            )}

            {/* Review Queue */}
            {reviewQueue.length > 0 && (() => {
              const afterSafe = showOnlySafe
                ? reviewQueue.filter((item) => getRowConfidence(item) === "safe")
                : reviewQueue;
              const afterAssignment = assignmentFilter === "all"
                ? afterSafe
                : assignmentFilter === "mine"
                  ? afterSafe.filter((item) => !item.assigned_to_label || item.assigned_to_label.toLowerCase() === "yo")
                  : afterSafe.filter((item) => item.assigned_to_label?.toLowerCase() === "asesor");
              const filteredQueue = [...afterAssignment].sort((a, b) => {
                const aIsMine = !a.assigned_to_label || a.assigned_to_label.toLowerCase() === "yo" ? 0 : 1;
                const bIsMine = !b.assigned_to_label || b.assigned_to_label.toLowerCase() === "yo" ? 0 : 1;
                return aIsMine - bIsMine;
              });

              return (
              <div className="bg-surface border border-border rounded-2xl p-5 shadow-sm" style={{ order: isAdvisor ? 2 : 9 }}>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-accent flex-none"
                    checked={selection.isAllSelected(filteredQueue)}
                    onChange={() =>
                      selection.isAllSelected(filteredQueue)
                        ? selection.deselectAll()
                        : selection.selectAll(filteredQueue)
                    }
                  />
                  <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-muted" />
                    Facturas que requieren acción ({filteredQueue.length})
                  </h2>
                  <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer ml-auto">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-emerald-500"
                      checked={showOnlySafe}
                      onChange={() => setShowOnlySafe((v) => !v)}
                    />
                    Solo seguras
                  </label>
                </div>
                <div className="flex items-center gap-1.5 mb-3">
                  {([["all", "Todas"], ["mine", "Mis tareas"], ["advisor", "Del asesor"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        assignmentFilter === key
                          ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                          : "text-muted hover:text-foreground"
                      }`}
                      onClick={() => setAssignmentFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {bulkFeedback && (
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2 animate-pulse">
                    {bulkFeedback}
                  </p>
                )}

                <div className="mb-2">
                  <NotesSection targetType="review_queue" targetId={null} singleNoteMode />
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto scroll-panel">
                  {filteredQueue.map((item) => (
                    <ReviewQueueRow
                      key={item.invoice_id}
                      item={item}
                      formatCOP={formatCOP}
                      isSelected={selection.isSelected(item.invoice_id)}
                      onToggle={() => selection.toggle(item.invoice_id)}
                    />
                  ))}
                </div>

                {selection.selectedCount > 0 && (
                  <BulkActionBar
                    selectedCount={selection.selectedCount}
                    selectedItems={reviewQueue.filter((i) => selection.isSelected(i.invoice_id))}
                    onSchedule={() => setShowBulkScheduleModal(true)}
                    onReviewSequential={handleReviewSequential}
                    onDeselectAll={selection.deselectAll}
                  />
                )}
              </div>
              );
            })()}

            {/* Bulk Schedule Modal */}
            {showBulkScheduleModal && (
              <BulkScheduleModal
                items={reviewQueue.filter((i) => selection.isSelected(i.invoice_id))}
                onClose={() => setShowBulkScheduleModal(false)}
                onComplete={handleBulkScheduleComplete}
              />
            )}

            {/* IVA del mes */}
            {vatSummary && vatSummary.total_invoices_with_vat > 0 && (
              <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm" style={{ order: isAdvisor ? 3 : 10 }}>
                <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-muted" />
                  IVA del mes ({vatSummary.month})
                </h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">IVA usable</span>
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCOP(vatSummary.vat_usable_cop)}
                      <span className="text-xs text-muted ml-1">({vatSummary.invoices_usable_count})</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">IVA en revision</span>
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {formatCOP(vatSummary.vat_review_cop)}
                      <span className="text-xs text-muted ml-1">({vatSummary.invoices_review_count})</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">IVA no usable</span>
                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                      {formatCOP(vatSummary.vat_blocked_cop)}
                      <span className="text-xs text-muted ml-1">({vatSummary.invoices_blocked_count})</span>
                    </span>
                  </div>
                  {vatSummary.invoices_review_count > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      {vatSummary.invoices_review_count} factura{vatSummary.invoices_review_count !== 1 ? "s" : ""} con IVA pendiente de revision
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Row 2: Horizonte de pagos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ order: 11 }}>
              <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-muted">
                    Vence en 7 dias
                  </h3>
                  <div className="bg-orange-100 dark:bg-orange-900/40 p-2 rounded-lg">
                    <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatCOP(summary.due_next_7d_total)}
                </div>
              </div>

              <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-muted">
                    Vence en 30 dias
                  </h3>
                  <div className="bg-blue-100 dark:bg-blue-900/40 p-2 rounded-lg">
                    <CalendarDays className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatCOP(summary.due_next_30d_total)}
                </div>
              </div>
            </div>

            {/* Row 3: Resumen visual */}
            <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm" style={{ order: 12 }}>
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-muted" />
                Panorama de Tesoreria
              </h2>
              <div className="space-y-3">
                <ProgressRow
                  label="Vencidas"
                  amount={summary.overdue_total_cop}
                  total={summary.total_unpaid_cop}
                  color="bg-red-500"
                  formatCOP={formatCOP}
                />
                <ProgressRow
                  label="Proximos 7 dias"
                  amount={summary.due_next_7d_total}
                  total={summary.total_unpaid_cop}
                  color="bg-orange-500"
                  formatCOP={formatCOP}
                />
                <ProgressRow
                  label="Proximos 30 dias"
                  amount={summary.due_next_30d_total}
                  total={summary.total_unpaid_cop}
                  color="bg-blue-500"
                  formatCOP={formatCOP}
                />
              </div>
            </div>

            {/* Acceso compartido */}
            <div style={{ order: 13 }}>
              <SharedAccessSection />
            </div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

function ProgressRow({
  label,
  amount,
  total,
  color,
  formatCOP,
}: {
  label: string;
  amount: number;
  total: number;
  color: string;
  formatCOP: (v: number) => string;
}) {
  const pct = total > 0 ? Math.min((amount / total) * 100, 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-foreground">
          {formatCOP(amount)}
        </span>
      </div>
      <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const alertIconMap = {
  overdue: CircleDollarSign,
  due_soon: Clock,
  quality: FileWarning,
  no_receipt: Receipt,
  scheduled_tomorrow: CalendarClock,
  vat_review: ShieldCheck,
  vat_blocked: FileWarning,
};

const severityStyles = {
  critical: "bg-white",
  warning: "bg-white",
  info: "border-border bg-surface-secondary",
};

const severityIconStyles = {
  critical: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-muted",
};

const actionLabels: Record<AlertAction, string> = {
  pay_now: getReviewActionLabel("pay_now"),
  review_invoice: getReviewActionLabel("review_invoice"),
  upload_receipt: getReviewActionLabel("upload_receipt"),
  schedule_payment: getReviewActionLabel("schedule_payment"),
};

function AlertRow({ alert }: { alert: AlertItem }) {
  const Icon = alertIconMap[alert.type] ?? AlertTriangle;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 ${severityStyles[alert.severity]}`}
      style={{
        borderLeft: alert.severity === "critical" ? "4px solid #E8001C" : alert.severity === "warning" ? "4px solid #F5A623" : undefined,
        boxShadow: alert.severity !== "info" ? "0 1px 3px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      <Icon className={`w-4 h-4 flex-none ${severityIconStyles[alert.severity]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{alert.title}</p>
        <p className="text-xs text-muted truncate">{alert.description}</p>
      </div>
      <div className="flex-none flex gap-1">
        <Link href={`/chat?action=${alert.primary_action}&invoice=${alert.invoice_id}`}>
          <Button variant="primary" size="sm" className="text-xs whitespace-nowrap">
            {actionLabels[alert.primary_action]}
          </Button>
        </Link>
        {alert.secondary_action && (
          <Link href={`/chat?action=${alert.secondary_action}&invoice=${alert.invoice_id}`}>
            <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap">
              {actionLabels[alert.secondary_action]}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

/* ── Review Queue ── */

const badgeStyles: Record<ReviewQueueItem["badge_color"], string> = {
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  orange: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  grey: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const badgeBorderStyles: Record<ReviewQueueItem["badge_color"], string> = {
  red: "bg-white",
  orange: "bg-white",
  blue: "bg-white",
  grey: "border-border bg-surface-secondary",
};

const priorityLabels: Record<ReviewQueueItem["priority"], string> = {
  overdue: "Vencida",
  incomplete: "Incompleta",
  suspect: "Sospechosa",
  vat_revision: "IVA en revisión",
  no_receipt: "Sin comprobante",
};

const reviewActionIcons: Record<ReviewAction, typeof Eye> = {
  review_invoice: Eye,
  upload_receipt: Upload,
  pay_now: CreditCard,
  schedule_payment: CalendarPlus,
};

const reviewActionLabels: Record<ReviewAction, string> = {
  pay_now: getReviewActionLabel("pay_now"),
  review_invoice: getReviewActionLabel("review_invoice"),
  upload_receipt: getReviewActionLabel("upload_receipt"),
  schedule_payment: getReviewActionLabel("schedule_payment"),
};

const confidenceIcons: Record<ConfidenceLevel, { icon: typeof ShieldCheck; style: string; label: string }> = {
  safe: { icon: ShieldCheck, style: "text-emerald-500", label: "Seguro" },
  review: { icon: ShieldAlert, style: "text-amber-500", label: "Revisar" },
  blocked: { icon: ShieldX, style: "text-red-500", label: "Bloqueado" },
};

function getRowConfidence(item: ReviewQueueItem): ConfidenceLevel {
  const levels = Object.values(item.action_confidence).map((r) => r.level);
  if (levels.includes("blocked")) return "blocked";
  if (levels.includes("review")) return "review";
  return "safe";
}

function ReviewQueueRow({ item, formatCOP, isSelected, onToggle }: { item: ReviewQueueItem; formatCOP: (v: number) => string; isSelected: boolean; onToggle: () => void }) {
  const primaryAction = item.available_actions[0];
  const secondaryAction = item.available_actions.length > 1 ? item.available_actions[1] : undefined;
  const PrimaryIcon = reviewActionIcons[primaryAction];
  const label = item.supplier_name || item.invoice_number || `Factura ${item.invoice_id.slice(0, 8)}`;
  const rowConf = getRowConfidence(item);
  const ConfIcon = confidenceIcons[rowConf];

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 ${badgeBorderStyles[item.badge_color]}`}
      style={{
        borderLeft: item.badge_color === "red" ? "4px solid #E8001C" : item.badge_color === "orange" ? "4px solid #F5A623" : item.badge_color === "blue" ? "4px solid #3B82F6" : undefined,
        boxShadow: item.badge_color !== "grey" ? "0 1px 3px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      <input
        type="checkbox"
        className="w-4 h-4 accent-accent flex-none"
        checked={isSelected}
        onChange={onToggle}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-foreground truncate">{label}</p>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeStyles[item.badge_color]}`}>
            {priorityLabels[item.priority]}
          </span>
          <ConfIcon.icon className={`w-3.5 h-3.5 flex-none ${ConfIcon.style}`} aria-label={ConfIcon.label} />
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
        <p className="text-[11px] text-amber-600 dark:text-amber-400 truncate">
          Si no actúas: {item.consequence_if_ignored}
        </p>
        <p className="text-[11px] text-blue-600 dark:text-blue-400 truncate">
          Qué hacer: {item.recommended_resolution}
        </p>
        {item.total_cop != null && (
          <p className="text-xs font-medium text-foreground mt-0.5">{formatCOP(item.total_cop)}</p>
        )}
      </div>
      <div className="flex-none flex gap-1">
        <Link href={`/chat?action=${primaryAction}&invoice=${item.invoice_id}`}>
          <Button variant="primary" size="sm" className="text-xs whitespace-nowrap gap-1">
            <PrimaryIcon className="w-3 h-3" />
            {reviewActionLabels[primaryAction]}
          </Button>
        </Link>
        {secondaryAction && (
          <Link href={`/chat?action=${secondaryAction}&invoice=${item.invoice_id}`}>
            <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap">
              {reviewActionLabels[secondaryAction]}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

function WeeklyBucket({
  title,
  items,
  total,
  borderColor,
  bgColor,
  headerColor,
  ctaLabel,
  onCta,
  formatCOP,
}: {
  title: string;
  items: ReviewQueueItem[];
  total?: number;
  borderColor: string;
  bgColor: string;
  headerColor: string;
  ctaLabel: string;
  onCta: () => void;
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
        {items.map((item) => {
          const isReview =
            item.action_confidence.pay_now?.level === "review" ||
            item.action_confidence.schedule_payment?.level === "review";
          return (
            <div key={item.invoice_id} className="flex items-center justify-between text-xs">
              <span className="text-foreground truncate max-w-[55%]">
                {item.supplier_name || `Factura ${item.invoice_id.slice(0, 8)}`}
                {isReview && <span className="text-amber-500 ml-1">(revisar primero)</span>}
              </span>
              <span className="text-muted">
                {item.total_cop != null ? formatCOP(item.total_cop) : "-"}
              </span>
            </div>
          );
        })}
      </div>
      {total != null && total > 0 && (
        <p className="text-xs font-medium text-foreground mb-2">Total: {formatCOP(total)}</p>
      )}
      <Button variant="outline" size="sm" className="text-xs w-full" onClick={onCta}>
        {ctaLabel}
      </Button>
    </div>
  );
}
