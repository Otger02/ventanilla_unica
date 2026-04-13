"use client";

import { useCallback, useState } from "react";
import {
  type ReviewAction,
  type ReviewActionContext,
  canRunReviewAction,
} from "@/lib/invoices/review-actions";
import type { ReviewQueueItem } from "@/lib/invoices/review-queue-core";

// ─── Types ───

type PaymentMethod = "transfer" | "pse" | "cash" | "other";

export type BulkSchedulePayload = {
  date: string; // YYYY-MM-DD
  method: PaymentMethod;
  notes: string | null;
};

export type BulkScheduleResult = {
  scheduled: number;
  skipped: number;
  failed: number;
  errors: Array<{ invoice_id: string; error: string }>;
};

// ─── Concurrency helper ───

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  onEach?: () => void,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        const value = await tasks[i]();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
      onEach?.();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a ReviewActionContext from a ReviewQueueItem. */
function toActionContext(item: ReviewQueueItem): ReviewActionContext {
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

// ─── Hook ───

export function useBulkSchedule() {
  const [isRunning, setIsRunning] = useState(false);

  const execute = useCallback(
    async (
      items: ReviewQueueItem[],
      payload: BulkSchedulePayload,
      onProgress: (completed: number, total: number) => void,
    ): Promise<BulkScheduleResult> => {
      // Split into eligible / skipped
      const eligible: ReviewQueueItem[] = [];
      let skipped = 0;

      for (const item of items) {
        const ctx = toActionContext(item);
        if (canRunReviewAction("schedule_payment" as ReviewAction, ctx)) {
          eligible.push(item);
        } else {
          skipped++;
        }
      }

      const total = eligible.length;
      let completed = 0;

      const result: BulkScheduleResult = {
        scheduled: 0,
        skipped,
        failed: 0,
        errors: [],
      };

      if (total === 0) return result;

      setIsRunning(true);
      onProgress(0, total);

      const tasks = eligible.map((item) => async () => {
        // Small delay to avoid hammering the server
        await sleep(50);

        const res = await fetch(`/api/invoices/${item.invoice_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_status: "scheduled",
            scheduled_payment_date: payload.date,
            payment_method: payload.method,
            payment_notes: payload.notes,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!res.ok) {
          throw new Error(
            data.error || `Error programando factura ${item.invoice_id}`,
          );
        }

        return item.invoice_id;
      });

      const settled = await withConcurrency(tasks, 5, () => {
        completed++;
        onProgress(completed, total);
      });

      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        if (s.status === "fulfilled") {
          result.scheduled++;
        } else {
          result.failed++;
          result.errors.push({
            invoice_id: eligible[i].invoice_id,
            error:
              s.reason instanceof Error
                ? s.reason.message
                : "Error desconocido",
          });
        }
      }

      setIsRunning(false);
      return result;
    },
    [],
  );

  return { execute, isRunning };
}
