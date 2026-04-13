"use client";

import { useState } from "react";
import type { ReviewQueueItem } from "@/lib/invoices/review-queue-core";
import {
  type ReviewActionContext,
  canRunReviewAction,
} from "@/lib/invoices/review-actions";
import {
  useBulkSchedule,
  type BulkSchedulePayload,
  type BulkScheduleResult,
} from "@/hooks/useBulkSchedule";
import { Button } from "@/components/ui/button";

type BulkScheduleModalProps = {
  items: ReviewQueueItem[];
  onClose: () => void;
  onComplete: (result: BulkScheduleResult) => void;
};

function toCtx(item: ReviewQueueItem): ReviewActionContext {
  return {
    invoice_id: item.invoice_id,
    payment_status: item.payment_status,
    payment_url: null,
    supplier_portal_url: null,
    due_date: item.due_date,
    data_quality_status: item.data_quality_status,
    vat_status: item.vat_status,
    supplier_name: item.supplier_name,
  };
}

export function BulkScheduleModal({
  items,
  onClose,
  onComplete,
}: BulkScheduleModalProps) {
  // Phase
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");

  // Form fields
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<"transfer" | "pse" | "cash" | "other">(
    "transfer",
  );
  const [notes, setNotes] = useState("");

  // Progress
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<BulkScheduleResult | null>(null);

  const { execute, isRunning } = useBulkSchedule();

  // Compute eligible vs ineligible
  const eligible = items.filter((item) =>
    canRunReviewAction("schedule_payment", toCtx(item)),
  );
  const skippedCount = items.length - eligible.length;

  async function handleSubmit() {
    if (!date || eligible.length === 0) return;

    setPhase("running");
    setProgress({ completed: 0, total: eligible.length });

    const payload: BulkSchedulePayload = {
      date,
      method,
      notes: notes.trim() || null,
    };

    const res = await execute(items, payload, (completed, total) => {
      setProgress({ completed, total });
    });

    setResult(res);
    setPhase("done");
  }

  function handleClose() {
    if (result) {
      onComplete(result);
    } else {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl mx-4">
        <h3 className="text-base font-semibold text-foreground mb-4">
          Programar pago masivo
        </h3>

        {/* ── Form phase ── */}
        {phase === "form" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Fecha de pago
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Método de pago
              </label>
              <select
                value={method}
                onChange={(e) =>
                  setMethod(
                    e.target.value as "transfer" | "pse" | "cash" | "other",
                  )
                }
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground"
              >
                <option value="transfer">Transferencia</option>
                <option value="pse">PSE</option>
                <option value="cash">Efectivo</option>
                <option value="other">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Notas (opcional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground resize-none"
                placeholder="Notas sobre el pago..."
              />
            </div>

            {/* Summary */}
            <div className="text-sm text-muted space-y-1">
              <p>
                Se programarán{" "}
                <span className="font-semibold text-foreground">
                  {eligible.length}
                </span>{" "}
                factura{eligible.length !== 1 ? "s" : ""}
              </p>
              {skippedCount > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  {skippedCount} ya pagada{skippedCount !== 1 ? "s" : ""}, se
                  omitirán
                </p>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!date || eligible.length === 0}
                onClick={() => void handleSubmit()}
              >
                Programar {eligible.length} factura
                {eligible.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {/* ── Running phase ── */}
        {phase === "running" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Programando... ({progress.completed}/{progress.total})
            </p>
            <div className="w-full bg-surface-secondary rounded-full h-2 overflow-hidden">
              <div
                className="bg-accent h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* ── Done phase ── */}
        {phase === "done" && result && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              {result.scheduled > 0 && (
                <p className="text-emerald-600 dark:text-emerald-400">
                  {result.scheduled} factura
                  {result.scheduled !== 1 ? "s" : ""} programada
                  {result.scheduled !== 1 ? "s" : ""}
                </p>
              )}
              {result.skipped > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  {result.skipped} omitida{result.skipped !== 1 ? "s" : ""} (ya
                  pagadas)
                </p>
              )}
              {result.failed > 0 && (
                <p className="text-red-600 dark:text-red-400">
                  {result.failed} error{result.failed !== 1 ? "es" : ""}
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="text-xs text-red-500 dark:text-red-400 list-disc ml-4 mt-1 space-y-0.5">
                  {result.errors.slice(0, 5).map((err) => (
                    <li key={err.invoice_id}>{err.error}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>...y {result.errors.length - 5} más</li>
                  )}
                </ul>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="primary" size="sm" onClick={handleClose}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
