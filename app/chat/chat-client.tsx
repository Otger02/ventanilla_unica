"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChatBubble } from "@/components/ui/chat-bubble";
import { Field } from "@/components/ui/field";
import { PageShell } from "@/components/ui/page-shell";
import { SectionCard } from "@/components/ui/section-card";
import { Tabs } from "@/components/ui/tabs";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

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

type InvoiceItem = {
  id: string;
  created_at: string;
  status: "pending" | "scheduled" | "paid" | "disputed";
  payment_status: "unpaid" | "scheduled" | "paid";
  total_cop: number | null;
  supplier_name: string | null;
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
  const [invoiceUploadMessage, setInvoiceUploadMessage] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "datos">("chat");
  const invoiceInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const pendingReceiptInvoiceIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

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

    void loadEstimate();
    void loadTaxData();
    void loadHistory(historyMonths);
    void loadInvoices();
  }, [currentMonth, currentYear, historyMonths, loadInvoices]);

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

    return "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
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

    return "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
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

      const data: { conversationId: string; reply: string } = await response.json();
      setConversationId(data.conversationId);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply },
      ]);
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
      await loadInvoices();
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
      await loadInvoices();
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

      await loadInvoices();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo actualizar el pago de la factura.";
      setInvoicesError(message);
      return false;
    } finally {
      setUpdatingPaymentInvoiceId(null);
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

      const response = await fetch(`/api/invoices/${invoiceId}/receipts/upload`, {
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

      await loadInvoices();

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

  return (
    <PageShell>
      <div className="flex min-h-screen w-full flex-col gap-4 lg:flex-row">
      <div className="mb-1 lg:hidden">
        <Tabs
          value={mobileTab}
          onChange={(value) => setMobileTab(value as "chat" | "datos")}
          items={[
            { value: "chat", label: "Chat" },
            { value: "datos", label: "Datos" },
          ]}
        />
      </div>

      <div className={`${mobileTab === "chat" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
        {demoMode ? (
          <div className="rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
            DEMO MODE
          </div>
        ) : null}

        {showDemoDebug ? (
          <div className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100">
            DEMO DEBUG → process.env.DEMO_MODE: {demoModeRawEnv} | demoMode():{" "}
            {String(demoMode)}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Chat</h1>
          {!demoMode ? (
            <Button
              type="button"
              onClick={handleSignOut}
              variant="outline"
              size="md"
              disabled={isSigningOut}
            >
              {isSigningOut ? "Cerrando..." : "Cerrar sesion"}
            </Button>
          ) : null}
        </div>

        <Card className="mt-4">
          <h2 className="text-base font-semibold">Provisión estimada del mes</h2>

          {isLoadingEstimate ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Cargando estimación...</p>
          ) : null}

          {!isLoadingEstimate && estimate ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-600 dark:text-zinc-300">Total provisión</span>
                <span className="font-semibold">{formatCop(estimate.totalProvision)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-600 dark:text-zinc-300">Renta</span>
                <span>{formatCop(estimate.rentaProvision)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-600 dark:text-zinc-300">IVA</span>
                <span>{formatCop(estimate.ivaProvision)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-600 dark:text-zinc-300">Caja después de provisión</span>
                <span>{formatCop(estimate.cashAfterProvision)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-zinc-600 dark:text-zinc-300">Riesgo</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getRiskBadgeClasses(
                    estimate.riskLevel,
                  )}`}
                >
                  {getRiskLabelEs(estimate.riskLevel)}
                </span>
              </div>
              <p className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Estimación simplificada (MVP).
              </p>
            </div>
          ) : null}

          {!isLoadingEstimate && !estimate ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {estimateError || "Completa tus datos del mes para calcular."}
            </p>
          ) : null}
        </Card>

        <Card className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Histórico</h2>
            <select
              value={historyMonths}
              onChange={(event) => setHistoryMonths(Number(event.target.value) as 6 | 12)}
              title="Seleccionar cantidad de meses del histórico"
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
            </select>
          </div>

          {isLoadingHistory ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Cargando histórico...</p>
          ) : null}

          {!isLoadingHistory && historyError ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{historyError}</p>
          ) : null}

          {!isLoadingHistory && !historyError && historyItems.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              No hay meses suficientes para mostrar tendencia.
            </p>
          ) : null}

          {!isLoadingHistory && !historyError && historyItems.length > 0 ? (
            <>
              <div className="mt-3 space-y-2">
                {historyItems.map((item) => {
                  const maxValue = Math.max(
                    1,
                    ...historyItems.flatMap((row) => [
                      row.income_cop,
                      row.totalProvision,
                      Math.max(row.cashAfterProvision, 0),
                    ]),
                  );
                  const incomeWidth = Math.max((item.income_cop / maxValue) * 100, 2);
                  const provisionWidth = Math.max((item.totalProvision / maxValue) * 100, 2);
                  const cashWidth = Math.max((Math.max(item.cashAfterProvision, 0) / maxValue) * 100, 2);

                  return (
                    <div key={`${item.year}-${item.month}`}>
                      <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {getMonthLabel(item.year, item.month)}
                      </p>
                      <div className="space-y-1">
                        <progress
                          className="h-1.5 w-full overflow-hidden rounded [&::-webkit-progress-bar]:bg-zinc-100 [&::-webkit-progress-value]:bg-sky-500 dark:[&::-webkit-progress-bar]:bg-zinc-800"
                          value={incomeWidth}
                          max={100}
                        />
                        <progress
                          className="h-1.5 w-full overflow-hidden rounded [&::-webkit-progress-bar]:bg-zinc-100 [&::-webkit-progress-value]:bg-amber-500 dark:[&::-webkit-progress-bar]:bg-zinc-800"
                          value={provisionWidth}
                          max={100}
                        />
                        <progress
                          className="h-1.5 w-full overflow-hidden rounded [&::-webkit-progress-bar]:bg-zinc-100 [&::-webkit-progress-value]:bg-emerald-500 dark:[&::-webkit-progress-bar]:bg-zinc-800"
                          value={cashWidth}
                          max={100}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Azul: ingresos · Ámbar: provisión · Verde: disponible
                </p>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      <th className="px-2 py-2 font-medium">Mes</th>
                      <th className="px-2 py-2 font-medium">Ingresos</th>
                      <th className="px-2 py-2 font-medium">Gastos</th>
                      <th className="px-2 py-2 font-medium">Provisión</th>
                      <th className="px-2 py-2 font-medium">Disponible</th>
                      <th className="px-2 py-2 font-medium">Riesgo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyItems.map((item) => (
                      <tr key={`row-${item.year}-${item.month}`} className="border-b border-zinc-100 dark:border-zinc-900">
                        <td className="px-2 py-2">{getMonthLabel(item.year, item.month)}</td>
                        <td className="px-2 py-2">{formatCop(item.income_cop)}</td>
                        <td className="px-2 py-2">{formatCop(item.deductible_expenses_cop)}</td>
                        <td className="px-2 py-2">{formatCop(item.totalProvision)}</td>
                        <td className="px-2 py-2">{formatCop(item.cashAfterProvision)}</td>
                        <td className="px-2 py-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getRiskBadgeClasses(
                              item.riskLevel,
                            )}`}
                          >
                            {getRiskLabelEs(item.riskLevel)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </Card>

        <Card className="mt-4 flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Aun no hay mensajes.
            </p>
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
        </Card>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Sugerencias
          </p>
          <div className="flex flex-wrap gap-2">
            {exampleQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => void sendMessage(question)}
                className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                disabled={isSending}
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Escribe tu mensaje..."
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            disabled={isSending}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSending}
          >
            {isSending ? "Enviando..." : "Enviar"}
          </Button>
        </form>
      </div>

      <Card
        className={`${mobileTab === "datos" ? "block" : "hidden"} w-full lg:sticky lg:top-4 lg:block lg:w-[380px] xl:w-[420px]`}
      >
        <h2 className="text-lg font-semibold tracking-tight">Ficha fiscal</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Ajusta supuestos y revisa tu posición tributaria mensual.
        </p>

        {isLoadingTaxData ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Cargando...</p>
        ) : null}

        {taxError ? (
          <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {taxError}
          </p>
        ) : null}

        {taxSuccess ? (
          <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            {taxSuccess}
          </p>
        ) : null}

        <SectionCard
          title="Perfil fiscal"
          description="Configuración base de contribuyente, régimen y estilo de provisión."
          className="mt-4"
        >

          <Field label="Regimen" hint="Configura tu régimen fiscal actual.">
            <select
              value={regimen}
              onChange={(event) =>
                setRegimen(event.target.value as "simple" | "ordinario" | "unknown")
              }
              title="Seleccionar régimen fiscal"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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

        <SectionCard
          title={`Este mes (${currentMonth}/${currentYear})`}
          description="Datos operativos del periodo para estimación fiscal."
          className="mt-4"
        >

          <Field label="Ingresos (COP)" hint="Total de ingresos del periodo." suffix="COP">
            <input
              type="number"
              min={0}
              value={incomeCop}
              onChange={(event) => setIncomeCop(event.target.value)}
              title="Ingresos del mes en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="Gastos deducibles (COP)" hint="Total de gastos deducibles del periodo." suffix="COP">
            <input
              type="number"
              min={0}
              value={deductibleExpensesCop}
              onChange={(event) => setDeductibleExpensesCop(event.target.value)}
              title="Gastos deducibles del mes en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="Retenciones (COP)" hint="Retenciones aplicadas en el mes." suffix="COP">
            <input
              type="number"
              min={0}
              value={withholdingsCop}
              onChange={(event) => setWithholdingsCop(event.target.value)}
              title="Retenciones del mes en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>

          <Field label="IVA cobrado (COP)" hint="IVA facturado durante el mes." suffix="COP">
            <input
              type="number"
              min={0}
              value={vatCollectedCop}
              onChange={(event) => setVatCollectedCop(event.target.value)}
              title="IVA cobrado del mes en pesos colombianos"
              className="w-full rounded-md border border-zinc-300 px-2 py-2 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="14.800.000"
              disabled={isLoadingTaxData || isSavingTaxData}
            />
          </Field>
        </SectionCard>

        <SectionCard
          title="Facturas"
          description="Carga manual de archivos y listado básico."
          className="mt-4"
        >
          {demoMode ? (
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
                  accept=".pdf,application/pdf"
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
                  {invoices.map((invoice) => {
                    const extractionStatus = getInvoiceDisplayStatus(invoice);
                    const dueDate = getInvoiceDueDate(invoice);
                    // Compare dueDate with today
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    let dueColorClass = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
                    let dueLabel = "Al d�a";
                    if (invoice.payment_status === "paid") {
                      dueColorClass = "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
                      dueLabel = "Pagada";
                    } else if (dueDate) {
                      const dDate = new Date(dueDate);
                      dDate.setHours(0, 0, 0, 0);
                      const diffTime = dDate.getTime() - today.getTime();
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      if (diffDays < 0) {
                        dueColorClass = "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
                        dueLabel = "Vencida";
                      } else if (diffDays <= 5) {
                        dueColorClass = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
                        dueLabel = "Vence pronto";
                      } else {
                        dueColorClass = "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400";
                        dueLabel = "Al d�a";
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
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${dueColorClass}`}
                          >
                            {dueLabel}
                          </span>
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
                              className="w-full text-xs"
                              onClick={() => handleReceiptPickerClick(invoice.id)}
                              disabled={uploadingReceiptInvoiceId === invoice.id || updatingPaymentInvoiceId === invoice.id || processingInvoiceId === invoice.id}
                            >
                              {uploadingReceiptInvoiceId === invoice.id ? "Subiendo..." : "Comprobante"}
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
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {detailsInvoice ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Detalle de extracción</h4>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDetailsInvoice(null)}>
                        Cerrar
                      </Button>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div><span className="font-medium">Proveedor:</span> {String(getInvoiceExtractedField(detailsInvoice, "supplier_name") ?? detailsInvoice.supplier_name ?? "—")}</div>
                      <div><span className="font-medium">NIT:</span> {String(getInvoiceExtractedField(detailsInvoice, "supplier_tax_id") ?? "—")}</div>
                      <div><span className="font-medium">Factura #:</span> {String(getInvoiceExtractedField(detailsInvoice, "invoice_number") ?? "—")}</div>
                      <div><span className="font-medium">Fecha emisión:</span> {String(getInvoiceExtractedField(detailsInvoice, "issue_date") ?? "—")}</div>
                      <div><span className="font-medium">Vence:</span> {String(getInvoiceExtractedField(detailsInvoice, "due_date") ?? getInvoiceDueDate(detailsInvoice) ?? "—")}</div>
                      <div><span className="font-medium">Subtotal:</span> {(() => { const v = getInvoiceExtractedField(detailsInvoice, "subtotal_cop"); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? formatCop(n) : "—"; })()}</div>
                      <div><span className="font-medium">IVA:</span> {(() => { const v = getInvoiceExtractedField(detailsInvoice, "iva_cop"); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? formatCop(n) : "—"; })()}</div>
                      <div><span className="font-medium">Total:</span> {detailsInvoice.total_cop !== null ? formatCop(detailsInvoice.total_cop) : (() => { const v = getInvoiceExtractedField(detailsInvoice, "total_cop"); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? formatCop(n) : "—"; })()}</div>
                      <div><span className="font-medium">Moneda:</span> {String(getInvoiceExtractedField(detailsInvoice, "currency") ?? "—")}</div>
                    </div>

                    <div className="mt-4 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-700">
                      <p className="mb-2 font-semibold">Confidence</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {Object.entries(getInvoiceConfidence(detailsInvoice)).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <span className="text-zinc-500 dark:text-zinc-400">{key}</span>
                            <span className="font-medium">{value.toFixed(2)}</span>
                          </div>
                        ))}
                        {Object.keys(getInvoiceConfidence(detailsInvoice)).length === 0 ? (
                          <p className="text-zinc-500 dark:text-zinc-400">Sin confidence disponible.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {scheduleInvoice ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
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
                          className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                          className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                          className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                  <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
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
                          className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                          className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                  <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
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
        </SectionCard>

        <Button
          type="button"
          onClick={() => void handleSaveTaxData()}
          className="mt-5 w-full"
          variant="primary"
          size="md"
          disabled={isLoadingTaxData || isSavingTaxData}
        >
          {isSavingTaxData ? "Guardando..." : "Guardar"}
        </Button>
      </Card>
      </div>
    </PageShell>
  );
}
