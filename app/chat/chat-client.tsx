"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, CheckCircle, BarChart3, Clock, Upload, CreditCard, Calendar, Edit3, Shield, ExternalLink, History } from "lucide-react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChatBubble } from "@/components/ui/chat-bubble";
import { Field } from "@/components/ui/field";
import { PageShell } from "@/components/ui/page-shell";
import { SectionCard } from "@/components/ui/section-card";
import { Tabs } from "@/components/ui/tabs";
import { TaxTimeline } from "@/components/ui/tax-timeline";
import { type ReviewAction } from "@/lib/invoices/review-actions";
import { getActionFeedbackMessage } from "@/lib/invoices/review-actions";
import { useInvoiceActionDispatcher, type ActionHandlers } from "@/hooks/useInvoiceActionDispatcher";
import { useOperationalRefresh } from "@/hooks/useOperationalRefresh";

type ConfidenceLevel = "safe" | "review" | "blocked";
type ConfidenceResult = { level: ConfidenceLevel; reason: string };

type RecommendedAction = {
  invoice_id: string;
  supplier_name: string;
  invoice_number: string | null;
  total_cop: number | null;
  due_date: string | null;
  payment_status: "unpaid" | "scheduled";
  action_reason: string;
  available_actions: ReviewAction[];
  confidence: ConfidenceLevel;
  action_confidence: Record<string, ConfidenceResult>;
  consequence_if_ignored?: string;
  recommended_resolution?: string;
  readiness_score?: number;
  readiness_level?: string;
  readiness_reason?: string;
};

type BulkRecommendation = {
  kind: "schedule_group" | "review_group";
  title: string;
  description: string;
  invoice_ids: string[];
  count: number;
  total_cop: number | null;
  reason: string;
  recommended_resolution?: string;
  confidence_summary: { safe_count: number; review_count: number; blocked_count: number };
  overall_confidence: ConfidenceLevel;
};

type WeeklyPlanSummary = {
  this_week: {
    must_pay: { invoice_id: string; supplier_name: string | null; total_cop: number | null }[];
    should_schedule: { invoice_id: string; supplier_name: string | null; total_cop: number | null }[];
    should_review: { invoice_id: string; supplier_name: string | null; total_cop: number | null }[];
  };
  totals: {
    must_pay_total: number;
    upcoming_total: number;
  };
  cash_projection: {
    current_cash?: number;
    after_must_pay: number;
    after_schedule: number;
  };
  cash_scenarios: {
    do_nothing: { outflow_now: number; outflow_scheduled: number; resulting_cash?: number; label: string };
    pay_urgent_only: { outflow_now: number; outflow_scheduled: number; resulting_cash?: number; label: string };
    pay_and_schedule: { outflow_now: number; outflow_scheduled: number; resulting_cash?: number; label: string };
  };
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  recommended_actions?: RecommendedAction[];
  bulk_recommendations?: BulkRecommendation[];
  weekly_plan?: WeeklyPlanSummary | null;
};

type ConfirmActionPayload =
  | {
      type: "schedule_individual";
      invoice_id: string;
      supplier_name: string;
      total_cop: number | null;
      due_date: string | null;
    }
  | {
      type: "schedule_bulk";
      invoice_ids: string[];
      count: number;
      total_cop: number | null;
      title: string;
    };

type ConfirmPhase = "confirm" | "running" | "done";

type ChatClientProps = {
  demoMode: boolean;
  showDemoDebug: boolean;
  demoModeRawEnv: string;
};

type TaxProfileResponse = {
  profile: {
    regimen: "simple" | "ordinario" | "unknown";
    vat_responsible: "yes" | "no" | "unknown";
    provision_style: "conservative" | "balanced" | "aggressive";
    taxpayer_type: "natural" | "juridica" | "unknown";
    legal_type: "sas" | "ltda" | "other" | "unknown";
    vat_periodicity: "bimestral" | "cuatrimestral" | "anual" | "unknown";
    monthly_fixed_costs_cop: number;
    monthly_payroll_cop: number;
    monthly_debt_payments_cop: number;
    municipality: string | null;
    nombre_razon_social: string | null;
    nit_dv: string | null;
    es_esal: boolean | null;
  } | null;
};

type MonthlyInputResponse = {
  input: {
    year: number;
    month: number;
    income_cop: number;
    deductible_expenses_cop: number;
    withholdings_cop: number;
    vat_collected_cop: number;
  } | null;
};

type TaxEstimateResponse = {
  breakdown: {
    totalProvision: number;
    rentaProvision: number;
    ivaProvision: number;
    cashAfterProvision: number;
    riskLevel: "high" | "medium" | "low";
  };
};

type TaxHistoryItem = {
  year: number;
  month: number;
  income_cop: number;
  deductible_expenses_cop: number;
  totalProvision: number;
  cashAfterProvision: number;
  riskLevel: "high" | "medium" | "low";
};

type TaxHistoryResponse = {
  items: TaxHistoryItem[];
};

type ActivityLogItem = {
  id: string;
  activity: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type InvoiceItem = {
  id: string;
  created_at: string;
  status: "pending" | "scheduled" | "paid" | "disputed";
  payment_status: "unpaid" | "scheduled" | "paid";
  total_cop: number | null;
  supplier_name: string | null;
  invoice_number: string | null;
  due_date: string | null;
  scheduled_payment_date: string | null;
  paid_at: string | null;
  payment_method: "transfer" | "pse" | "cash" | "other" | null;
  payment_notes: string | null;
  payment_url: string | null;
  supplier_portal_url: string | null;
  last_payment_opened_at: string | null;
  receipts_count: number;
  filename: string | null;
  size_bytes: number | null;
  extracted_at: string | null;
  extraction_confidence: Record<string, unknown> | null;
  extraction_raw: {
    status?: string;
    [key: string]: unknown;
  } | null;
  data_quality_status: "ok" | "suspect" | "incomplete";
  data_quality_flags: {
    low_confidence?: boolean;
    missing_due_date?: boolean;
    missing_supplier?: boolean;
    suspect_amount?: boolean;
  } | null;
  vat_status: "iva_usable" | "iva_en_revision" | "iva_no_usable" | "sin_iva";
  vat_reason: string | null;
};

type InvoicesResponse = {
  invoices: InvoiceItem[];
};

type InvoiceReceiptItem = {
  id: string;
  original_filename: string | null;
  created_at: string;
};

type InvoiceReceiptsResponse = {
  receipts: InvoiceReceiptItem[];
};

const exampleQuestions = [
  "¿Cuánto debo provisionar para impuestos este mes?",
  "¿Qué gastos puedo deducir como independiente?",
  "¿Estoy listo para contratar a alguien?",
  "¿Qué debo tener al día con la DIAN?",
  "¿Cómo organizo mis finanzas este mes?",
  "¿Qué documentos debería guardar?",
];

function formatAssistantMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").trim().split("\n");
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    const headingMatch = trimmedLine.match(/^(?:\((\d)\)|(\d)\))\s*(.+)$/);

    if (headingMatch) {
      const number = headingMatch[1] || headingMatch[2];
      const headingContent = headingMatch[3].trim();
      let headingTitle = headingContent;
      let headingBody: string | null = null;

      if (headingContent.includes(": - ")) {
        const [titlePart, bodyPart] = headingContent.split(": - ", 2);
        headingTitle = titlePart.trim();
        headingBody = `- ${bodyPart.trim()}`;
      } else if (headingContent.includes(": ")) {
        const [titlePart, bodyPart] = headingContent.split(": ", 2);
        headingTitle = titlePart.trim();
        headingBody = bodyPart.trim();
      }

      headingTitle = headingTitle.replace(/:\s*$/, "").trim();

      if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== "") {
        normalizedLines.push("");
      }

      normalizedLines.push(`## (${number}) ${headingTitle}`);

      if (headingBody) {
        if (headingBody.includes(" - ")) {
          headingBody
            .split(" - ")
            .map((item) => item.trim())
            .filter(Boolean)
            .forEach((item) => normalizedLines.push(`- ${item.replace(/^-\s*/, "")}`));
        } else {
          normalizedLines.push(headingBody);
        }
      }

      continue;
    }

    if (trimmedLine.includes(": - ")) {
      const [prefix, suffix] = trimmedLine.split(": - ", 2);
      const items = suffix
        .split(" - ")
        .map((item) => item.trim())
        .filter(Boolean);

      normalizedLines.push(`${prefix}:`);
      items.forEach((item) => normalizedLines.push(`- ${item}`));
      continue;
    }

    const previousLine = normalizedLines[normalizedLines.length - 1] ?? "";
    if (previousLine.startsWith("## ") && trimmedLine.includes(" - ") && !trimmedLine.startsWith("-")) {
      const items = trimmedLine
        .split(" - ")
        .map((item) => item.trim())
        .filter(Boolean);

      items.forEach((item) => normalizedLines.push(`- ${item}`));
      continue;
    }

    normalizedLines.push(trimmedLine);
  }

  let formatted = normalizedLines.join("\n");
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  return formatted.trim();
}

export function ChatClient({
  demoMode,
  showDemoDebug,
  demoModeRawEnv,
}: ChatClientProps) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingAlertAction, setPendingAlertAction] = useState<{ action: string; invoiceId: string } | null>(() => {
    const action = searchParams.get("action");
    const invoiceId = searchParams.get("invoice");
    return action && invoiceId ? { action, invoiceId } : null;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isLoadingTaxData, setIsLoadingTaxData] = useState(true);
  const [isSavingTaxData, setIsSavingTaxData] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);
  const [taxSuccess, setTaxSuccess] = useState<string | null>(null);
  const [isLoadingEstimate, setIsLoadingEstimate] = useState(true);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<TaxEstimateResponse["breakdown"] | null>(null);
  const [historyMonths, setHistoryMonths] = useState<6 | 12>(6);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<TaxHistoryItem[]>([]);
  const [regimen, setRegimen] = useState<"simple" | "ordinario" | "unknown">("unknown");
  const [vatResponsible, setVatResponsible] = useState<"yes" | "no" | "unknown">("unknown");
  const [provisionStyle, setProvisionStyle] = useState<
    "conservative" | "balanced" | "aggressive"
  >("balanced");
  const [taxpayerType, setTaxpayerType] = useState<"natural" | "juridica" | "unknown">(
    "unknown",
  );
  const [legalType, setLegalType] = useState<"sas" | "ltda" | "other" | "unknown">(
    "unknown",
  );
  const [vatPeriodicity, setVatPeriodicity] = useState<
    "bimestral" | "cuatrimestral" | "anual" | "unknown"
  >("unknown");
  const [monthlyFixedCostsCop, setMonthlyFixedCostsCop] = useState("0");
  const [monthlyPayrollCop, setMonthlyPayrollCop] = useState("0");
  const [monthlyDebtPaymentsCop, setMonthlyDebtPaymentsCop] = useState("0");
  const [municipality, setMunicipality] = useState("");
  const [entityName, setEntityName] = useState<string | null>(null);
  const [entityNit, setEntityNit] = useState<string | null>(null);
  const [isEsal, setIsEsal] = useState<boolean | null>(null);
  const [incomeCop, setIncomeCop] = useState("0");
  const [deductibleExpensesCop, setDeductibleExpensesCop] = useState("0");
  const [withholdingsCop, setWithholdingsCop] = useState("0");
  const [vatCollectedCop, setVatCollectedCop] = useState("0");
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [isUploadingInvoice, setIsUploadingInvoice] = useState(false);
  const [processingInvoiceId, setProcessingInvoiceId] = useState<string | null>(null);
  const [updatingPaymentInvoiceId, setUpdatingPaymentInvoiceId] = useState<string | null>(null);
  const [invoiceProcessStatus, setInvoiceProcessStatus] = useState<Record<string, "processed" | "needs_ocr" | "error">>({});
  const [detailsInvoice, setDetailsInvoice] = useState<InvoiceItem | null>(null);
  const [editingInvoice, setEditingInvoice] = useState(false);
  const [editSupplier, setEditSupplier] = useState("");
  const [editTotal, setEditTotal] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [savingInvoiceEdit, setSavingInvoiceEdit] = useState(false);
  const [invoiceEditMessage, setInvoiceEditMessage] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [scheduleInvoice, setScheduleInvoice] = useState<InvoiceItem | null>(null);
  const [schedulePaymentDate, setSchedulePaymentDate] = useState("");
  const [schedulePaymentMethod, setSchedulePaymentMethod] = useState<"transfer" | "pse" | "cash" | "other">("transfer");
  const [schedulePaymentNotes, setSchedulePaymentNotes] = useState("");
  const [payLinkInvoice, setPayLinkInvoice] = useState<InvoiceItem | null>(null);
  const [payLinkPaymentUrl, setPayLinkPaymentUrl] = useState("");
  const [payLinkSupplierPortalUrl, setPayLinkSupplierPortalUrl] = useState("");
  const [receiptsInvoice, setReceiptsInvoice] = useState<InvoiceItem | null>(null);
  const [invoiceReceipts, setInvoiceReceipts] = useState<InvoiceReceiptItem[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false);
  const [uploadingReceiptInvoiceId, setUploadingReceiptInvoiceId] = useState<string | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [alertCritical, setAlertCritical] = useState(0);
  const [invoiceUploadMessage, setInvoiceUploadMessage] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "datos">("chat");
  const [rightTab, setRightTab] = useState<"urgente" | "facturas" | "fiscal">("urgente");
  const [isDragging, setIsDragging] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const rutInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingRut, setIsUploadingRut] = useState(false);
  const pendingReceiptInvoiceIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<ConfirmActionPayload | null>(null);
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>("confirm");
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string } | null>(null);
  const [confirmProgress, setConfirmProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    if (!detailsInvoice) {
      setActivityLog([]);
      return;
    }
    let cancelled = false;
    setIsLoadingActivity(true);
    fetch(`/api/invoices/${detailsInvoice.id}/activity`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setActivityLog(data.activities ?? []);
      })
      .finally(() => { if (!cancelled) setIsLoadingActivity(false); });
    return () => { cancelled = true; };
  }, [detailsInvoice]);

  async function loadHistory(months: 6 | 12) {
    setIsLoadingHistory(true);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/taxes/history?months=${months}`, { method: "GET" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          (data as { error?: string }).error || "No se pudo cargar el histórico.";
        throw new Error(errorMessage);
      }

      const parsed = data as TaxHistoryResponse;
      setHistoryItems(parsed.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el histórico.";
      setHistoryItems([]);
      setHistoryError(message);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  const loadInvoices = useCallback(async () => {
    if (demoMode) {
      setInvoices([]);
      setInvoicesError(null);
      return;
    }

    setIsLoadingInvoices(true);
    setInvoicesError(null);

    try {
      const response = await fetch("/api/invoices", { method: "GET" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Inicia sesión para ver facturas.");
        }
        throw new Error((data as { error?: string }).error || "No se pudieron cargar facturas.");
      }

      const parsed = data as InvoicesResponse;
      setInvoices(parsed.invoices ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron cargar facturas.";
      setInvoices([]);
      setInvoicesError(message);
    } finally {
      setIsLoadingInvoices(false);
    }
  }, [demoMode]);

  // ─── Centralized alert refresh ───
  const loadAlerts = useCallback(async () => {
    if (demoMode) return;
    try {
      const r = await fetch("/api/alerts/summary");
      if (!r.ok) return;
      const d = (await r.json()) as { counts?: { total?: number; critical?: number } };
      if (d?.counts) {
        setAlertCount(d.counts.total ?? 0);
        setAlertCritical(d.counts.critical ?? 0);
      }
    } catch { /* swallow */ }
  }, [demoMode]);

  // ─── Operational refresh (invoices + alerts in one call) ───
  const { refreshAll } = useOperationalRefresh({
    loadInvoices,
    loadAlerts,
  });

  // ─── Action handlers for dispatcher ───
  const actionHandlers: ActionHandlers = useMemo(() => ({
    handlePayInvoice: (inv) => handlePayInvoice(inv as InvoiceItem),
    openScheduleModal: (inv) => openScheduleModal(inv as InvoiceItem),
    openDetailsModal: (inv) => setDetailsInvoice(inv as InvoiceItem),
    openReceiptsModal: (inv) => loadInvoiceReceipts(inv as InvoiceItem),
  }), []);

  // ─── Unified action dispatcher ───
  const { dispatch: dispatchAction } = useInvoiceActionDispatcher(invoices, actionHandlers);

  useEffect(() => {
    async function loadEstimate() {
      setIsLoadingEstimate(true);
      setEstimateError(null);

      try {
        const response = await fetch("/api/taxes/estimate", { method: "GET" });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const estimateData = data as TaxEstimateResponse;
          setEstimate(estimateData.breakdown);
          return;
        }

        if (response.status === 400) {
          setEstimate(null);
          setEstimateError("Completa tus datos del mes para calcular.");
          return;
        }

        setEstimate(null);
        setEstimateError("No se pudo cargar la provisión estimada.");
      } catch {
        setEstimate(null);
        setEstimateError("No se pudo cargar la provisión estimada.");
      } finally {
        setIsLoadingEstimate(false);
      }
    }

    async function loadTaxData() {
      setIsLoadingTaxData(true);
      setTaxError(null);

      try {
        const [profileResponse, monthlyInputResponse] = await Promise.all([
          fetch("/api/profile/tax-co", { method: "GET" }),
          fetch(`/api/taxes/monthly-input?year=${currentYear}&month=${currentMonth}`, {
            method: "GET",
          }),
        ]);

        if (!profileResponse.ok) {
          const profileError = await profileResponse.json().catch(() => ({}));
          throw new Error(profileError.error || "No se pudo cargar el perfil fiscal.");
        }

        if (!monthlyInputResponse.ok) {
          const monthlyError = await monthlyInputResponse.json().catch(() => ({}));
          throw new Error(monthlyError.error || "No se pudo cargar el resumen mensual.");
        }

        const profileData = (await profileResponse.json()) as TaxProfileResponse;
        const monthlyData = (await monthlyInputResponse.json()) as MonthlyInputResponse;

        if (profileData.profile) {
          setRegimen(profileData.profile.regimen ?? "unknown");
          setVatResponsible(profileData.profile.vat_responsible ?? "unknown");
          setProvisionStyle(profileData.profile.provision_style ?? "balanced");
          setTaxpayerType(profileData.profile.taxpayer_type ?? "unknown");
          setLegalType(profileData.profile.legal_type ?? "unknown");
          setVatPeriodicity(profileData.profile.vat_periodicity ?? "unknown");
          setMonthlyFixedCostsCop(String(profileData.profile.monthly_fixed_costs_cop ?? 0));
          setMonthlyPayrollCop(String(profileData.profile.monthly_payroll_cop ?? 0));
          setMonthlyDebtPaymentsCop(String(profileData.profile.monthly_debt_payments_cop ?? 0));
          setMunicipality(profileData.profile.municipality ?? "");
        }

        if (monthlyData.input) {
          setIncomeCop(String(monthlyData.input.income_cop ?? 0));
          setDeductibleExpensesCop(String(monthlyData.input.deductible_expenses_cop ?? 0));
          setWithholdingsCop(String(monthlyData.input.withholdings_cop ?? 0));
          setVatCollectedCop(String(monthlyData.input.vat_collected_cop ?? 0));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "No se pudieron cargar los datos fiscales.";
        setTaxError(message);
      } finally {
        setIsLoadingTaxData(false);
      }
    }

    async function loadProfile() { const supabase = createBrowserSupabaseClient(); const { data: { session } } = await supabase.auth.getSession(); if (session?.user) { const { data } = await supabase.from("profiles").select("nombre_razon_social, nit").eq("user_id", session.user.id).single(); if (data) { setEntityName(data.nombre_razon_social || "Usuario"); setEntityNit(data.nit || "000000000-0"); } } }

    void loadProfile();
    void loadEstimate();
    void loadTaxData();
    void loadHistory(historyMonths);
    void loadInvoices();
    void loadAlerts();
  }, [currentMonth, currentYear, historyMonths, loadInvoices, loadAlerts]);

  // Dispatch alert action from URL params once invoices are loaded
  useEffect(() => {
    if (!pendingAlertAction || invoices.length === 0) return;
    const inv = invoices.find((i) => i.id === pendingAlertAction.invoiceId);
    if (!inv) return;
    setPendingAlertAction(null);
    // Clear URL params without navigation
    window.history.replaceState(null, "", "/chat");

    const result = dispatchAction(pendingAlertAction.action as ReviewAction, pendingAlertAction.invoiceId);
    if (!result.success) {
      setInvoicesError(result.message);
    }
  }, [pendingAlertAction, invoices, dispatchAction]);

  function formatCop(value: number): string {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function getRiskBadgeClasses(riskLevel: "high" | "medium" | "low"): string {
    if (riskLevel === "high") {
      return "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200";
    }

    if (riskLevel === "medium") {
      return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
    }

    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  }

  function getRiskLabelEs(riskLevel: "high" | "medium" | "low"): string {
    if (riskLevel === "high") {
      return "Alto";
    }

    if (riskLevel === "medium") {
      return "Medio";
    }

    return "Bajo";
  }

  function getMonthLabel(year: number, month: number): string {
    const date = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat("es-CO", { month: "short", year: "2-digit" }).format(date);
  }

  function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function formatDateOnly(value: string | null | undefined): string {
    if (!value) {
      return "—";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }

  function getExtractionStatusLabel(status: "processing" | "processed" | "needs_ocr" | "error" | "pending") {
    if (status === "processing") {
      return "processing";
    }

    if (status === "processed") {
      return "✓ processed";
    }

    if (status === "needs_ocr") {
      return "needs_ocr";
    }

    if (status === "error") {
      return "error";
    }

    return "pending";
  }

  function getExtractionStatusClasses(status: "processing" | "processed" | "needs_ocr" | "error" | "pending") {
    if (status === "processed") {
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
    }

    if (status === "processing") {
      return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200";
    }

    if (status === "needs_ocr") {
      return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
    }

    if (status === "error") {
      return "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200";
    }

    return "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  }

  function getPaymentStatusLabel(status: "unpaid" | "scheduled" | "paid") {
    if (status === "paid") {
      return "paid";
    }

    if (status === "scheduled") {
      return "scheduled";
    }

    return "unpaid";
  }

  function getPaymentStatusClasses(status: "unpaid" | "scheduled" | "paid") {
    if (status === "paid") {
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
    }

    if (status === "scheduled") {
      return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200";
    }

    return "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  }

  function getInvoiceExtractedField(invoice: InvoiceItem, fieldName: string): unknown {
    const extractedFields =
      invoice.extraction_raw && typeof invoice.extraction_raw === "object"
        ? (invoice.extraction_raw.extracted_fields as Record<string, unknown> | undefined)
        : undefined;

    return extractedFields?.[fieldName];
  }

  function getInvoiceConfidence(invoice: InvoiceItem): Record<string, number> {
    const fromRaw =
      invoice.extraction_raw && typeof invoice.extraction_raw === "object"
        ? (invoice.extraction_raw.confidence as Record<string, unknown> | undefined)
        : undefined;

    const source = fromRaw || invoice.extraction_confidence || {};

    const confidence: Record<string, number> = {};

    for (const [key, value] of Object.entries(source)) {
      const numeric = typeof value === "number" ? value : Number(value);

      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
        confidence[key] = numeric;
      }
    }

    return confidence;
  }

  function getInvoiceDueDate(invoice: InvoiceItem): string | null {
    const fromExtraction = getInvoiceExtractedField(invoice, "due_date");
    if (typeof fromExtraction === "string" && fromExtraction.trim()) {
      return fromExtraction;
    }

    if (typeof invoice.due_date === "string" && invoice.due_date.trim()) {
      return invoice.due_date;
    }

    return null;
  }

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || isSending) {
      return;
    }

    setInput("");
    setIsSending(true);
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          message,
        }),
      });

      if (!response.ok) {
        throw new Error("No se pudo enviar el mensaje");
      }

      const data: { conversationId: string; reply: string; recommended_actions?: RecommendedAction[]; bulk_recommendations?: BulkRecommendation[]; weekly_plan?: WeeklyPlanSummary | null } = await response.json();
      setConversationId(data.conversationId);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply,
          recommended_actions: data.recommended_actions,
          bulk_recommendations: data.bulk_recommendations,
          weekly_plan: data.weekly_plan,
        },
      ]);
      if (data.recommended_actions && data.recommended_actions.length > 0) {
        void refreshAll();
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "Hubo un error procesando tu mensaje. Intenta de nuevo.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input);
  }

  async function handleSaveTaxData() {
    setTaxError(null);
    setTaxSuccess(null);
    setIsSavingTaxData(true);

    try {
      const incomeValue = Number(incomeCop || 0);
      const deductibleExpensesValue = Number(deductibleExpensesCop || 0);
      const withholdingsValue = Number(withholdingsCop || 0);
      const vatCollectedValue = Number(vatCollectedCop || 0);
      const monthlyFixedCostsValue = Number(monthlyFixedCostsCop || 0);
      const monthlyPayrollValue = Number(monthlyPayrollCop || 0);
      const monthlyDebtPaymentsValue = Number(monthlyDebtPaymentsCop || 0);

      if (
        !Number.isFinite(incomeValue) ||
        !Number.isFinite(deductibleExpensesValue) ||
        !Number.isFinite(withholdingsValue) ||
        !Number.isFinite(vatCollectedValue) ||
        !Number.isFinite(monthlyFixedCostsValue) ||
        !Number.isFinite(monthlyPayrollValue) ||
        !Number.isFinite(monthlyDebtPaymentsValue)
      ) {
        throw new Error("Los valores del formulario deben ser numericos.");
      }

      if (
        incomeValue < 0 ||
        deductibleExpensesValue < 0 ||
        withholdingsValue < 0 ||
        vatCollectedValue < 0 ||
        monthlyFixedCostsValue < 0 ||
        monthlyPayrollValue < 0 ||
        monthlyDebtPaymentsValue < 0
      ) {
        throw new Error("Los valores no pueden ser negativos.");
      }

      const [profileResponse, monthlyResponse] = await Promise.all([
        fetch("/api/profile/tax-co", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            regimen,
            vat_responsible: vatResponsible,
            provision_style: provisionStyle,
            taxpayer_type: taxpayerType,
            legal_type: taxpayerType === "juridica" ? legalType : "unknown",
            vat_periodicity: vatPeriodicity,
            monthly_fixed_costs_cop: monthlyFixedCostsValue,
            monthly_payroll_cop: monthlyPayrollValue,
            monthly_debt_payments_cop: monthlyDebtPaymentsValue,
            municipality: municipality.trim() || null,
          }),
        }),
        fetch("/api/taxes/monthly-input", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            year: currentYear,
            month: currentMonth,
            income_cop: incomeValue,
            deductible_expenses_cop: deductibleExpensesValue,
            withholdings_cop: withholdingsValue,
            vat_collected_cop: vatCollectedValue,
          }),
        }),
      ]);

      if (!profileResponse.ok) {
        const profileError = await profileResponse.json().catch(() => ({}));
        throw new Error(profileError.error || "No se pudo guardar el perfil fiscal.");
      }

      if (!monthlyResponse.ok) {
        const monthlyError = await monthlyResponse.json().catch(() => ({}));
        throw new Error(monthlyError.error || "No se pudo guardar el resumen mensual.");
      }

      setTaxSuccess("Datos fiscales guardados.");

      try {
        const estimateResponse = await fetch("/api/taxes/estimate", { method: "GET" });
        const estimateData = await estimateResponse.json().catch(() => ({}));

        if (estimateResponse.ok) {
          const parsedEstimateData = estimateData as TaxEstimateResponse;
          setEstimate(parsedEstimateData.breakdown);
          setEstimateError(null);
        } else if (estimateResponse.status === 400) {
          setEstimate(null);
          setEstimateError("Completa tus datos del mes para calcular.");
        } else {
          setEstimate(null);
          setEstimateError("No se pudo cargar la provisión estimada.");
        }
      } catch {
        setEstimate(null);
        setEstimateError("No se pudo cargar la provisión estimada.");
      }

      try {
        const historyResponse = await fetch(`/api/taxes/history?months=${historyMonths}`, {
          method: "GET",
        });
        const historyData = await historyResponse.json().catch(() => ({}));

        if (historyResponse.ok) {
          const parsedHistoryData = historyData as TaxHistoryResponse;
          setHistoryItems(parsedHistoryData.items ?? []);
          setHistoryError(null);
        } else {
          const errorMessage =
            (historyData as { error?: string }).error || "No se pudo cargar el histórico.";
          setHistoryItems([]);
          setHistoryError(errorMessage);
        }
      } catch {
        setHistoryItems([]);
        setHistoryError("No se pudo cargar el histórico.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudieron guardar los datos fiscales.";
      setTaxError(message);
    } finally {
      setIsSavingTaxData(false);
    }
  }

  async function handleInvoiceUpload(file: File) {
    if (isUploadingInvoice || demoMode) {
      return;
    }

    setIsUploadingInvoice(true);
    setInvoicesError(null);
    setInvoiceUploadMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/invoices/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json().catch(() => ({}))) as {
        status?: "created" | "duplicate";
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Inicia sesión para subir facturas.");
        }

        if (response.status === 413) {
          throw new Error("Archivo demasiado grande.");
        }

        throw new Error(data.error || "No se pudo subir la factura.");
      }

      if (data.status === "duplicate") {
        window.alert("Esta factura ya fue cargada anteriormente.");
        setInvoiceUploadMessage("Archivo duplicado: ya existe una factura asociada.");
      } else {
        setInvoiceUploadMessage("Factura cargada correctamente.");
      }
      await refreshAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo subir la factura.";
      setInvoicesError(message);
    } finally {
      setIsUploadingInvoice(false);
    }
  }

  function handleInvoicePickerClick() {
    if (isUploadingInvoice || demoMode) {
      return;
    }

    invoiceInputRef.current?.click();
  }

  function handleInvoiceFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    void handleInvoiceUpload(selectedFile);
    event.target.value = "";
  }

  function getInvoiceDisplayStatus(invoice: InvoiceItem): "processing" | "processed" | "needs_ocr" | "error" | "pending" {
    if (processingInvoiceId === invoice.id) {
      return "processing";
    }

    const localStatus = invoiceProcessStatus[invoice.id];
    if (localStatus) {
      return localStatus;
    }

    const rawStatus = invoice.extraction_raw?.status;
    if (rawStatus === "needs_ocr") {
      return "needs_ocr";
    }

    if (invoice.extracted_at) {
      return "processed";
    }

    return "pending";
  }

  async function handleProcessInvoice(invoiceId: string) {
    if (demoMode || processingInvoiceId) {
      return;
    }

    setProcessingInvoiceId(invoiceId);
    setInvoicesError(null);
    setInvoiceUploadMessage(null);

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/process`, {
        method: "POST",
      });

      const data = (await response.json().catch(() => ({}))) as {
        status?: "processed" | "needs_ocr";
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "No se pudo procesar la factura.");
      }

      const nextStatus = data.status === "needs_ocr" ? "needs_ocr" : "processed";
      setInvoiceProcessStatus((current) => ({ ...current, [invoiceId]: nextStatus }));
      setInvoiceUploadMessage(
        nextStatus === "needs_ocr"
          ? "Factura escaneada o sin texto. Se requiere OCR (pendiente)."
          : "Factura procesada correctamente.",
      );
      await refreshAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo procesar la factura.";
      setInvoiceProcessStatus((current) => ({ ...current, [invoiceId]: "error" }));
      setInvoicesError(message);
    } finally {
      setProcessingInvoiceId(null);
    }
  }

  function openScheduleModal(invoice: InvoiceItem) {
    setScheduleInvoice(invoice);
    setSchedulePaymentDate(invoice.scheduled_payment_date ?? getInvoiceDueDate(invoice) ?? "");
    setSchedulePaymentMethod(invoice.payment_method ?? "transfer");
    setSchedulePaymentNotes(invoice.payment_notes ?? "");
  }

  async function updateInvoicePayment(
    invoiceId: string,
    payload: {
      payment_status?: "unpaid" | "scheduled" | "paid";
      scheduled_payment_date?: string | null;
      paid_at?: string | null;
      payment_method?: "transfer" | "pse" | "cash" | "other" | null;
      payment_notes?: string | null;
      payment_url?: string | null;
      supplier_portal_url?: string | null;
      last_payment_opened_at?: string | null;
    },
  ): Promise<boolean> {
    if (demoMode) {
      return false;
    }

    setUpdatingPaymentInvoiceId(invoiceId);
    setInvoicesError(null);
    setInvoiceUploadMessage(null);

    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "No se pudo actualizar el pago de la factura.");
      }

      await refreshAll();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo actualizar el pago de la factura.";
      setInvoicesError(message);
      return false;
    } finally {
      setUpdatingPaymentInvoiceId(null);
    }
  }

  function openEditMode(invoice: InvoiceItem) {
    setEditSupplier(invoice.supplier_name ?? "");
    setEditTotal(invoice.total_cop !== null ? String(invoice.total_cop) : "");
    setEditDueDate(invoice.due_date ?? "");
    setEditInvoiceNumber(invoice.invoice_number ?? "");
    setEditingInvoice(true);
    setInvoiceEditMessage(null);
  }

  async function handleSaveInvoiceEdit() {
    if (!detailsInvoice || demoMode) return;
    setSavingInvoiceEdit(true);
    setInvoiceEditMessage(null);
    try {
      const payload: Record<string, unknown> = {
        supplier_name: editSupplier.trim() || null,
        total_cop: editTotal.trim() ? Number(editTotal) : null,
        due_date: editDueDate || null,
        invoice_number: editInvoiceNumber.trim() || null,
      };
      const res = await fetch(`/api/invoices/${detailsInvoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; invoice?: Record<string, unknown> };
      if (!res.ok) throw new Error(data.error || "Error guardando cambios.");
      await refreshAll();
      setEditingInvoice(false);
      setInvoiceEditMessage("Factura actualizada");
      // Re-fetch to get updated detailsInvoice
      const refetchRes = await fetch(`/api/invoices`);
      if (refetchRes.ok) {
        const refetchData = (await refetchRes.json()) as InvoicesResponse;
        const updated = (refetchData.invoices ?? []).find((i: InvoiceItem) => i.id === detailsInvoice.id);
        if (updated) setDetailsInvoice(updated);
      }
    } catch (err) {
      setInvoiceEditMessage(err instanceof Error ? err.message : "Error guardando.");
    } finally {
      setSavingInvoiceEdit(false);
    }
  }

  async function handleMarkInvoicePaid(invoice: InvoiceItem) {
    const updated = await updateInvoicePayment(invoice.id, {
      payment_status: "paid",
      payment_method: invoice.payment_method,
      payment_notes: invoice.payment_notes,
    });

    if (updated) {
      setInvoiceUploadMessage("Factura marcada como pagada.");
    }
  }

  async function handleCancelInvoiceSchedule(invoice: InvoiceItem) {
    const updated = await updateInvoicePayment(invoice.id, {
      payment_status: "unpaid",
      scheduled_payment_date: null,
      paid_at: null,
      payment_method: invoice.payment_method,
      payment_notes: invoice.payment_notes,
    });

    if (updated) {
      setInvoiceUploadMessage("Programación cancelada.");
    }
  }

  async function handleSaveInvoiceSchedule() {
    if (!scheduleInvoice) {
      return;
    }

    if (!schedulePaymentDate) {
      setInvoicesError("Debes seleccionar una fecha para programar el pago.");
      return;
    }

    const updated = await updateInvoicePayment(scheduleInvoice.id, {
      payment_status: "scheduled",
      scheduled_payment_date: schedulePaymentDate,
      payment_method: schedulePaymentMethod,
      payment_notes: schedulePaymentNotes || null,
    });

    if (!updated) {
      return;
    }

    setScheduleInvoice(null);
    setSchedulePaymentDate("");
    setSchedulePaymentMethod("transfer");
    setSchedulePaymentNotes("");
    setInvoiceUploadMessage("Pago programado correctamente.");
  }

  // ─── Quick execution (safe actions) ───

  async function executeConfirmedAction() {
    if (!confirmAction || demoMode) return;

    setConfirmPhase("running");

    if (confirmAction.type === "schedule_individual") {
      const paymentDate = confirmAction.due_date ?? new Date().toISOString().slice(0, 10);
      const ok = await updateInvoicePayment(confirmAction.invoice_id, {
        payment_status: "scheduled",
        scheduled_payment_date: paymentDate,
        payment_method: "transfer",
      });
      setConfirmResult({
        success: ok,
        message: ok ? "Pago programado correctamente." : "Error al programar el pago.",
      });
      setConfirmPhase("done");
      return;
    }

    if (confirmAction.type === "schedule_bulk") {
      const ids = confirmAction.invoice_ids;
      const total = ids.length;
      let completed = 0;
      let succeeded = 0;
      let failed = 0;

      setConfirmProgress({ completed: 0, total });

      // Find a sensible default date: earliest due_date from the batch
      const batchInvoices = invoices.filter((inv) => ids.includes(inv.id));
      const dueDates = batchInvoices
        .map((inv) => getInvoiceDueDate(inv))
        .filter((d): d is string => d !== null)
        .sort();
      const paymentDate = dueDates[0] ?? new Date().toISOString().slice(0, 10);

      // Concurrency-limited PATCH (groups of 5)
      const CONCURRENCY = 5;
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((id) =>
            fetch(`/api/invoices/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payment_status: "scheduled",
                scheduled_payment_date: paymentDate,
                payment_method: "transfer",
                payment_notes: null,
              }),
            }).then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r;
            }),
          ),
        );
        for (const r of results) {
          completed++;
          if (r.status === "fulfilled") succeeded++;
          else failed++;
        }
        setConfirmProgress({ completed, total });
      }

      await refreshAll();
      setConfirmResult({
        success: failed === 0,
        message:
          failed === 0
            ? `${succeeded} factura${succeeded !== 1 ? "s" : ""} programada${succeeded !== 1 ? "s" : ""} correctamente.`
            : `${succeeded} programada${succeeded !== 1 ? "s" : ""}, ${failed} con error.`,
      });
      setConfirmPhase("done");
    }
  }

  function closeConfirmation() {
    setConfirmAction(null);
    setConfirmPhase("confirm");
    setConfirmResult(null);
    setConfirmProgress({ completed: 0, total: 0 });
  }

  function openPayLinkModal(invoice: InvoiceItem) {
    setPayLinkInvoice(invoice);
    setPayLinkPaymentUrl(invoice.payment_url ?? "");
    setPayLinkSupplierPortalUrl(invoice.supplier_portal_url ?? "");
  }

  async function handlePayInvoice(invoice: InvoiceItem) {
    const targetUrl = invoice.payment_url || invoice.supplier_portal_url;

    if (!targetUrl) {
      openPayLinkModal(invoice);
      return;
    }

    const updated = await updateInvoicePayment(invoice.id, {
      last_payment_opened_at: new Date().toISOString(),
    });

    if (!updated) {
      return;
    }

    if (typeof window !== "undefined") {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }

    setInvoiceUploadMessage("Cuando termines, marca como pagada o sube comprobante (próximo).");
  }

  async function handleSavePayLinksAndOpen() {
    if (!payLinkInvoice) {
      return;
    }

    const nextPaymentUrl = payLinkPaymentUrl.trim();
    const nextSupplierPortalUrl = payLinkSupplierPortalUrl.trim();

    if (!nextPaymentUrl && !nextSupplierPortalUrl) {
      setInvoicesError("Debes agregar al menos un link de pago o portal del proveedor.");
      return;
    }

    const updated = await updateInvoicePayment(payLinkInvoice.id, {
      payment_url: nextPaymentUrl || null,
      supplier_portal_url: nextSupplierPortalUrl || null,
      last_payment_opened_at: new Date().toISOString(),
    });

    if (!updated) {
      return;
    }

    const targetUrl = nextPaymentUrl || nextSupplierPortalUrl;

    setPayLinkInvoice(null);
    setPayLinkPaymentUrl("");
    setPayLinkSupplierPortalUrl("");

    if (typeof window !== "undefined") {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }

    setInvoiceUploadMessage("Cuando termines, marca como pagada o sube comprobante (próximo).");
  }

  function handleReceiptPickerClick(invoiceId: string) {
    if (demoMode || uploadingReceiptInvoiceId) {
      return;
    }

    pendingReceiptInvoiceIdRef.current = invoiceId;
    invoiceReceiptInputRef.current?.click();
  }

  async function uploadReceiptForInvoice(invoiceId: string, file: File) {
    if (demoMode) {
      return;
    }

    setUploadingReceiptInvoiceId(invoiceId);
    setInvoicesError(null);
    setInvoiceUploadMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      formData.append("invoiceId", invoiceId);
        const response = await fetch(`/api/receipts/upload`, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json().catch(() => ({}))) as {
        status?: "created" | "duplicate";
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 413) {
          throw new Error("Comprobante demasiado grande (máximo 15MB).");
        }

        throw new Error(data.error || "No se pudo subir el comprobante.");
      }

      if (data.status === "duplicate") {
        setInvoiceUploadMessage("Comprobante duplicado: ya existe un archivo igual.");
      } else {
        setInvoiceUploadMessage("Comprobante subido, marcada como pagada ✓");
      }

      await refreshAll();

      if (receiptsInvoice?.id === invoiceId) {
        await loadInvoiceReceipts(receiptsInvoice);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo subir el comprobante.";
      setInvoicesError(message);
    } finally {
      setUploadingReceiptInvoiceId(null);
    }
  }

  function handleReceiptFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    const invoiceId = pendingReceiptInvoiceIdRef.current;

    if (selectedFile && invoiceId) {
      void uploadReceiptForInvoice(invoiceId, selectedFile);
    }

    pendingReceiptInvoiceIdRef.current = null;
    event.target.value = "";
  }

  function handleRutClick() {
    if (demoMode || isUploadingRut) return;
    rutInputRef.current?.click();
  }

  async function handleRutFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      if (rutInputRef.current) {
         rutInputRef.current.value = "";
      }
      return;
    }

    setIsUploadingRut(true);
    setTaxError(null);
    setTaxSuccess(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/profile/upload-rut", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Error al subir el RUT.");
      }

      setTaxSuccess("¡RUT procesado! Tu perfil fiscal ha sido configurado correctamente.");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : "Error desconocido al procesar RUT.");
    } finally {
      setIsUploadingRut(false);
      event.target.value = "";
      if (rutInputRef.current) {
        rutInputRef.current.value = "";
      }
    }
  }

  async function loadInvoiceReceipts(invoice: InvoiceItem) {
    setReceiptsInvoice(invoice);
    setIsLoadingReceipts(true);
    setInvoicesError(null);

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/receipts`, { method: "GET" });
      const data = (await response.json().catch(() => ({}))) as InvoiceReceiptsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "No se pudieron cargar los comprobantes.");
      }

      setInvoiceReceipts(data.receipts ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron cargar los comprobantes.";
      setInvoiceReceipts([]);
      setInvoicesError(message);
    } finally {
      setIsLoadingReceipts(false);
    }
  }

  /** Close details modal and advance to next invoice if sequential bulk review is active. */
  function closeDetailsModal() {
    setDetailsInvoice(null);
    setEditingInvoice(false);
    setInvoiceEditMessage(null);

    try {
      const raw = sessionStorage.getItem("vu_bulk_review_queue");
      if (raw) {
        const remaining: string[] = JSON.parse(raw);
        if (Array.isArray(remaining) && remaining.length > 0) {
          const [nextId, ...rest] = remaining;
          if (rest.length > 0) {
            sessionStorage.setItem("vu_bulk_review_queue", JSON.stringify(rest));
          } else {
            sessionStorage.removeItem("vu_bulk_review_queue");
          }
          // Small delay so the current modal fully closes before the next opens
          setTimeout(() => {
            dispatchAction("review_invoice" as ReviewAction, nextId);
          }, 200);
          return;
        }
        sessionStorage.removeItem("vu_bulk_review_queue");
      }
    } catch {
      sessionStorage.removeItem("vu_bulk_review_queue");
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Use target validation to avoid flickering
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === "application/pdf" || file.type.startsWith("image/"))) {
      void handleInvoiceUpload(file);
    }
  };

  return (
    <PageShell className="!h-[100dvh] flex flex-col overflow-hidden !px-0 !py-0 sm:!px-0 !max-w-none">
      {/* Header de Identidad (Top Bar) */}
      <div className="flex-none bg-surface border-b border-border px-4 md:px-6 py-3 flex items-center justify-between z-50 shadow-sm relative">
        <div>
          {entityName && entityNit ? (
            <>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">{entityName}</h1>
              <p className="text-xs md:text-sm font-medium text-muted">
                NIT: {entityNit} {isEsal ? " | ESAL" : ""}
              </p>
            </>
          ) : (
            <div className="animate-pulse flex flex-col gap-1.5">
               <div className="h-6 w-64 bg-surface-secondary rounded"></div>
               <div className="h-4 w-32 bg-surface-secondary rounded"></div>
            </div>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="hidden md:flex gap-2 bg-accent-soft text-accent border-accent/20 hover:bg-accent/10">
              <BarChart3 className="w-4 h-4" /> Dashboard
              {alertCount > 0 && (
                <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${alertCritical > 0 ? "bg-red-500 text-white" : "bg-amber-500 text-white"}`}>
                  {alertCount}
                </span>
              )}
            </Button>
          </Link>
          <div className="hidden sm:inline-flex items-center justify-center px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-full border border-emerald-200 dark:border-emerald-800">
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Perfil Activo
          </div>
          {!demoMode ? (
            <Button
              type="button"
              onClick={handleSignOut}
              variant="outline"
              size="sm"
              disabled={isSigningOut}
            >
              {isSigningOut ? "Cerrando..." : "Cerrar sesión"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Main Workspace Layout (2 Columnas) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-0 lg:gap-6 p-0 lg:p-6 min-h-0 bg-background">
        
        {/* Mobile Tabs */}
        <div className="col-span-1 lg:hidden flex-none px-4 pt-4">
          <Tabs
            value={mobileTab}
            onChange={(value) => setMobileTab(value as "chat" | "datos")}
            items={[
              { value: "chat", label: "Chat" },
              { value: "datos", label: "Tablero de Acción" },
            ]}
          />
        </div>

        {/* Columna Izquierda: Chat y Drag & Drop (60% - lg:col-span-3) */}
        <div 
          className={`${mobileTab === "chat" ? "flex" : "hidden"} m-4 space-y-0 lg:m-0 lg:col-span-3 lg:flex flex-col relative min-h-0 bg-surface rounded-xl border border-border shadow-sm overflow-hidden`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
             <div className="absolute inset-0 z-50 bg-accent-soft backdrop-blur-[2px] border-2 border-dashed border-accent flex items-center justify-center rounded-xl transition-all">
               <div className="bg-surface px-8 py-6 rounded-2xl shadow-xl flex flex-col items-center border border-border">
                 <FileText className="h-12 w-12 text-accent mb-3 animate-bounce" />
                 <p className="text-xl font-bold text-foreground">Suelta tu factura o recibo aquí</p>
                 <p className="mt-1 text-sm font-medium text-muted">Archivos PDF, PNG, JPG aceptados</p>
               </div>
             </div>
          )}

          <div className="flex-none px-5 py-3.5 border-b border-border flex items-center justify-between bg-surface-secondary">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">Asistente Virtual (CFO)</h2>
              <p className="text-[12px] text-muted mt-0.5">Haz consultas o arrastra documentos al panel.</p>
            </div>
            {demoMode ? (
              <span className="rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
                DEMO MODE
              </span>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto p-5 flex flex-col scroll-panel bg-background">
            {showDemoDebug ? (
              <div className="mb-4 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 shrink-0">
                DEMO DEBUG → process.env.DEMO_MODE: {demoModeRawEnv} | demoMode(): {String(demoMode)}
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-80">
                 <p className="text-[14px] text-zinc-500 dark:text-zinc-400 max-w-[280px]">
                   Hola, soy tu CFO virtual. Tráeme tus dudas tributarias o suelta una factura aquí para empezar.
                 </p>
              </div>
            ) : (
              <ul className="space-y-3">
              {messages.map((messageItem, index) => {
                const renderedContent =
                  messageItem.role === "assistant"
                    ? formatAssistantMarkdown(messageItem.content)
                    : messageItem.content;

                return (
                  <li key={`${messageItem.role}-${index}`}>
                    <ChatBubble
                      role={messageItem.role}
                      content={renderedContent}
                      onCopy={() => {
                        if (typeof window !== "undefined") {
                          void navigator.clipboard?.writeText(renderedContent);
                        }
                      }}
                      onSave={() => {
                        console.info("[chat] save stub", {
                          index,
                          role: messageItem.role,
                        });
                      }}
                    />
                    {messageItem.role === "assistant" &&
                      messageItem.recommended_actions &&
                      messageItem.recommended_actions.length > 0 && (
                        <div className="mt-3 space-y-2 ml-0 max-w-[95%]">
                          {messageItem.recommended_actions.map((action) => {
                            const matchedInvoice = invoices.find((inv) => inv.id === action.invoice_id);
                            const feedback = actionFeedback[action.invoice_id];
                            const isScheduled = action.payment_status === "scheduled" || matchedInvoice?.payment_status === "scheduled";
                            const scheduleLabel = isScheduled ? "Reprogramar" : "Programar";
                            const confLevel = action.confidence ?? "review";
                            const confBadgeStyles: Record<ConfidenceLevel, string> = {
                              safe: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
                              review: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
                              blocked: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
                            };
                            const confLabels: Record<ConfidenceLevel, string> = {
                              safe: "Seguro",
                              review: "Revisar",
                              blocked: "Bloqueado",
                            };
                            const isBlocked = confLevel === "blocked";

                            return (
                              <div
                                key={action.invoice_id}
                                className="flex flex-col gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 p-3"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                      {action.supplier_name}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                      {action.total_cop !== null ? formatCop(action.total_cop) : "Monto desconocido"}
                                      {action.due_date ? ` · Vence: ${formatDateOnly(action.due_date)}` : ""}
                                    </p>
                                    {action.consequence_if_ignored && (
                                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                        Si no actúas: {action.consequence_if_ignored}
                                      </p>
                                    )}
                                    {action.recommended_resolution && (
                                      <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                                        Qué hacer: {action.recommended_resolution}
                                      </p>
                                    )}
                                    {action.readiness_score != null && (
                                      <p className={`text-[11px] mt-0.5 ${action.readiness_level === "critical" ? "text-red-600 dark:text-red-400" : action.readiness_level === "warning" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                        Estado: {action.readiness_score}/100 — {action.readiness_level === "critical" ? "Riesgo alto" : action.readiness_level === "warning" ? "Requiere atención" : "Bastante preparada"}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex gap-1.5 shrink-0">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${confBadgeStyles[confLevel]}`}>
                                      {confLabels[confLevel]}
                                    </span>
                                  </div>
                                </div>
                                {!matchedInvoice ? (
                                  <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">
                                    Factura no sincronizada. Recarga la lista.
                                  </p>
                                ) : isBlocked ? (
                                  <p className="text-xs text-red-500 dark:text-red-400 italic">
                                    Datos incompletos — no se puede ejecutar esta acción.
                                  </p>
                                ) : (
                                  <div className="flex gap-2 flex-wrap">
                                    {action.available_actions.includes("pay_now") && (
                                      <Button
                                        type="button"
                                        variant="primary"
                                        size="sm"
                                        className="text-xs px-3"
                                        disabled={updatingPaymentInvoiceId === action.invoice_id}
                                        onClick={() => {
                                          const result = dispatchAction("pay_now", action.invoice_id);
                                          setActionFeedback((prev) => ({ ...prev, [action.invoice_id]: result.message }));
                                        }}
                                      >
                                        Pagar ahora
                                      </Button>
                                    )}
                                    {action.available_actions.includes("schedule_payment") && (
                                      confLevel === "safe" ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="text-xs px-3 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300"
                                          disabled={updatingPaymentInvoiceId === action.invoice_id}
                                          onClick={() => {
                                            setConfirmAction({
                                              type: "schedule_individual",
                                              invoice_id: action.invoice_id,
                                              supplier_name: action.supplier_name,
                                              total_cop: action.total_cop,
                                              due_date: action.due_date,
                                            });
                                            setConfirmPhase("confirm");
                                          }}
                                        >
                                          Programar ahora
                                        </Button>
                                      ) : (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="text-xs px-3"
                                          disabled={updatingPaymentInvoiceId === action.invoice_id}
                                          onClick={() => {
                                            const result = dispatchAction("schedule_payment", action.invoice_id);
                                            setActionFeedback((prev) => ({ ...prev, [action.invoice_id]: result.message }));
                                          }}
                                        >
                                          {scheduleLabel}
                                        </Button>
                                      )
                                    )}
                                    {action.available_actions.includes("review_invoice") && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs px-3"
                                        onClick={() => {
                                          const result = dispatchAction("review_invoice", action.invoice_id);
                                          setActionFeedback((prev) => ({ ...prev, [action.invoice_id]: result.message }));
                                        }}
                                      >
                                        Ver factura
                                      </Button>
                                    )}
                                    {action.available_actions.includes("upload_receipt") && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs px-3"
                                        onClick={() => {
                                          const result = dispatchAction("upload_receipt", action.invoice_id);
                                          setActionFeedback((prev) => ({ ...prev, [action.invoice_id]: result.message }));
                                        }}
                                      >
                                        Subir comprobante
                                      </Button>
                                    )}
                                  </div>
                                )}
                                {feedback && (
                                  <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 animate-pulse">
                                    {feedback}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    {/* Bulk recommendation cards */}
                    {messageItem.role === "assistant" &&
                      messageItem.bulk_recommendations &&
                      messageItem.bulk_recommendations.length > 0 && (
                        <div className="mt-3 space-y-2 ml-0 max-w-[95%]">
                          {messageItem.bulk_recommendations.map((rec) => {
                            const borderColor =
                              rec.overall_confidence === "safe"
                                ? "border-emerald-300 dark:border-emerald-700"
                                : "border-amber-300 dark:border-amber-700";
                            const confBadge =
                              rec.overall_confidence === "safe"
                                ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
                            const confLabel = rec.overall_confidence === "safe" ? "Seguro" : "Revisar antes";

                            return (
                              <div
                                key={rec.kind}
                                className={`flex flex-col gap-2 rounded-lg border-2 border-dashed ${borderColor} bg-zinc-50 dark:bg-zinc-800/60 p-3`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                      {rec.title}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                      {rec.description}
                                    </p>
                                    {rec.recommended_resolution && (
                                      <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                                        Qué hacer: {rec.recommended_resolution}
                                      </p>
                                    )}
                                  </div>
                                  <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${confBadge}`}>
                                    {confLabel}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                                  {rec.confidence_summary.safe_count > 0 && (
                                    <span className="text-emerald-600 dark:text-emerald-400">{rec.confidence_summary.safe_count} segura{rec.confidence_summary.safe_count !== 1 ? "s" : ""}</span>
                                  )}
                                  {rec.confidence_summary.review_count > 0 && (
                                    <span className="text-amber-600 dark:text-amber-400">{rec.confidence_summary.review_count} a revisar</span>
                                  )}
                                </div>
                                {rec.kind === "schedule_group" && rec.overall_confidence === "safe" ? (
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    className="text-xs px-3 w-fit"
                                    onClick={() => {
                                      setConfirmAction({
                                        type: "schedule_bulk",
                                        invoice_ids: rec.invoice_ids,
                                        count: rec.count,
                                        total_cop: rec.total_cop,
                                        title: rec.title,
                                      });
                                      setConfirmPhase("confirm");
                                    }}
                                  >
                                    Ejecutar lote
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    variant={rec.kind === "schedule_group" ? "primary" : "outline"}
                                    size="sm"
                                    className="text-xs px-3 w-fit"
                                    onClick={() => {
                                      try {
                                        sessionStorage.setItem(
                                          "vu_bulk_prefill",
                                          JSON.stringify({ kind: rec.kind, invoice_ids: rec.invoice_ids }),
                                        );
                                      } catch { /* ignore */ }
                                      router.push("/dashboard");
                                    }}
                                  >
                                    {rec.kind === "schedule_group" ? "Programar en lote" : "Revisar en lote"}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    {/* Weekly plan card */}
                    {messageItem.role === "assistant" &&
                      messageItem.weekly_plan &&
                      (messageItem.weekly_plan.this_week.must_pay.length > 0 ||
                       messageItem.weekly_plan.this_week.should_schedule.length > 0 ||
                       messageItem.weekly_plan.this_week.should_review.length > 0) && (
                        <div className="mt-3 ml-0 max-w-[95%]">
                          <div className="rounded-lg border-2 border-dashed border-blue-300 dark:border-blue-700 bg-zinc-50 dark:bg-zinc-800/60 p-3 space-y-2">
                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              Plan de la semana
                            </p>
                            <div className="space-y-1.5 text-xs">
                              {messageItem.weekly_plan.this_week.must_pay.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-red-500 flex-none" />
                                  <span className="text-zinc-700 dark:text-zinc-300">
                                    {messageItem.weekly_plan.this_week.must_pay.length} por pagar
                                    {messageItem.weekly_plan.totals.must_pay_total > 0 &&
                                      ` (${formatCop(messageItem.weekly_plan.totals.must_pay_total)})`}
                                  </span>
                                </div>
                              )}
                              {messageItem.weekly_plan.this_week.should_schedule.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-none" />
                                  <span className="text-zinc-700 dark:text-zinc-300">
                                    {messageItem.weekly_plan.this_week.should_schedule.length} por programar
                                    {messageItem.weekly_plan.totals.upcoming_total > 0 &&
                                      ` (${formatCop(messageItem.weekly_plan.totals.upcoming_total)})`}
                                  </span>
                                </div>
                              )}
                              {messageItem.weekly_plan.this_week.should_review.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-blue-500 flex-none" />
                                  <span className="text-zinc-700 dark:text-zinc-300">
                                    {messageItem.weekly_plan.this_week.should_review.length} por revisar
                                  </span>
                                </div>
                              )}
                            </div>
                            {messageItem.weekly_plan.cash_scenarios && (messageItem.weekly_plan.cash_scenarios.pay_urgent_only.outflow_now > 0 || messageItem.weekly_plan.cash_scenarios.pay_and_schedule.outflow_scheduled > 0) && (
                              <div className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                <p>Solo lo urgente: <span className="font-medium text-red-600 dark:text-red-400">-{formatCop(messageItem.weekly_plan.cash_scenarios.pay_urgent_only.outflow_now)}</span></p>
                                {messageItem.weekly_plan.cash_scenarios.pay_and_schedule.outflow_scheduled > 0 && (
                                  <p>+ programar todo: <span className="font-medium text-red-600 dark:text-red-400">-{formatCop(messageItem.weekly_plan.cash_scenarios.pay_and_schedule.outflow_now + messageItem.weekly_plan.cash_scenarios.pay_and_schedule.outflow_scheduled)}</span></p>
                                )}
                              </div>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-xs px-3 w-fit"
                              onClick={() => router.push("/dashboard")}
                            >
                              Ver plan completo
                            </Button>
                          </div>
                        </div>
                      )}
                  </li>
                );
              })}
              {isSending ? (
                <li className="max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                  escribiendo...
                </li>
              ) : null}
            </ul>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex-none p-4 pb-5 border-t border-border bg-surface">
            {messages.length === 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Sugerencias rápidas</p>
                <div className="flex flex-wrap gap-2">
                  {exampleQuestions.map((q) => (
                    <button key={q} type="button" onClick={() => void sendMessage(q)} disabled={isSending} className="rounded-full border border-border bg-surface-secondary px-3 py-[5px] text-[12px] font-medium text-muted transition hover:border-accent/30 hover:bg-accent-soft disabled:opacity-60">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2 relative">
               <input
                 value={input}
                 onChange={(event) => setInput(event.target.value)}
                 placeholder="Escribe tu mensaje..."
                 title="Mensaje para el CFO Virtual"
                 className="flex-1 rounded-lg border border-border px-4 py-2.5 text-[14px] text-foreground bg-surface-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 shadow-sm transition-all"
                 disabled={isSending}
               />
               <Button type="submit" variant="primary" size="md" disabled={isSending} className="px-6 rounded-lg font-medium">
                 Enviar
               </Button>
            </form>
          </div>
        </div>

        {/* Columna Derecha: Tablero de Acción (40% - lg:col-span-2) */}
        <div className={`${mobileTab === "datos" ? "flex" : "hidden"} px-4 lg:px-0 lg:col-span-2 lg:flex flex-col min-h-0`}>

          {/* Right panel tabs (desktop) */}
          <div className="flex-none hidden lg:block pb-3">
            <Tabs
              value={rightTab}
              onChange={(value) => setRightTab(value as "urgente" | "facturas" | "fiscal")}
              items={[
                { value: "urgente", label: "Urgente" },
                { value: "facturas", label: "Facturas" },
                { value: "fiscal", label: "Ficha Fiscal" },
              ]}
            />
          </div>

          <div className="flex-1 overflow-y-auto scroll-panel pb-10">

          {(rightTab === "urgente" || !rightTab) && (
          <div className={`${rightTab === "urgente" ? "" : "hidden lg:hidden"}`}>
          <div className="mb-4">
            <TaxTimeline />
          </div>
          </div>
          )}

          <div className={`${rightTab === "facturas" ? "" : "hidden lg:hidden"} flex flex-col gap-5`}>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2 mb-3 px-1">
                <div className="bg-accent-soft p-1.5 rounded-md">
                  <FileText className="w-4 h-4 text-accent" />
                </div>
                Bandeja de Acciones
              </h2>
              
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 border border-border rounded-xl p-4 bg-surface shadow-sm relative">
                <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-foreground">Facturas Pendientes</h3>
                  <Button type="button" variant="outline" size="sm" onClick={handleInvoicePickerClick} disabled={isUploadingInvoice}>
                    {isUploadingInvoice ? "Subiendo..." : "Añadir"}
                  </Button>
                </div>

          {/* DEMO MODE CHECKS */}\n{demoMode ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No disponible en DEMO_MODE.</p>
          ) : (
            <>
              <div className="space-y-2">
                <label htmlFor="invoice-upload-input" className="sr-only">
                  Archivo de factura
                </label>
                <input
                  ref={invoiceInputRef}
                  id="invoice-upload-input"
                  type="file"
                  accept=".pdf,image/*"
                  onChange={handleInvoiceFileChange}
                  title="Seleccionar archivo de factura"
                  className="hidden"
                  disabled={isUploadingInvoice}
                />
                <input
                  ref={invoiceReceiptInputRef}
                  id="invoice-receipt-upload-input"
                  type="file"
                  accept=".pdf,application/pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  onChange={handleReceiptFileChange}
                  title="Seleccionar comprobante PDF"
                  className="hidden"
                  disabled={uploadingReceiptInvoiceId !== null}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="w-full"
                  onClick={handleInvoicePickerClick}
                  disabled={isUploadingInvoice}
                >
                  {isUploadingInvoice ? "Subiendo..." : "Subir factura"}
                </Button>
              </div>

              {invoiceUploadMessage ? (
                <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                  {invoiceUploadMessage}
                </p>
              ) : null}

              {invoicesError ? (
                <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                  {invoicesError}
                </p>
              ) : null}

              {isLoadingInvoices ? (
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Cargando facturas...</p>
              ) : invoices.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No hay facturas cargadas.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...invoices]
                    .sort((a, b) => {
                      // Paid invoices go to the bottom
                      if (a.payment_status === "paid" && b.payment_status !== "paid") return 1;
                      if (a.payment_status !== "paid" && b.payment_status === "paid") return -1;
                      // Then sort by due_date ascending (overdue first)
                      const aDate = getInvoiceDueDate(a);
                      const bDate = getInvoiceDueDate(b);
                      if (!aDate && !bDate) return 0;
                      if (!aDate) return 1;
                      if (!bDate) return -1;
                      return new Date(aDate).getTime() - new Date(bDate).getTime();
                    })
                    .map((invoice) => {
                    const extractionStatus = getInvoiceDisplayStatus(invoice);
                    const dueDate = getInvoiceDueDate(invoice);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    let dueColorClass = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
                    let dueLabel = "Al dia";
                    let diffDays: number | null = null;
                    if (invoice.payment_status === "paid") {
                      dueColorClass = "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
                      dueLabel = "Pagada";
                    } else if (dueDate) {
                      const dDate = new Date(dueDate);
                      dDate.setHours(0, 0, 0, 0);
                      const diffTime = dDate.getTime() - today.getTime();
                      diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      if (diffDays < 0) {
                        dueColorClass = "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
                        dueLabel = `Vencida (${Math.abs(diffDays)}d)`;
                      } else if (diffDays <= 7) {
                        dueColorClass = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
                        dueLabel = `${diffDays}d restantes`;
                      } else {
                        dueColorClass = "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400";
                        dueLabel = `${diffDays}d restantes`;
                      }
                    }

                    return (
                      <Card
                        key={invoice.id}
                        className="flex flex-col rounded-xl border-slate-200 p-4 shadow-sm dark:border-zinc-800"
                      >
                        <div className="mb-4 flex items-start justify-between gap-2">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="flex flex-wrap gap-1">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${dueColorClass}`}
                          >
                            {dueLabel}
                          </span>
                          {invoice.data_quality_status !== "ok" && (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                invoice.data_quality_status === "incomplete"
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              }`}
                            >
                              {invoice.data_quality_status === "incomplete" ? "Incompleta" : "Sospechosa"}
                            </span>
                          )}
                          </div>
                        </div>

                        <div className="mb-4">
                          <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100" title={invoice.supplier_name || "Proveedor"}>
                            {invoice.supplier_name || "Proveedor desconocido"}
                          </h3>
                          <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400" title={invoice.filename || ""}>
                            {invoice.filename || "Sin archivo adjunto"}
                          </p>
                        </div>

                        <div className="mb-4">
                          <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                            {invoice.total_cop !== null ? formatCop(invoice.total_cop) : "�"}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Vence: {formatDateOnly(dueDate)}
                          </div>
                          {invoice.data_quality_status !== "ok" && invoice.data_quality_flags && (
                            <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                              {[
                                invoice.data_quality_flags.missing_due_date && "Sin vencimiento",
                                invoice.data_quality_flags.missing_supplier && "Sin proveedor",
                                invoice.data_quality_flags.suspect_amount && "Monto dudoso",
                                invoice.data_quality_flags.low_confidence && "Baja confianza",
                              ].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>

                        <div className="mt-auto flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => void handlePayInvoice(invoice)}
                              disabled={updatingPaymentInvoiceId === invoice.id || processingInvoiceId === invoice.id}
                            >
                              Pagar
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full text-xs flex items-center justify-center gap-1"
                                onClick={() => handleReceiptPickerClick(invoice.id)}
                                disabled={uploadingReceiptInvoiceId === invoice.id || updatingPaymentInvoiceId === invoice.id || processingInvoiceId === invoice.id}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                {uploadingReceiptInvoiceId === invoice.id ? "Registrando..." : "Registrar Pago"}
                              </Button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => void loadInvoiceReceipts(invoice)}
                                disabled={uploadingReceiptInvoiceId === invoice.id}
                            >
                                Recibos ({invoice.receipts_count})
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => void handleProcessInvoice(invoice.id)}
                              disabled={processingInvoiceId === invoice.id || updatingPaymentInvoiceId === invoice.id}
                            >
                              {processingInvoiceId === invoice.id ? "Procesando..." : "Re-procesar"}
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => openScheduleModal(invoice)}
                              disabled={updatingPaymentInvoiceId === invoice.id}
                            >
                              Programar
                            </Button>
                            {invoice.payment_status === "scheduled" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => void handleCancelInvoiceSchedule(invoice)}
                                disabled={updatingPaymentInvoiceId === invoice.id}
                              >
                                Cancelar
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => void handleMarkInvoicePaid(invoice)}
                                disabled={updatingPaymentInvoiceId === invoice.id || invoice.payment_status === "paid"}
                              >
                                {invoice.payment_status === "paid" ? "Pagada" : "Marcar pagada"}
                              </Button>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => setDetailsInvoice(invoice)}
                          >
                            Ver detalles / Editar
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {detailsInvoice ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl scroll-panel">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">
                        {editingInvoice ? "Editar factura" : "Detalle de extracción"}
                      </h4>
                      <div className="flex items-center gap-2">
                        {!editingInvoice ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => openEditMode(detailsInvoice)}>
                            Editar
                          </Button>
                        ) : null}
                        <Button type="button" variant="ghost" size="sm" onClick={closeDetailsModal}>
                          Cerrar
                        </Button>
                      </div>
                    </div>

                    {invoiceEditMessage ? (
                      <p className={`mb-3 text-xs font-medium ${invoiceEditMessage.startsWith("Error") ? "text-red-500" : "text-emerald-600"}`}>
                        {invoiceEditMessage}
                      </p>
                    ) : null}

                    {detailsInvoice.data_quality_status !== "ok" ? (
                      <div className={`mb-3 rounded-md px-3 py-2 text-xs ${detailsInvoice.data_quality_status === "incomplete" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>
                        Estado: {detailsInvoice.data_quality_status === "incomplete" ? "Incompleta" : "Sospechosa"}
                        {detailsInvoice.data_quality_flags ? ` — ${Object.entries(detailsInvoice.data_quality_flags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ")}` : ""}
                      </div>
                    ) : null}

                    {detailsInvoice.vat_status && detailsInvoice.vat_status !== "sin_iva" ? (
                      <div className={`mb-3 rounded-md px-3 py-2 text-xs flex items-center gap-2 ${
                        detailsInvoice.vat_status === "iva_usable"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : detailsInvoice.vat_status === "iva_en_revision"
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                      }`}>
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          detailsInvoice.vat_status === "iva_usable" ? "bg-emerald-500"
                          : detailsInvoice.vat_status === "iva_en_revision" ? "bg-amber-500"
                          : "bg-red-500"
                        }`} />
                        IVA: {detailsInvoice.vat_status === "iva_usable" ? "Usable" : detailsInvoice.vat_status === "iva_en_revision" ? "En revisión" : "No usable"}
                        {detailsInvoice.vat_reason ? ` — ${detailsInvoice.vat_reason}` : ""}
                      </div>
                    ) : null}

                    {editingInvoice ? (
                      <div className="space-y-3 text-sm">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted">Proveedor</label>
                          <input type="text" value={editSupplier} onChange={(e) => setEditSupplier(e.target.value)} className="w-full border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground rounded-md" disabled={savingInvoiceEdit} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted">Total COP</label>
                          <input type="number" value={editTotal} onChange={(e) => setEditTotal(e.target.value)} className="w-full border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground rounded-md" disabled={savingInvoiceEdit} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted">Vencimiento</label>
                          <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="w-full border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground rounded-md" disabled={savingInvoiceEdit} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted">Número de factura</label>
                          <input type="text" value={editInvoiceNumber} onChange={(e) => setEditInvoiceNumber(e.target.value)} className="w-full border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground rounded-md" disabled={savingInvoiceEdit} />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button type="button" variant="primary" size="sm" onClick={handleSaveInvoiceEdit} disabled={savingInvoiceEdit}>
                            {savingInvoiceEdit ? "Guardando..." : "Guardar"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingInvoice(false); setInvoiceEditMessage(null); }} disabled={savingInvoiceEdit}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Proveedor:</span> {String(getInvoiceExtractedField(detailsInvoice, "supplier_name") ?? detailsInvoice.supplier_name ?? "—")}</div>
                        <div><span className="font-medium">NIT:</span> {String(getInvoiceExtractedField(detailsInvoice, "supplier_tax_id") ?? "—")}</div>
                        <div><span className="font-medium">Factura #:</span> {String(getInvoiceExtractedField(detailsInvoice, "invoice_number") ?? detailsInvoice.invoice_number ?? "—")}</div>
                        <div><span className="font-medium">Fecha emisión:</span> {String(getInvoiceExtractedField(detailsInvoice, "issue_date") ?? "—")}</div>
                        <div><span className="font-medium">Vence:</span> {String(getInvoiceExtractedField(detailsInvoice, "due_date") ?? getInvoiceDueDate(detailsInvoice) ?? "—")}</div>
                        <div><span className="font-medium">Subtotal:</span> {(() => { const v = getInvoiceExtractedField(detailsInvoice, "subtotal_cop"); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? formatCop(n) : "—"; })()}</div>
                        <div><span className="font-medium">IVA:</span> {(() => { const v = getInvoiceExtractedField(detailsInvoice, "iva_cop"); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? formatCop(n) : "—"; })()}</div>
                        <div><span className="font-medium">Total:</span> {detailsInvoice.total_cop !== null ? formatCop(detailsInvoice.total_cop) : (() => { const v = getInvoiceExtractedField(detailsInvoice, "total_cop"); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? formatCop(n) : "—"; })()}</div>
                        <div><span className="font-medium">Moneda:</span> {String(getInvoiceExtractedField(detailsInvoice, "currency") ?? "—")}</div>
                      </div>
                    )}

                    <div className="mt-4 rounded-md border border-border p-3 text-xs">
                      <p className="mb-2 font-semibold">Confidence</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {Object.entries(getInvoiceConfidence(detailsInvoice)).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <span className="text-muted">{key}</span>
                            <span className="font-medium">{value.toFixed(2)}</span>
                          </div>
                        ))}
                        {Object.keys(getInvoiceConfidence(detailsInvoice)).length === 0 ? (
                          <p className="text-muted">Sin confidence disponible.</p>
                        ) : null}
                      </div>
                    </div>

                    {/* Activity timeline */}
                    <div className="mt-4 rounded-md border border-border p-3 text-xs">
                      <p className="mb-2 font-semibold flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-muted" />
                        Historial
                      </p>
                      {isLoadingActivity ? (
                        <p className="text-muted animate-pulse">Cargando...</p>
                      ) : activityLog.length === 0 ? (
                        <p className="text-muted">Sin actividad registrada.</p>
                      ) : (
                        <div className="space-y-2">
                          {activityLog.map((entry) => (
                            <ActivityTimelineRow key={entry.id} entry={entry} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {scheduleInvoice ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Programar pago</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setScheduleInvoice(null)}
                        disabled={updatingPaymentInvoiceId === scheduleInvoice.id}
                      >
                        Cerrar
                      </Button>
                    </div>

                    <div className="space-y-3 text-sm">
                      <p className="text-zinc-600 dark:text-zinc-300">{scheduleInvoice.filename ?? "Factura"}</p>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Fecha</label>
                        <input
                          type="date"
                          value={schedulePaymentDate}
                          onChange={(event) => setSchedulePaymentDate(event.target.value)}
                          title="Fecha programada de pago"
                          className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Método</label>
                        <select
                          value={schedulePaymentMethod}
                          onChange={(event) =>
                            setSchedulePaymentMethod(event.target.value as "transfer" | "pse" | "cash" | "other")
                          }
                          title="Método de pago programado"
                          className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
                        >
                          <option value="transfer">transfer</option>
                          <option value="pse">pse</option>
                          <option value="cash">cash</option>
                          <option value="other">other</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Notas</label>
                        <textarea
                          value={schedulePaymentNotes}
                          onChange={(event) => setSchedulePaymentNotes(event.target.value)}
                          rows={3}
                          title="Notas de pago"
                          placeholder="Notas opcionales"
                          className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setScheduleInvoice(null)}
                        disabled={updatingPaymentInvoiceId === scheduleInvoice.id}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void handleSaveInvoiceSchedule()}
                        disabled={updatingPaymentInvoiceId === scheduleInvoice.id}
                      >
                        {updatingPaymentInvoiceId === scheduleInvoice.id ? "Guardando..." : "Guardar"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {payLinkInvoice ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Añadir portal/link</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPayLinkInvoice(null)}
                        disabled={updatingPaymentInvoiceId === payLinkInvoice.id}
                      >
                        Cerrar
                      </Button>
                    </div>

                    <div className="space-y-3 text-sm">
                      <p className="text-zinc-600 dark:text-zinc-300">{payLinkInvoice.filename ?? "Factura"}</p>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Link de pago (opcional)</label>
                        <input
                          type="url"
                          value={payLinkPaymentUrl}
                          onChange={(event) => setPayLinkPaymentUrl(event.target.value)}
                          title="Link de pago"
                          placeholder="https://..."
                          className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Portal del proveedor (opcional)</label>
                        <input
                          type="url"
                          value={payLinkSupplierPortalUrl}
                          onChange={(event) => setPayLinkSupplierPortalUrl(event.target.value)}
                          title="Portal del proveedor"
                          placeholder="https://..."
                          className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPayLinkInvoice(null)}
                        disabled={updatingPaymentInvoiceId === payLinkInvoice.id}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void handleSavePayLinksAndOpen()}
                        disabled={updatingPaymentInvoiceId === payLinkInvoice.id}
                      >
                        {updatingPaymentInvoiceId === payLinkInvoice.id ? "Guardando..." : "Guardar y abrir"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {receiptsInvoice ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-4 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Comprobantes</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReceiptsInvoice(null);
                          setInvoiceReceipts([]);
                        }}
                      >
                        Cerrar
                      </Button>
                    </div>

                    <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                      {receiptsInvoice.filename ?? "Factura"}
                    </p>

                    {isLoadingReceipts ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando comprobantes...</p>
                    ) : invoiceReceipts.length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">No hay comprobantes cargados.</p>
                    ) : (
                      <ul className="space-y-2">
                        {invoiceReceipts.map((receipt) => (
                          <li
                            key={receipt.id}
                            className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                          >
                            <p className="font-medium">{receipt.original_filename ?? "Comprobante PDF"}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              {formatDateTime(receipt.created_at)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}
        
              </div>
            </div>

            </div>

          </div>

            <div className={`${rightTab === "fiscal" ? "" : "hidden lg:hidden"}`}>
               <details open className="group border border-border rounded-xl shadow-sm bg-surface overflow-hidden">
                 <summary className="font-semibold text-[14px] cursor-pointer list-none flex items-center justify-between bg-surface-secondary hover:bg-surface-secondary/80 transition-colors px-5 py-4">
                   Ficha Fiscal & Estimación
                   <span className="transition duration-300 group-open:-rotate-180">
                     <svg fill="none" height="20" shape-rendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="20"><path d="M6 9l6 6 6-6"></path></svg>
                   </span>
                 </summary>
                 <div className="p-5 border-t border-border space-y-6">
                    <div>
                       <h3 className="text-[14px] font-semibold text-foreground mb-3">Provisión estimada al cierre de mes</h3>
                       {!isLoadingEstimate && estimate ? (
                          <div className="space-y-2.5 text-[14px] bg-surface-secondary p-4 rounded-xl border border-border shadow-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-zinc-600 dark:text-zinc-400">Total provisión</span>
                              <span className="font-semibold">{formatCop(estimate.totalProvision)}</span>
                            </div>
                            <div className="flex items-center justify-between opacity-80 text-[13px]">
                              <span className="text-zinc-500">IVA</span>
                              <span>{formatCop(estimate.ivaProvision)}</span>
                            </div>
                            <div className="flex items-center justify-between opacity-80 text-[13px] text-zinc-500">
                              <span className="text-zinc-500">Renta</span>
                              <span>{formatCop(estimate.rentaProvision)}</span>
                            </div>
                            <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800 my-2"></div>
                            <div className="flex items-center justify-between font-semibold">
                              <span>Caja post-provisión</span>
                              <span className={estimate.cashAfterProvision < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>{formatCop(estimate.cashAfterProvision)}</span>
                            </div>
                          </div>
                       ) : <p className="text-[13px] text-zinc-500">Cargando estimador...</p>}
                    </div>
                    
                    <SectionCard
          title="Perfil fiscal"
          description="Configuración base de contribuyente, régimen y estilo de provisión."
          className="mt-4"
        >
          <div className="mb-4">
            <input
              ref={rutInputRef}
              type="file"
              accept=".pdf,application/pdf,image/*"
              onChange={handleRutFileChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center"
              onClick={handleRutClick}
              disabled={isUploadingRut}
            >
              {isUploadingRut ? "Procesando RUT..." : "Configurar mi perfil con el RUT"}
            </Button>
            <p className="text-xs text-zinc-500 mt-2">
              Sube el PDF de tu RUT para extraer automáticamente tus responsabilidades (casilla 53) y configurar tu perfil fiscal.
            </p>
          </div>

          <Field label="Regimen" hint="Configura tu régimen fiscal actual.">
            <select
              value={regimen}
              onChange={(event) =>
                setRegimen(event.target.value as "simple" | "ordinario" | "unknown")
              }
              title="Seleccionar régimen fiscal"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              disabled={isLoadingTaxData || isSavingTaxData}
            >
              <option value="unknown">Sin definir</option>
              <option value="simple">Simple</option>
              <option value="ordinario">Ordinario</option>
            </select>
          </Field>

          <Field label="Responsable IVA" hint="Indica si facturas y cobras IVA.">
            <select
              value={vatResponsible}
              onChange={(event) =>
                setVatResponsible(event.target.value as "yes" | "no" | "unknown")
              }
              title="Seleccionar responsabilidad de IVA"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              disabled={isLoadingTaxData || isSavingTaxData}
            >
              <option value="unknown">Sin definir</option>
              <option value="yes">Si</option>
              <option value="no">No</option>
            </select>
          </Field>

          <Field label="Estilo de provisión" hint="Ajusta el nivel de prudencia al provisionar.">
            <select
              value={provisionStyle}
              onChange={(event) =>
                setProvisionStyle(
                  event.target.value as "conservative" | "balanced" | "aggressive",
                )
              }
              title="Seleccionar estilo de provisión"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              disabled={isLoadingTaxData || isSavingTaxData}
            >
              <option value="conservative">Conservador</option>
              <option value="balanced">Balanceado</option>
              <option value="aggressive">Agresivo</option>
            </select>
          </Field>

          <Field label="Municipio" hint="Municipio principal de operación.">
            <input
              value={municipality}
              onChange={(event) => setMunicipality(event.target.value)}
              title="Municipio principal de operación"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              placeholder="Ej: Medellin"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>
        </SectionCard>

        <SectionCard
          title="IVA y provisión"
          description="Vista rápida del estado estimado para separar y provisionar."
          className="mt-4"
        >
          {isLoadingEstimate ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando estimación...</p>
          ) : estimate ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 dark:text-zinc-300">Total provisión</span>
                <span className="font-medium">{formatCop(estimate.totalProvision)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 dark:text-zinc-300">IVA</span>
                <span>{formatCop(estimate.ivaProvision)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 dark:text-zinc-300">Renta</span>
                <span>{formatCop(estimate.rentaProvision)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {estimateError || "Completa datos para calcular provisión."}
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Datos del Mes en Curso"
          description={`Ingresa tus datos financieros para el mes actual (${currentYear}-${currentMonth.toString().padStart(2, "0")}).`}
          className="mt-4"
        >
          <Field label="Ingresos del mes (COP)" hint="Total de ingresos generados este mes.">
            <input
              type="number"
              value={incomeCop}
              onChange={(event) => setIncomeCop(event.target.value)}
              title="Ingresos del mes"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              placeholder="0"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="Gastos deducibles (COP)" hint="Gastos asociados a la operación.">
            <input
              type="number"
              value={deductibleExpensesCop}
              onChange={(event) => setDeductibleExpensesCop(event.target.value)}
              title="Gastos deducibles del mes"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              placeholder="0"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="IVA cobrado (COP)" hint="IVA facturado en ventas (si aplica).">
            <input
              type="number"
              value={vatCollectedCop}
              onChange={(event) => setVatCollectedCop(event.target.value)}
              title="IVA cobrado del mes"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              placeholder="0"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="Retenciones a favor (COP)" hint="Retefuente, reteica que te practicaron.">
            <input
              type="number"
              value={withholdingsCop}
              onChange={(event) => setWithholdingsCop(event.target.value)}
              title="Retenciones aplicadas del mes"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              placeholder="0"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>
        </SectionCard>

        <SectionCard
          title="Compromisos mensuales"
          description="Costos recurrentes y obligaciones operativas del negocio."
          className="mt-4"
        >

          <Field label="Tipo de contribuyente" hint="Selecciona tu tipo de identificación fiscal.">
            <select
              value={taxpayerType}
              onChange={(event) => {
                const nextValue = event.target.value as "natural" | "juridica" | "unknown";
                setTaxpayerType(nextValue);
                if (nextValue !== "juridica") {
                  setLegalType("unknown");
                }
              }}
              title="Seleccionar tipo de contribuyente"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              disabled={isLoadingTaxData || isSavingTaxData}
            >
              <option value="natural">Natural</option>
              <option value="juridica">Jurídica</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>

          {taxpayerType === "juridica" ? (
            <Field label="Tipo legal" hint="Solo aplica para contribuyentes jurídicos.">
              <select
                value={legalType}
                onChange={(event) =>
                  setLegalType(event.target.value as "sas" | "ltda" | "other" | "unknown")
                }
                title="Seleccionar tipo legal"
                className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
                disabled={isLoadingTaxData || isSavingTaxData}
              >
                <option value="sas">SAS</option>
                <option value="ltda">LTDA</option>
                <option value="other">Otra</option>
                <option value="unknown">Unknown</option>
              </select>
            </Field>
          ) : null}

          <Field label="Periodicidad IVA" hint="Frecuencia de presentación del IVA.">
            <select
              value={vatPeriodicity}
              onChange={(event) =>
                setVatPeriodicity(
                  event.target.value as "bimestral" | "cuatrimestral" | "anual" | "unknown",
                )
              }
              title="Seleccionar periodicidad de IVA"
              className="w-full rounded-md border border-border bg-surface-secondary px-2 py-2 text-sm text-foreground"
              disabled={isLoadingTaxData || isSavingTaxData}
            >
              <option value="bimestral">Bimestral</option>
              <option value="cuatrimestral">Cuatrimestral</option>
              <option value="anual">Anual</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>

          <Field label="Gastos fijos mensuales (COP)" hint="Valor mensual estimado de gastos fijos." suffix="COP">
            <input
              type="number"
              min={0}
              value={monthlyFixedCostsCop}
              onChange={(event) => setMonthlyFixedCostsCop(event.target.value)}
              title="Gastos fijos mensuales en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="Nómina mensual (COP)" hint="Costo mensual de nómina." suffix="COP">
            <input
              type="number"
              min={0}
              value={monthlyPayrollCop}
              onChange={(event) => setMonthlyPayrollCop(event.target.value)}
              title="Nómina mensual en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="Cuotas/deuda mensual (COP)" hint="Total mensual de obligaciones de deuda." suffix="COP">
            <input
              type="number"
              min={0}
              value={monthlyDebtPaymentsCop}
              onChange={(event) => setMonthlyDebtPaymentsCop(event.target.value)}
              title="Cuotas o deuda mensual en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>
        </SectionCard>
                    
                    <div className="pt-2">
                      <Button type="button" onClick={handleSaveTaxData} variant="primary" size="md" className="w-full font-medium" disabled={isLoadingTaxData || isSavingTaxData}>
                        {isSavingTaxData ? "Guardando..." : "Guardar Ficha Fiscal"}
                      </Button>
                    </div>
                 </div>
               </details>
            </div>
          </div>

        </div>
      </div>

      {/* ── Confirmation modal for quick execution ── */}
      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl">
            <h4 className="text-sm font-semibold mb-3">
              {confirmAction.type === "schedule_individual"
                ? "Programar pago"
                : `Programar ${confirmAction.count} facturas`}
            </h4>

            {confirmPhase === "confirm" && (
              <>
                {confirmAction.type === "schedule_individual" ? (
                  <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300 mb-3">
                    <p><span className="font-medium">Proveedor:</span> {confirmAction.supplier_name}</p>
                    <p><span className="font-medium">Monto:</span> {confirmAction.total_cop !== null ? formatCop(confirmAction.total_cop) : "Desconocido"}</p>
                    <p><span className="font-medium">Fecha:</span> {confirmAction.due_date ? formatDateOnly(confirmAction.due_date) : "Hoy"}</p>
                    <p><span className="font-medium">Método:</span> Transferencia</p>
                  </div>
                ) : (
                  <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300 mb-3">
                    <p><span className="font-medium">Facturas:</span> {confirmAction.count}</p>
                    <p><span className="font-medium">Total:</span> {confirmAction.total_cop !== null ? formatCop(confirmAction.total_cop) : "Monto variable"}</p>
                    <p><span className="font-medium">Método:</span> Transferencia</p>
                  </div>
                )}

                <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 mb-4">
                  <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-none" />
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    Esta acción es segura según los datos disponibles.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={closeConfirmation}>
                    Cancelar
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={() => void executeConfirmedAction()}>
                    Confirmar
                  </Button>
                </div>
              </>
            )}

            {confirmPhase === "running" && (
              <div className="py-4">
                {confirmAction.type === "schedule_bulk" && confirmProgress.total > 0 ? (
                  <div className="space-y-2">
                    <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.round((confirmProgress.completed / confirmProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
                      Programando... ({confirmProgress.completed}/{confirmProgress.total})
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 animate-pulse text-center">
                    Programando...
                  </p>
                )}
              </div>
            )}

            {confirmPhase === "done" && confirmResult && (
              <div className="py-2">
                <p className={`text-sm font-medium mb-4 ${confirmResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {confirmResult.message}
                </p>
                <div className="flex justify-end">
                  <Button type="button" variant="primary" size="sm" onClick={closeConfirmation}>
                    Cerrar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

    </PageShell>
  );
}

const activityLabels: Record<string, { label: string; icon: typeof Clock }> = {
  uploaded: { label: "Factura subida", icon: Upload },
  processed: { label: "Procesada por IA", icon: FileText },
  quality_updated: { label: "Calidad actualizada", icon: Shield },
  payment_opened: { label: "Link de pago abierto", icon: ExternalLink },
  scheduled: { label: "Pago programado", icon: Calendar },
  rescheduled: { label: "Pago reprogramado", icon: Calendar },
  marked_paid: { label: "Marcada como pagada", icon: CreditCard },
  receipt_uploaded: { label: "Comprobante subido", icon: Upload },
  manually_edited: { label: "Editada manualmente", icon: Edit3 },
};

function ActivityTimelineRow({ entry }: { entry: ActivityLogItem }) {
  const info = activityLabels[entry.activity] ?? { label: entry.activity, icon: Clock };
  const Icon = info.icon;
  const date = new Date(entry.created_at);
  const formatted = date.toLocaleDateString("es-CO", { day: "numeric", month: "short" }) + " " + date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-muted mt-0.5 flex-none" />
      <div className="flex-1 min-w-0">
        <span className="text-foreground">{info.label}</span>
        <span className="text-muted ml-2">{formatted}</span>
      </div>
    </div>
  );
}

