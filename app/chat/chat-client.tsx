"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

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

const exampleQuestions = [
  "¿Cuánto debo provisionar para impuestos este mes?",
  "¿Qué gastos puedo deducir como independiente?",
  "¿Estoy listo para contratar a alguien?",
  "¿Qué debo tener al día con la DIAN?",
  "¿Cómo organizo mis finanzas este mes?",
  "¿Qué documentos debería guardar?",
];

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
  const [municipality, setMunicipality] = useState("");
  const [incomeCop, setIncomeCop] = useState("0");
  const [deductibleExpensesCop, setDeductibleExpensesCop] = useState("0");
  const [withholdingsCop, setWithholdingsCop] = useState("0");
  const [vatCollectedCop, setVatCollectedCop] = useState("0");
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
  }, [currentMonth, currentYear, historyMonths]);

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

      if (
        !Number.isFinite(incomeValue) ||
        !Number.isFinite(deductibleExpensesValue) ||
        !Number.isFinite(withholdingsValue) ||
        !Number.isFinite(vatCollectedValue)
      ) {
        throw new Error("Los valores del mes deben ser numericos.");
      }

      if (
        incomeValue < 0 ||
        deductibleExpensesValue < 0 ||
        withholdingsValue < 0 ||
        vatCollectedValue < 0
      ) {
        throw new Error("Los valores del mes no pueden ser negativos.");
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 sm:p-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
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
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              disabled={isSigningOut}
            >
              {isSigningOut ? "Cerrando..." : "Cerrar sesion"}
            </button>
          ) : null}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Histórico</h2>
            <select
              value={historyMonths}
              onChange={(event) => setHistoryMonths(Number(event.target.value) as 6 | 12)}
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
                        <div className="h-1.5 w-full rounded bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-1.5 rounded bg-sky-500" style={{ width: `${incomeWidth}%` }} />
                        </div>
                        <div className="h-1.5 w-full rounded bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className="h-1.5 rounded bg-amber-500"
                            style={{ width: `${provisionWidth}%` }}
                          />
                        </div>
                        <div className="h-1.5 w-full rounded bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className="h-1.5 rounded bg-emerald-500"
                            style={{ width: `${cashWidth}%` }}
                          />
                        </div>
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
        </div>

        <div className="mt-4 flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Aun no hay mensajes.
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map((messageItem, index) => (
                <li
                  key={`${messageItem.role}-${index}`}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    messageItem.role === "user"
                      ? "ml-auto bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {messageItem.content}
                </li>
              ))}
              {isSending ? (
                <li className="max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                  escribiendo...
                </li>
              ) : null}
            </ul>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {exampleQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => void sendMessage(question)}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              disabled={isSending}
            >
              {question}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Escribe tu mensaje..."
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isSending}
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            disabled={isSending}
          >
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </form>
      </div>

      <aside className="w-full rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:mt-[4.25rem] lg:w-96">
        <h2 className="text-lg font-semibold">Datos fiscales</h2>

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

        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Perfil fiscal</h3>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">Regimen</label>
          <select
            value={regimen}
            onChange={(event) =>
              setRegimen(event.target.value as "simple" | "ordinario" | "unknown")
            }
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          >
            <option value="unknown">Sin definir</option>
            <option value="simple">Simple</option>
            <option value="ordinario">Ordinario</option>
          </select>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">Responsable IVA</label>
          <select
            value={vatResponsible}
            onChange={(event) =>
              setVatResponsible(event.target.value as "yes" | "no" | "unknown")
            }
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          >
            <option value="unknown">Sin definir</option>
            <option value="yes">Si</option>
            <option value="no">No</option>
          </select>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">
            Estilo de provisión
          </label>
          <select
            value={provisionStyle}
            onChange={(event) =>
              setProvisionStyle(
                event.target.value as "conservative" | "balanced" | "aggressive",
              )
            }
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          >
            <option value="conservative">Conservador</option>
            <option value="balanced">Balanceado</option>
            <option value="aggressive">Agresivo</option>
          </select>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">Municipio</label>
          <input
            value={municipality}
            onChange={(event) => setMunicipality(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Ej: Medellin"
            disabled={isLoadingTaxData || isSavingTaxData}
          />
        </div>

        <div className="mt-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Este mes ({currentMonth}/{currentYear})
          </h3>

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">Ingresos (COP)</label>
          <input
            type="number"
            min={0}
            value={incomeCop}
            onChange={(event) => setIncomeCop(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          />

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">Gastos deducibles (COP)</label>
          <input
            type="number"
            min={0}
            value={deductibleExpensesCop}
            onChange={(event) => setDeductibleExpensesCop(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          />

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">Retenciones (COP)</label>
          <input
            type="number"
            min={0}
            value={withholdingsCop}
            onChange={(event) => setWithholdingsCop(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          />

          <label className="block text-xs text-zinc-600 dark:text-zinc-300">IVA cobrado (COP)</label>
          <input
            type="number"
            min={0}
            value={vatCollectedCop}
            onChange={(event) => setVatCollectedCop(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            disabled={isLoadingTaxData || isSavingTaxData}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSaveTaxData()}
          className="mt-5 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          disabled={isLoadingTaxData || isSavingTaxData}
        >
          {isSavingTaxData ? "Guardando..." : "Guardar"}
        </button>
      </aside>
    </div>
  );
}
